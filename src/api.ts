import type { TimeTrackerApi } from "../electron/preload";

declare global {
  interface Window {
    api: TimeTrackerApi;
  }
}

export const api = window.api;

export type {
  AppConfig,
  DbPairing,
  DiscoverResult,
  NotionUser,
  TaskItem,
  TaskQueryError,
  TasksResult,
  TaskType,
  WriteSessionInput,
  WriteSessionResult,
} from "../electron/lib/types";
export type {
  DownloadProgress,
  UpdateCheckResult,
} from "../electron/lib/updater";
