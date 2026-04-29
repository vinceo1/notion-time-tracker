import { contextBridge, ipcRenderer } from "electron";
import type {
  AppConfig,
  DiscoverResult,
  NotionUser,
  RecentTask,
  TaskItem,
  TasksResult,
  TodayStats,
  WriteSessionInput,
  WriteSessionResult,
} from "./lib/types.js";
import type {
  DownloadProgress,
  UpdateCheckResult,
} from "./lib/updater.js";

type QueueListener = (size: number) => void;

const api = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke("config:get"),
    set: (patch: Partial<AppConfig>): Promise<AppConfig> =>
      ipcRenderer.invoke("config:set", patch),
  },
  notion: {
    listUsers: (): Promise<NotionUser[]> => ipcRenderer.invoke("notion:users"),
    discover: (): Promise<DiscoverResult> => ipcRenderer.invoke("notion:discover"),
    tasks: (): Promise<TasksResult> => ipcRenderer.invoke("notion:tasks"),
    searchTasks: (query: string): Promise<TaskItem[]> =>
      ipcRenderer.invoke("notion:searchTasks", query),
    writeSession: (input: WriteSessionInput): Promise<WriteSessionResult> =>
      ipcRenderer.invoke("notion:writeSession", input),
    updateTaskStatus: (
      taskId: string,
      status: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("notion:updateTaskStatus", { taskId, status }),
  },
  platform: process.platform as NodeJS.Platform,
  queue: {
    size: (): Promise<number> => ipcRenderer.invoke("queue:size"),
    flush: (): Promise<number> => ipcRenderer.invoke("queue:flush"),
    onUpdated: (cb: QueueListener): (() => void) => {
      const listener = (_: unknown, size: number) => cb(size);
      ipcRenderer.on("queue:updated", listener);
      return () => ipcRenderer.removeListener("queue:updated", listener);
    },
  },
  stats: {
    today: (): Promise<TodayStats> => ipcRenderer.invoke("stats:today"),
    recent: (): Promise<RecentTask[]> => ipcRenderer.invoke("stats:recent"),
    hydrate: (): Promise<{ today: TodayStats; recent: RecentTask[] }> =>
      ipcRenderer.invoke("stats:hydrate"),
    onTodayUpdated: (cb: (t: TodayStats) => void): (() => void) => {
      const listener = (_: unknown, t: TodayStats) => cb(t);
      ipcRenderer.on("stats:today", listener);
      return () => ipcRenderer.removeListener("stats:today", listener);
    },
    onRecentUpdated: (cb: (r: RecentTask[]) => void): (() => void) => {
      const listener = (_: unknown, r: RecentTask[]) => cb(r);
      ipcRenderer.on("stats:recent", listener);
      return () => ipcRenderer.removeListener("stats:recent", listener);
    },
  },
  app: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke("app:openExternal", url),
    version: (): Promise<string> => ipcRenderer.invoke("app:version"),
  },
  updater: {
    check: (): Promise<UpdateCheckResult> => ipcRenderer.invoke("updater:check"),
    download: (
      url: string,
    ): Promise<
      | { ok: true; filepath: string; installing: boolean }
      | { ok: false; error: string }
    > => ipcRenderer.invoke("updater:download", url),
    onProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
      const listener = (_: unknown, p: DownloadProgress) => cb(p);
      ipcRenderer.on("updater:progress", listener);
      return () => ipcRenderer.removeListener("updater:progress", listener);
    },
    /**
     * Subscribe to the periodic background update check. Fires whenever
     * a new version is available AND the user hasn't dismissed this
     * exact version. The renderer renders a banner; clicking "Later"
     * calls dismissVersion so we don't notify again until the next bump.
     */
    onAvailable: (cb: (r: UpdateCheckResult) => void): (() => void) => {
      const listener = (_: unknown, r: UpdateCheckResult) => cb(r);
      ipcRenderer.on("updater:available", listener);
      return () => ipcRenderer.removeListener("updater:available", listener);
    },
    /**
     * Returns whatever the most recent background or manual check
     * produced — used to repaint the banner on app boot without a
     * fresh GitHub round-trip.
     */
    lastBackgroundResult: (): Promise<UpdateCheckResult | null> =>
      ipcRenderer.invoke("updater:lastBackgroundResult"),
    /**
     * Persist the version the user just declined so we don't keep
     * nagging them. Pass null to clear the dismissal.
     */
    dismissVersion: (version: string | null): Promise<{ ok: true }> =>
      ipcRenderer.invoke("updater:dismissVersion", version),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type TimeTrackerApi = typeof api;
