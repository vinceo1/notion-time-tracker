import { contextBridge, ipcRenderer } from "electron";
import type {
  AppConfig,
  DiscoverResult,
  NotionUser,
  TaskItem,
  WriteSessionInput,
  WriteSessionResult,
} from "./lib/types.js";

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
    tasks: (): Promise<TaskItem[]> => ipcRenderer.invoke("notion:tasks"),
    writeSession: (input: WriteSessionInput): Promise<WriteSessionResult> =>
      ipcRenderer.invoke("notion:writeSession", input),
  },
  queue: {
    size: (): Promise<number> => ipcRenderer.invoke("queue:size"),
    flush: (): Promise<number> => ipcRenderer.invoke("queue:flush"),
    onUpdated: (cb: QueueListener): (() => void) => {
      const listener = (_: unknown, size: number) => cb(size);
      ipcRenderer.on("queue:updated", listener);
      return () => ipcRenderer.removeListener("queue:updated", listener);
    },
  },
  app: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke("app:openExternal", url),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type TimeTrackerApi = typeof api;
