// Shared types between main/preload/renderer

export type TaskType =
  | "To do List"
  | "Scorecard"
  | "Weekly Report"
  | "Time Tracking Tasks";

export interface NotionUser {
  id: string;
  name: string;
  avatarUrl?: string;
  email?: string;
}

/**
 * Notion's status option palette. Values mirror what the Notion API
 * returns in `property.status.options[].color`.
 */
export type NotionColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export interface StatusOption {
  name: string;
  color: NotionColor;
}

/**
 * A single Tasks DB ↔ Work Sessions DB pairing (one per teamspace).
 * `workSessionDbId` is the database the app will write `Session: ...` pages to.
 * `tasksDbId` is the Tasks database we read open tasks from.
 */
export interface DbPairing {
  /** Human label shown in the UI (e.g. "Company", "Growth") */
  label: string;
  tasksDbId: string;
  workSessionDbId: string;
  /** Relation-property name on Work Sessions that points back to Tasks */
  taskRelationName: string;
  /**
   * Status options on this teamspace's Tasks DB, in Notion's order,
   * each paired with its Notion color so the UI can match the native dot.
   */
  statusOptions: StatusOption[];
  /**
   * Name of the person-type property used as "assignee" in this Tasks DB.
   * Different teamspaces use different names ("Assignee", "Participants",
   * "Owner"…). Null when the DB has no person-type property.
   */
  assigneePropertyName: string | null;
  /**
   * Name of the status-type property. Null when the DB has no status
   * property (rare, but possible).
   */
  statusPropertyName: string | null;
  /**
   * Names of statuses that belong to the "complete" group on the DB
   * (e.g. ["Complete", "Blocked"] for Company/Client, ["Done"] for L10).
   * The task filter excludes these values so finished tasks don't appear
   * in the tracker.
   */
  completedStatusNames: string[];
}

export interface DiscoverResult {
  pairings: DbPairing[];
  warnings: string[];
}

export interface AppConfig {
  notionToken: string;
  teamMemberId: string | null;
  pairings: DbPairing[];
  /** If non-empty, only tasks whose Type is in this list are shown. Empty = all types. */
  typeFilter: TaskType[];
  /** Work Sessions parent page URL (contains the per-teamspace session DBs). */
  workSessionsParentUrl: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  notionToken: "",
  teamMemberId: null,
  pairings: [],
  typeFilter: [],
  workSessionsParentUrl:
    "https://www.notion.so/ecom-wizards/Work-Sessions-3410df49a4a8800fb975c7a979386060",
};

export interface TaskItem {
  id: string;
  title: string;
  url: string;
  /** ISO date (YYYY-MM-DD) or null */
  dueDate: string | null;
  /** Whether the due date has a time component (affects sorting) */
  dueHasTime: boolean;
  status: string | null;
  /** Notion color of the current status, used to tint the chip. */
  statusColor: NotionColor | null;
  priority: "Urgent" | "High" | "Normal" | "Low" | null;
  type: TaskType | null;
  teamspace: string;
  workSessionDbId: string;
  taskRelationName: string;
  tasksDbId: string;
  /** Minutes, from the "Time Estimate (min)" number property. */
  timeEstimateMin: number | null;
  /** Minutes, from the "Time Tracked" formula property. */
  timeTrackedMin: number | null;
  /** Resolved title of the Client relation, when present (Client teamspace only). */
  clientName: string | null;
  /** The Status options available in this task's Tasks DB. */
  statusOptions: StatusOption[];
}

/**
 * Local LRU entry for the "recent tasks" dropdown. Persisted to userData.
 * Only stores the minimum we need to start a timer on the task again
 * without having to query Notion — the surrounding pairing provides the
 * Status options at render time.
 */
export interface RecentTask {
  taskId: string;
  title: string;
  teamspace: string;
  workSessionDbId: string;
  tasksDbId: string;
  taskRelationName: string;
  clientName: string | null;
  lastTrackedAt: string;
}

export interface TodayStats {
  /** ISO date (YYYY-MM-DD) the total belongs to. */
  date: string;
  /** Seconds of finished session time recorded today. */
  totalSeconds: number;
}

export interface WriteSessionInput {
  taskId: string;
  taskTitle: string;
  workSessionDbId: string;
  taskRelationName: string;
  teamMemberId: string | null;
  startIso: string;
  endIso: string;
}

/** Per-teamspace outcome of a task query. */
export interface TaskQueryError {
  teamspace: string;
  tasksDbId: string;
  error: string;
}

/** Combined result of querying tasks across every configured pairing. */
export interface TasksResult {
  tasks: TaskItem[];
  errors: TaskQueryError[];
}

export type WriteSessionResult =
  | { ok: true }
  | { ok: false; queued: true };
