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
  NotionColor,
  NotionUser,
  StatusOption,
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

        // Retrieve the Tasks DB so we can learn *its* shape, rather than
        // assuming every DB uses the same property names. Different
        // teamspaces use different names for assignee ("Assignee",
        // "Participants"…) and different status option sets
        // (Complete/Blocked vs. Done/Upcoming), so we detect them once
        // at discovery and carry the results on the pairing.
        const meta = await this.fetchTasksDbMeta(tasksDbId, warnings);

        pairings.push({
          label,
          tasksDbId,
          workSessionDbId: db.id,
          taskRelationName: "Task",
          statusOptions: meta.statusOptions,
          assigneePropertyName: meta.assigneePropertyName,
          statusPropertyName: meta.statusPropertyName,
          completedStatusNames: meta.completedStatusNames,
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
        ): Promise<{
          tasks: TaskItem[];
          /** Parallel to `tasks`: the Client relation id for each task, or null. */
          clientIds: (string | null)[];
          error: TaskQueryError | null;
        }> => {
          try {
            // Type filter is applied client-side because the property name
            // differs across teamspaces ("Type" vs "Task Type"). Assignee
            // + Status filter clauses are built per pairing using the
            // actual property names discovered on that DB.
            const filter = buildTaskFilter(pairing, assigneeId);
            const params: QueryDatabaseParameters = {
              database_id: pairing.tasksDbId,
              page_size: 100,
              // Not every Tasks DB has a "Due" property — omit the sort
              // when there is none, rather than 400-ing the whole query.
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

            const mapped = results.map((page) =>
              mapPageToTaskItem(page, pairing),
            );
            return {
              tasks: mapped.map((m) => m.item),
              clientIds: mapped.map((m) => m.clientRelationId),
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
              tasks: [] as TaskItem[],
              clientIds: [] as (string | null)[],
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

    // Resolve every Client-relation id across all teamspaces in one batch.
    // Unique-deduped inside resolvePageTitles so we only hit Notion once
    // per distinct client, not once per task.
    const allClientIds = perPairing.flatMap((p) =>
      p.clientIds.filter((id): id is string => !!id),
    );
    const clientNameById =
      allClientIds.length > 0
        ? await this.resolvePageTitles(allClientIds)
        : new Map<string, string | null>();

    // Re-walk per pairing so task[i] and clientIds[i] line up correctly.
    const tasksWithClient: TaskItem[] = [];
    for (const { tasks, clientIds } of perPairing) {
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const clientId = clientIds[i];
        tasksWithClient.push({
          ...task,
          clientName: clientId ? clientNameById.get(clientId) ?? null : null,
        });
      }
    }

    const filtered =
      typeFilter.length === 0
        ? tasksWithClient
        : (() => {
            const allowed = new Set<string>(typeFilter);
            return tasksWithClient.filter(
              (t) => t.type !== null && allowed.has(t.type),
            );
          })();

    return { tasks: filtered, errors };
  }

  /**
   * Inspect a Tasks DB and pull out the bits of schema the app needs to
   * filter, render and mutate safely. Designed to be called during Discover
   * and again during silent migration for pairings saved before these
   * fields existed.
   */
  async fetchTasksDbMeta(
    tasksDbId: string,
    warnings: string[],
  ): Promise<{
    statusOptions: StatusOption[];
    completedStatusNames: string[];
    statusPropertyName: string | null;
    assigneePropertyName: string | null;
  }> {
    try {
      const db = (await this.client.databases.retrieve({
        database_id: tasksDbId,
      })) as DatabaseObjectResponse;
      const props = db.properties ?? {};

      // Status: find by type. Grab options (with their colors so the UI
      // can match Notion's native dot) + whatever Notion considers the
      // "complete" group so we can exclude finished tasks regardless of
      // what they're named in this DB.
      let statusOptions: StatusOption[] = [];
      let completedStatusNames: string[] = [];
      let statusPropertyName: string | null = null;
      for (const [name, prop] of Object.entries(props)) {
        if (prop.type === "status") {
          statusPropertyName = name;
          statusOptions = prop.status.options.map((o) => ({
            name: o.name,
            color: normalizeColor(o.color),
          }));
          const groups = (
            prop.status as unknown as {
              groups?: Array<{ name?: string; option_ids?: string[] }>;
            }
          ).groups;
          if (Array.isArray(groups)) {
            const completeGroup = groups.find(
              (g) => (g.name ?? "").toLowerCase() === "complete",
            );
            if (completeGroup && Array.isArray(completeGroup.option_ids)) {
              const idSet = new Set(completeGroup.option_ids);
              completedStatusNames = prop.status.options
                .filter((o) => idSet.has(o.id))
                .map((o) => o.name);
            }
          }
          break;
        }
      }

      // Assignee: prefer a person-type property with a common name,
      // otherwise fall back to the first person-type property in the DB.
      const PREFERRED = [
        "assignee",
        "assigned to",
        "owner",
        "responsible",
        "participants",
      ];
      let assigneePropertyName: string | null = null;
      const personProps: string[] = [];
      for (const [name, prop] of Object.entries(props)) {
        if (prop.type === "people") personProps.push(name);
      }
      for (const candidate of PREFERRED) {
        const match = personProps.find((n) => n.toLowerCase() === candidate);
        if (match) {
          assigneePropertyName = match;
          break;
        }
      }
      if (!assigneePropertyName && personProps.length > 0) {
        assigneePropertyName = personProps[0];
      }

      return {
        statusOptions,
        completedStatusNames,
        statusPropertyName,
        assigneePropertyName,
      };
    } catch (err) {
      warnings.push(
        `Could not read schema for tasks DB ${tasksDbId}: ${describeError(err)}`,
      );
      return {
        statusOptions: [],
        completedStatusNames: [],
        statusPropertyName: null,
        assigneePropertyName: null,
      };
    }
  }

  /**
   * @deprecated Kept for the silent-migration path in main.ts; prefer
   * `fetchTasksDbMeta` for new callers.
   */
  async fetchStatusOptions(
    tasksDbId: string,
    warnings: string[],
  ): Promise<StatusOption[]> {
    return (await this.fetchTasksDbMeta(tasksDbId, warnings)).statusOptions;
  }

  /**
   * Resolve a list of Notion page IDs to their title text. Used to turn
   * a Client relation (just an ID) into the client's actual name.
   * Fetches pages in parallel; missing/inaccessible IDs map to null.
   */
  async resolvePageTitles(pageIds: string[]): Promise<Map<string, string | null>> {
    const unique = Array.from(new Set(pageIds.filter(Boolean)));
    const entries = await Promise.all(
      unique.map(async (id): Promise<[string, string | null]> => {
        try {
          const page = await this.client.pages.retrieve({ page_id: id });
          if ("properties" in page) {
            for (const prop of Object.values(page.properties)) {
              if (prop.type === "title") {
                const title = prop.title
                  .map((t) => t.plain_text)
                  .join("")
                  .trim();
                return [id, title || null];
              }
            }
          }
          return [id, null];
        } catch {
          return [id, null];
        }
      }),
    );
    return new Map(entries);
  }

  async updateTaskStatus(taskId: string, statusName: string): Promise<void> {
    await this.client.pages.update({
      page_id: taskId,
      properties: {
        Status: { status: { name: statusName } },
      } as unknown as Parameters<typeof this.client.pages.update>[0]["properties"],
    });
  }

  /**
   * Sum the duration of every Work Session created today across all
   * configured pairings for the given user. Computes duration locally
   * from Start/End ISO strings so we don't depend on the DB's formula
   * (which might return a string, number, or be misnamed).
   *
   * Returns seconds. Callers should fold this into local stats so
   * today's total reflects sessions tracked from any device or from
   * the Notion UI itself, not just sessions saved through this app.
   */
  async fetchTodaySessionsSeconds(
    pairings: DbPairing[],
    teamMemberId: string | null,
  ): Promise<number> {
    if (pairings.length === 0) return 0;
    const startOfToday = startOfTodayIso();
    const perPairing = await Promise.all(
      pairings.map(async (pairing) => {
        try {
          const andClauses: unknown[] = [
            {
              property: "Start Time",
              date: { on_or_after: startOfToday },
            },
          ];
          if (teamMemberId) {
            // Include sessions without Team Member set too — Notion
            // automations (e.g. the Start button on a task) don't
            // always populate the person property, and we don't want
            // to drop those off today's total.
            andClauses.push({
              or: [
                {
                  property: "Team Member",
                  people: { contains: teamMemberId },
                },
                {
                  property: "Team Member",
                  people: { is_empty: true },
                },
              ],
            });
          }
          const filter = { and: andClauses } as QueryDatabaseParameters["filter"];
          let total = 0;
          let cursor: string | undefined;
          do {
            const res = await this.client.databases.query({
              database_id: pairing.workSessionDbId,
              filter,
              page_size: 100,
              start_cursor: cursor,
            });
            for (const r of res.results) {
              if (!("properties" in r)) continue;
              const page = r as PageObjectResponse;
              const startProp = page.properties["Start Time"];
              const endProp = page.properties["End Time"];
              if (
                startProp?.type === "date" &&
                startProp.date &&
                endProp?.type === "date" &&
                endProp.date
              ) {
                const s = Date.parse(startProp.date.start);
                const e = Date.parse(endProp.date.start);
                if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
                  total += Math.floor((e - s) / 1000);
                }
              }
            }
            cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
          } while (cursor);
          return total;
        } catch (err) {
          console.warn(
            `fetchTodaySessionsSeconds failed for ${pairing.label}:`,
            err,
          );
          return 0;
        }
      }),
    );
    return perPairing.reduce((a, b) => a + b, 0);
  }

  /**
   * Return up to `limit` tasks the user has recently tracked, deduplicated
   * by taskId, newest first. Draws from each pairing's Work Sessions DB,
   * follows the Task relation, resolves titles + client names in bulk.
   *
   * Useful for the Recent dropdown so floating tasks that don't meet the
   * main list's filter still show up.
   */
  async fetchRecentTasks(
    pairings: DbPairing[],
    teamMemberId: string | null,
    limit: number,
  ): Promise<
    Array<{
      taskId: string;
      title: string;
      teamspace: string;
      workSessionDbId: string;
      tasksDbId: string;
      taskRelationName: string;
      clientName: string | null;
      lastTrackedAt: string;
      timeTrackedMin: number | null;
    }>
  > {
    if (pairings.length === 0) return [];

    interface RawEntry {
      taskId: string;
      pairing: DbPairing;
      lastTrackedAt: string;
    }
    const raw: RawEntry[] = [];

    await Promise.all(
      pairings.map(async (pairing) => {
        try {
          const params: QueryDatabaseParameters = {
            database_id: pairing.workSessionDbId,
            page_size: Math.min(100, limit * 3),
            sorts: [{ property: "Start Time", direction: "descending" }],
          };
          if (teamMemberId) {
            // Match sessions tagged to the user OR sessions where
            // Team Member wasn't populated by whichever automation
            // created them. Misses shared sessions assigned to
            // someone else, which is the point.
            params.filter = {
              or: [
                {
                  property: "Team Member",
                  people: { contains: teamMemberId },
                },
                {
                  property: "Team Member",
                  people: { is_empty: true },
                },
              ],
            } as QueryDatabaseParameters["filter"];
          }
          const res = await this.client.databases.query(params);
          for (const r of res.results) {
            if (!("properties" in r)) continue;
            const page = r as PageObjectResponse;
            const taskProp = page.properties["Task"];
            if (
              taskProp?.type !== "relation" ||
              !Array.isArray(taskProp.relation) ||
              taskProp.relation.length === 0
            )
              continue;
            const startProp = page.properties["Start Time"];
            const when =
              startProp?.type === "date" && startProp.date
                ? startProp.date.start
                : page.created_time;
            raw.push({
              taskId: taskProp.relation[0].id,
              pairing,
              lastTrackedAt: when,
            });
          }
        } catch (err) {
          console.warn(`fetchRecentTasks failed for ${pairing.label}:`, err);
        }
      }),
    );

    // Dedup by taskId keeping the most-recent lastTrackedAt.
    const byTask = new Map<string, RawEntry>();
    for (const entry of raw) {
      const existing = byTask.get(entry.taskId);
      if (!existing || entry.lastTrackedAt > existing.lastTrackedAt) {
        byTask.set(entry.taskId, entry);
      }
    }
    const sorted = Array.from(byTask.values())
      .sort((a, b) => b.lastTrackedAt.localeCompare(a.lastTrackedAt))
      .slice(0, limit);

    // Resolve task titles + whatever Client relation each has.
    const titleById = await this.resolvePageTitles(
      sorted.map((s) => s.taskId),
    );

    // For each unique task we want two bits of metadata off the page:
    //   - the Client / Brand relation (so the dropdown can show the
    //     brand name next to the teamspace),
    //   - the `Time Tracked` formula (so the dropdown can show how
    //     long the user has worked on the task in total).
    // Both come from the same page, so fetch once per taskId.
    const clientByTask = new Map<string, string | null>();
    const timeTrackedByTask = new Map<string, number | null>();
    await Promise.all(
      sorted.map(async (s) => {
        try {
          const page = await this.client.pages.retrieve({ page_id: s.taskId });
          if (!("properties" in page)) return;
          const props = (page as PageObjectResponse).properties;

          // Client / Brand
          for (const name of CLIENT_RELATION_NAMES) {
            const p = props[name];
            if (
              p?.type === "relation" &&
              Array.isArray(p.relation) &&
              p.relation.length > 0
            ) {
              const clientTitles = await this.resolvePageTitles([
                p.relation[0].id,
              ]);
              clientByTask.set(
                s.taskId,
                clientTitles.get(p.relation[0].id) ?? null,
              );
              break;
            }
          }

          // Time Tracked — handles both number-formula and HH:MM:SS
          // string-formula shapes (same split as mapPageToTaskItem).
          const ttProp = props["Time Tracked"];
          if (ttProp && ttProp.type === "formula") {
            if (
              ttProp.formula.type === "number" &&
              ttProp.formula.number !== null
            ) {
              timeTrackedByTask.set(s.taskId, ttProp.formula.number);
            } else if (
              ttProp.formula.type === "string" &&
              ttProp.formula.string
            ) {
              timeTrackedByTask.set(
                s.taskId,
                parseHmsToMinutes(ttProp.formula.string),
              );
            }
          }
        } catch {
          /* ignored */
        }
      }),
    );

    return sorted.map((s) => ({
      taskId: s.taskId,
      title: titleById.get(s.taskId) ?? "(untitled)",
      teamspace: s.pairing.label,
      workSessionDbId: s.pairing.workSessionDbId,
      tasksDbId: s.pairing.tasksDbId,
      taskRelationName: s.pairing.taskRelationName,
      clientName: clientByTask.get(s.taskId) ?? null,
      lastTrackedAt: s.lastTrackedAt,
      timeTrackedMin: timeTrackedByTask.get(s.taskId) ?? null,
    }));
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
  pairing: DbPairing,
  assigneeId: string | null,
): QueryDatabaseParameters["filter"] | undefined {
  const clauses: NonNullable<QueryDatabaseParameters["filter"]>[] = [];

  // Only add the assignee clause when the DB actually has a person property
  // for it — otherwise the query 400s with "Could not find property".
  if (assigneeId && pairing.assigneePropertyName) {
    clauses.push({
      property: pairing.assigneePropertyName,
      people: { contains: assigneeId },
    });
  }

  // Exclude whatever this DB considers its "complete" statuses (e.g.
  // Complete + Blocked for Company; Done for L10). Falls back to a sane
  // hardcoded list only if the pairing was saved without the metadata.
  const excluded =
    pairing.completedStatusNames.length > 0
      ? pairing.completedStatusNames
      : EXCLUDED_STATUSES;
  const statusProp = pairing.statusPropertyName ?? "Status";
  for (const value of excluded) {
    clauses.push({
      property: statusProp,
      status: { does_not_equal: value },
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
// The "which brand is this task for" relation has been renamed across
// teamspaces (Client → Brand). Accept both; first hit wins.
const CLIENT_RELATION_NAMES = ["Brand", "Client"];

const NOTION_COLORS: NotionColor[] = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
];

/**
 * Notion returns colors as strings; normalize anything unexpected to
 * "default" so downstream UI code can rely on the narrow union.
 */
function normalizeColor(raw: string | undefined | null): NotionColor {
  if (!raw) return "default";
  const lower = raw.toLowerCase();
  const hit = NOTION_COLORS.find((c) => c === lower);
  return hit ?? "default";
}

function mapPageToTaskItem(
  page: PageObjectResponse,
  pairing: DbPairing,
): { item: TaskItem; clientRelationId: string | null } {
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

  // Status — use the property name discovered for this pairing, falling
  // back to generic "find any status-type property" for backwards compat
  // with pairings saved before we started detecting the name. Capture the
  // color too so the UI can tint the chip to match Notion.
  let status: string | null = null;
  let statusColor: NotionColor | null = null;
  const statusKey = pairing.statusPropertyName ?? "Status";
  const statusProp = props[statusKey];
  if (statusProp && statusProp.type === "status" && statusProp.status) {
    status = statusProp.status.name;
    statusColor = normalizeColor(statusProp.status.color);
  } else if (!pairing.statusPropertyName) {
    for (const prop of Object.values(props)) {
      if (prop.type === "status" && prop.status) {
        status = prop.status.name;
        statusColor = normalizeColor(prop.status.color);
        break;
      }
    }
  }
  // Fall back to looking up the color on the pairing's cached option list
  // if the page response didn't include it for some reason.
  if (status && !statusColor) {
    const match = pairing.statusOptions.find((o) => o.name === status);
    if (match) statusColor = match.color;
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

  // Brand / Client relation ID (the Client teamspace has a relation
  // pointing to the Clients/Brands DB; the property has been named
  // "Client" historically and "Brand" after the 2026-04 rename). We
  // capture the first related page id here; the outer queryTasks()
  // resolves the ID to a display name in bulk.
  let clientRelationId: string | null = null;
  for (const candidate of CLIENT_RELATION_NAMES) {
    const prop = props[candidate];
    if (
      prop &&
      prop.type === "relation" &&
      Array.isArray(prop.relation) &&
      prop.relation.length > 0
    ) {
      clientRelationId = prop.relation[0].id;
      break;
    }
  }

  return {
    item: {
      id: page.id,
      title,
      url: page.url,
      dueDate,
      dueHasTime,
      status,
      statusColor,
      priority,
      type,
      teamspace: pairing.label,
      workSessionDbId: pairing.workSessionDbId,
      taskRelationName: pairing.taskRelationName,
      tasksDbId: pairing.tasksDbId,
      timeEstimateMin,
      timeTrackedMin,
      clientName: null, // filled in later by resolvePageTitles
      statusOptions: pairing.statusOptions ?? [],
    },
    clientRelationId,
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

/**
 * ISO timestamp for 00:00 local-tz of today — Notion's date filter
 * accepts either a date or a datetime, so a full datetime with offset
 * is the safest form.
 */
function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // `toISOString()` would flip to UTC and return the wrong day near
  // midnight in timezones behind UTC. Build the string manually with
  // the current TZ offset preserved.
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offH = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const offM = pad(Math.abs(offsetMinutes) % 60);
  return `${yyyy}-${mm}-${dd}T00:00:00${sign}${offH}:${offM}`;
}

function describeError(err: unknown): string {
  if (err instanceof APIResponseError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
