import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NotionClient } from "./lib/notion.js";
import { ConfigStore } from "./lib/storage.js";
import { OfflineQueue } from "./lib/queue.js";
import type {
  AppConfig,
  DiscoverResult,
  NotionUser,
  TaskItem,
  WriteSessionInput,
} from "./lib/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Built output from Vite lives in ../dist (relative to dist-electron)
process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(process.env.APP_ROOT!, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT!, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null = null;
let configStore: ConfigStore;
let queue: OfflineQueue;
let notion: NotionClient | null = null;

function ensureNotion(): NotionClient {
  const cfg = configStore.get();
  if (!cfg.notionToken) {
    throw new Error("Notion token not configured. Open Settings and add your integration token.");
  }
  if (!notion || notion.token !== cfg.notionToken) {
    notion = new NotionClient(cfg.notionToken);
  }
  return notion;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    // Keep the minimum small enough that the tracker can tuck into a
    // corner of the screen. Settings headings and task rows both read
    // OK down to about 340 px wide.
    minWidth: 340,
    minHeight: 360,
    title: "Notion Time Tracker",
    backgroundColor: "#0b0b0d",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Open external links in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

app.whenReady().then(async () => {
  configStore = new ConfigStore(app.getPath("userData"));
  await configStore.load();

  queue = new OfflineQueue(app.getPath("userData"));
  await queue.load();

  registerIpc();
  createWindow();

  // Try flushing the offline queue on boot (fire-and-forget)
  setTimeout(() => tryFlushQueue().catch(() => {}), 1500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

async function tryFlushQueue(): Promise<void> {
  if (!configStore.get().notionToken) return;
  const client = ensureNotion();
  await queue.flush(async (item) => {
    await client.createWorkSession(item);
  });
  win?.webContents.send("queue:updated", queue.size());
}

function registerIpc(): void {
  ipcMain.handle("config:get", () => configStore.get());

  ipcMain.handle("config:set", async (_evt, patch: Partial<AppConfig>) => {
    await configStore.update(patch);
    // Reset notion client if token changed
    if (patch.notionToken !== undefined) {
      notion = null;
    }
    return configStore.get();
  });

  ipcMain.handle("notion:users", async (): Promise<NotionUser[]> => {
    return ensureNotion().listUsers();
  });

  ipcMain.handle("notion:discover", async (): Promise<DiscoverResult> => {
    return ensureNotion().discoverDatabases();
  });

  ipcMain.handle("notion:tasks", async (): Promise<TaskItem[]> => {
    const cfg = configStore.get();
    return ensureNotion().queryTasks({
      pairings: cfg.pairings,
      assigneeId: cfg.teamMemberId,
      typeFilter: cfg.typeFilter,
    });
  });

  ipcMain.handle(
    "notion:writeSession",
    async (_evt, input: WriteSessionInput): Promise<{ ok: true } | { ok: false; queued: true }> => {
      try {
        const client = ensureNotion();
        await client.createWorkSession(input);
        win?.webContents.send("queue:updated", queue.size());
        return { ok: true };
      } catch (err) {
        console.warn("Notion write failed, queuing:", err);
        await queue.enqueue(input);
        win?.webContents.send("queue:updated", queue.size());
        return { ok: false, queued: true };
      }
    },
  );

  ipcMain.handle(
    "notion:updateTaskStatus",
    async (
      _evt,
      payload: { taskId: string; status: string },
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        await ensureNotion().updateTaskStatus(payload.taskId, payload.status);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? String(err) };
      }
    },
  );

  ipcMain.handle("queue:size", () => queue.size());
  ipcMain.handle("queue:flush", async () => {
    await tryFlushQueue();
    return queue.size();
  });

  ipcMain.handle("app:openExternal", (_evt, url: string) => {
    shell.openExternal(url);
  });
}
