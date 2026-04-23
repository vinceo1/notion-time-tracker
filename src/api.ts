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
  NotionColor,
  NotionUser,
  RecentTask,
  StatusOption,
  TaskItem,
  TaskQueryError,
  TasksResult,
  TaskType,
  TodayStats,
  WriteSessionInput,
  WriteSessionResult,
} from "../electron/lib/types";
export type {
  DownloadProgress,
  UpdateCheckResult,
} from "../electron/lib/updater";
