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
  priority: "Urgent" | "High" | "Normal" | "Low" | null;
  type: TaskType | null;
  teamspace: string;
  workSessionDbId: string;
  taskRelationName: string;
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

export type WriteSessionResult =
  | { ok: true }
  | { ok: false; queued: true };
