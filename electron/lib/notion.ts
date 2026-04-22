import { Client, APIResponseError } from "@notionhq/client";
import type {
  DatabaseObjectResponse,
  PageObjectResponse,
  PartialDatabaseObjectResponse,
  PartialPageObjectResponse,
  QueryDatabaseParameters,
  QueryDatabaseResponse,
  UserObjectResponse,
} from "@notionhq/client/build/src/api-endpoints.js";
import type {
  DbPairing,
  DiscoverResult,
  NotionUser,
  TaskItem,
  TaskQueryError,
  TaskType,
  TasksResult,
  WriteSessionInput,
} from "./types.js";

const EXCLUDED_STATUSES = ["Complete", "Blocked"];

/**
 * Notion-flavored IDs are 32-char hex with or without hyphens. Accept both shapes.
 */
function normalizeId(id: string): string {
  const clean = id.replace(/-/g, "").trim();
  if (clean.length !== 32) return id;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(
    12,
    16,
  )}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

/**
 * Extract a page/database ID from either a Notion URL or raw ID.
 */
export function extractIdFromUrl(urlOrId: string): string | null {
  if (!urlOrId) return null;
  const trimmed = urlOrId.trim();
  // Raw 32-char hex (with or without dashes)
  const rawMatch = trimmed.replace(/-/g, "").match(/^[0-9a-f]{32}$/i);
  if (rawMatch) return normalizeId(trimmed);
  // URL pattern: https://www.notion.so/workspace/Title-abcdef123...
  const urlMatch = trimmed.match(/([0-9a-f]{32})(?:[?#]|$)/i);
  if (urlMatch) return normalizeId(urlMatch[1]);
  return null;
}

export class NotionClient {
  readonly token: string;
  private client: Client;

  constructor(token: string) {
    this.token = token;
    this.client = new Client({ auth: token });
  }

  async listUsers(): Promise<NotionUser[]> {
    const users: NotionUser[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.users.list({ start_cursor: cursor, page_size: 100 });
      for (const u of res.results as UserObjectResponse[]) {
        if (u.type !== "person") continue; // skip bots
        users.push({
          id: u.id,
          name: u.name ?? "Unknown",
          avatarUrl: u.avatar_url ?? undefined,
          email:
            u.type === "person" && "person" in u && u.person
              ? (u.person as { email?: string }).email
              : undefined,
        });
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
    return users.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Given the Work Sessions parent page URL, find every `child_database` block
   * inside it. For each one, inspect its Task-relation property to identify the
   * corresponding Tasks DB. Return one pairing per teamspace.
   */
  async discoverDatabases(parentPageUrl?: string): Promise<DiscoverResult> {
    const warnings: string[] = [];
    const defaultParent =
      parentPageUrl ??
      "https://www.notion.so/ecom-wizards/Work-Sessions-3410df49a4a8800fb975c7a979386060";
    const parentId = extractIdFromUrl(defaultParent);
    if (!parentId) {
      return {
        pairings: [],
        warnings: [
          `Could not extract a page ID from "${defaultParent}". Set the Work Sessions parent URL in Settings.`,
        ],
      };
    }

    const childDbIds: string[] = [];
    let cursor: string | undefined;
    try {
      do {
        const res = await this.client.blocks.children.list({
          block_id: parentId,
          start_cursor: cursor,
          page_size: 100,
        });
        for (const block of res.results) {
          if ("type" in block && block.type === "child_database") {
            childDbIds.push(block.id);
          }
        }
        cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
      } while (cursor);
    } catch (err) {
      warnings.push(
        `Could not list Work Sessions page children: ${describeError(err)}. Make sure the integration is shared with that page.`,
      );
      return { pairings: [], warnings };
    }

    const pairings: DbPairing[] = [];
    for (const dbId of childDbIds) {
      try {
        const db = (await this.client.databases.retrieve({
          database_id: dbId,
        })) as DatabaseObjectResponse;
        const titleText = db.title?.map((t) => t.plain_text).join("") ?? "";
        const props = db.properties ?? {};

        // Identify the Work Sessions DB shape: has a relation property named "Task"
        const taskRelation = Object.values(props).find(
          (p) => p.type === "relation" && p.name === "Task",
        );
        if (!taskRelation || taskRelation.type !== "relation") {
          warnings.push(
            `Skipped "${titleText}" — no "Task" relation property found.`,
          );
          continue;
        }

        const tasksDbId = taskRelation.relation.database_id;
        const label = labelForWorkSessionsDb(titleText);

        // Retrieve the Tasks DB so we can extract its Status options
        // (options differ across teamspaces, e.g. "In progress" vs
        // "In Progress").
        const statusOptions = await this.fetchStatusOptions(tasksDbId, warnings);

        pairings.push({
          label,
          tasksDbId,
          workSessionDbId: db.id,
          taskRelationName: "Task",
          statusOptions,
        });
      } catch (err) {
        warnings.push(
          `Could not inspect database ${dbId}: ${describeError(err)}`,
        );
      }
    }

    if (pairings.length === 0 && warnings.length === 0) {
      warnings.push(
        "No Work Sessions sub-databases found inside the parent page.",
      );
    }

    return { pairings, warnings };
  }

  async queryTasks(opts: {
    pairings: DbPairing[];
    assigneeId: string | null;
    typeFilter: TaskType[];
  }): Promise<TasksResult> {
    const { pairings, assigneeId, typeFilter } = opts;
    if (pairings.length === 0) return { tasks: [], errors: [] };

    const perPairing = await Promise.all(
      pairings.map(
        async (
          pairing,
        ): Promise<{ tasks: TaskItem[]; error: TaskQueryError | null }> => {
          try {
            // Type filter is applied client-side because the property name
            // differs across teamspaces ("Type" vs "Task Type").
            const filter = buildTaskFilter(assigneeId);
            const params: QueryDatabaseParameters = {
              database_id: pairing.tasksDbId,
              page_size: 100,
              sorts: [{ property: "Due", direction: "ascending" }],
            };
            if (filter) params.filter = filter;

            const results: PageObjectResponse[] = [];
            let cursor: string | undefined;
            do {
              const res: QueryDatabaseResponse = await this.client.databases.query({
                ...params,
                start_cursor: cursor,
              });
              for (const r of res.results as Array<
                | PageObjectResponse
                | PartialPageObjectResponse
                | DatabaseObjectResponse
                | PartialDatabaseObjectResponse
              >) {
                if ("properties" in r) results.push(r as PageObjectResponse);
              }
              cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
            } while (cursor);

            return {
              tasks: results.map((page) => mapPageToTaskItem(page, pairing)),
              error: null,
            };
          } catch (err) {
            // Return a structured error per pairing so the UI can flag the
            // outage (stale data / missing access / schema drift) instead of
            // silently dropping that teamspace's rows.
            console.warn(
              `Failed to query tasks in ${pairing.label} (${pairing.tasksDbId}):`,
              err,
            );
            return {
              tasks: [],
              error: {
                teamspace: pairing.label,
                tasksDbId: pairing.tasksDbId,
                error: describeError(err),
              },
            };
          }
        },
      ),
    );

    const allTasks = perPairing.flatMap((p) => p.tasks);
    const errors = perPairing
      .map((p) => p.error)
      .filter((e): e is TaskQueryError => e !== null);

    const filtered =
      typeFilter.length === 0
        ? allTasks
        : (() => {
            const allowed = new Set<string>(typeFilter);
            return allTasks.filter(
              (t) => t.type !== null && allowed.has(t.type),
            );
          })();

    return { tasks: filtered, errors };
  }

  async fetchStatusOptions(
    tasksDbId: string,
    warnings: string[],
  ): Promise<string[]> {
    try {
      const db = (await this.client.databases.retrieve({
        database_id: tasksDbId,
      })) as DatabaseObjectResponse;
      const statusProp = db.properties["Status"];
      if (!statusProp || statusProp.type !== "status") return [];
      return statusProp.status.options.map((o) => o.name);
    } catch (err) {
      warnings.push(
        `Could not read Status options for tasks DB ${tasksDbId}: ${describeError(err)}`,
      );
      return [];
    }
  }

  async updateTaskStatus(taskId: string, statusName: string): Promise<void> {
    await this.client.pages.update({
      page_id: taskId,
      properties: {
        Status: { status: { name: statusName } },
      } as unknown as Parameters<typeof this.client.pages.update>[0]["properties"],
    });
  }

  async createWorkSession(input: WriteSessionInput): Promise<void> {
    const properties: Record<string, unknown> = {
      Name: {
        title: [
          { type: "text", text: { content: `Session: ${input.taskTitle}` } },
        ],
      },
      "Start Time": {
        date: { start: input.startIso },
      },
      "End Time": {
        date: { start: input.endIso },
      },
      [input.taskRelationName]: {
        relation: [{ id: input.taskId }],
      },
    };

    if (input.teamMemberId) {
      properties["Team Member"] = {
        people: [{ id: input.teamMemberId }],
      };
    }

    await this.client.pages.create({
      parent: { database_id: input.workSessionDbId },
      properties: properties as unknown as Parameters<
        typeof this.client.pages.create
      >[0]["properties"],
    });
  }
}

function buildTaskFilter(
  assigneeId: string | null,
): QueryDatabaseParameters["filter"] | undefined {
  const clauses: NonNullable<QueryDatabaseParameters["filter"]>[] = [];

  if (assigneeId) {
    clauses.push({
      property: "Assignee",
      people: { contains: assigneeId },
    });
  }

  for (const excluded of EXCLUDED_STATUSES) {
    clauses.push({
      property: "Status",
      status: { does_not_equal: excluded },
    });
  }

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { and: clauses } as QueryDatabaseParameters["filter"];
}

// Names we'll look for when scanning a task page — different teamspaces rename
// the default "Name" column (e.g. Client DB uses "Task") and use different
// Type property names ("Type" vs "Task Type").
const TYPE_PROPERTY_NAMES = ["Type", "Task Type"];
const DUE_PROPERTY_NAMES = ["Due", "Due Date", "Deadline"];

function mapPageToTaskItem(
  page: PageObjectResponse,
  pairing: DbPairing,
): TaskItem {
  const props = page.properties;

  // Title — find by TYPE, not by name (the column is renamed in some DBs).
  let title = "Untitled";
  for (const prop of Object.values(props)) {
    if (prop.type === "title") {
      const text = prop.title.map((t) => t.plain_text).join("").trim();
      if (text) title = text;
      break;
    }
  }

  // Due
  let dueDate: string | null = null;
  let dueHasTime = false;
  for (const name of DUE_PROPERTY_NAMES) {
    const p = props[name];
    if (p && p.type === "date" && p.date) {
      const raw = p.date.start;
      dueHasTime = raw.length > 10;
      dueDate = dueHasTime ? raw : raw.slice(0, 10);
      break;
    }
  }

  // Status
  let status: string | null = null;
  const statusProp = props["Status"];
  if (statusProp && statusProp.type === "status" && statusProp.status) {
    status = statusProp.status.name;
  }

  // Priority
  let priority: TaskItem["priority"] = null;
  const priProp = props["Priority"];
  if (priProp && priProp.type === "select" && priProp.select) {
    const n = priProp.select.name;
    if (n === "Urgent" || n === "High" || n === "Normal" || n === "Low")
      priority = n;
  }

  // Type — check both "Type" and "Task Type" since the Client DB renames it.
  // Return whatever value is set, regardless of the fixed TaskType enum, so
  // categories like "Design" / "Amazon" surface in the UI too.
  let type: TaskType | null = null;
  for (const name of TYPE_PROPERTY_NAMES) {
    const p = props[name];
    if (p && p.type === "select" && p.select) {
      type = p.select.name as TaskType;
      break;
    }
  }

  // Time Estimate (min) — number
  let timeEstimateMin: number | null = null;
  const teProp = props["Time Estimate (min)"];
  if (teProp && teProp.type === "number" && teProp.number !== null) {
    timeEstimateMin = teProp.number;
  }

  // Time Tracked — formula that rolls up session durations. Can be either
  // a number (minutes) or a string in "HH:MM:SS" form, depending on which
  // variant the user's DB formula outputs.
  let timeTrackedMin: number | null = null;
  const ttProp = props["Time Tracked"];
  if (ttProp && ttProp.type === "formula") {
    if (ttProp.formula.type === "number" && ttProp.formula.number !== null) {
      timeTrackedMin = ttProp.formula.number;
    } else if (ttProp.formula.type === "string" && ttProp.formula.string) {
      timeTrackedMin = parseHmsToMinutes(ttProp.formula.string);
    }
  }

  return {
    id: page.id,
    title,
    url: page.url,
    dueDate,
    dueHasTime,
    status,
    priority,
    type,
    teamspace: pairing.label,
    workSessionDbId: pairing.workSessionDbId,
    taskRelationName: pairing.taskRelationName,
    tasksDbId: pairing.tasksDbId,
    timeEstimateMin,
    timeTrackedMin,
    // Old pairings saved before this field existed won't have statusOptions —
    // fall back to an empty list so the dropdown degrades to a read-only label
    // until the user clicks Discover again.
    statusOptions: pairing.statusOptions ?? [],
  };
}

function labelForWorkSessionsDb(title: string): string {
  // "Company Work Sessions" → "Company"
  return title.replace(/\s*work sessions\s*/i, "").trim() || title;
}

/**
 * Parse a Notion formula that outputs "HH:MM:SS" (or "H:MM:SS") into minutes.
 * Returns null on parse failure so callers can fall back gracefully.
 */
function parseHmsToMinutes(s: string): number | null {
  const match = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const h = Number.parseInt(match[1], 10);
  const m = Number.parseInt(match[2], 10);
  const sec = Number.parseInt(match[3], 10);
  if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(sec)) return null;
  return h * 60 + m + sec / 60;
}

function describeError(err: unknown): string {
  if (err instanceof APIResponseError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
