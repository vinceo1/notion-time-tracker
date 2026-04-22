import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NotionClient } from "./lib/notion.js";
import { ConfigStore } from "./lib/storage.js";
import { OfflineQueue } from "./lib/queue.js";
import {
  checkForUpdate,
  downloadAssetToDownloads,
  isSafeAssetUrl,
  type UpdateCheckResult,
} from "./lib/updater.js";
import type {
  AppConfig,
  DbPairing,
  DiscoverResult,
  NotionUser,
  TaskItem,
  TasksResult,
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

// Main-process caches used to validate writes against the last trusted state
// we actually saw, rather than blindly trusting whatever the renderer sends.
//
// - `lastCheckedDownloadUrl` is set by `updater:check` and is the only URL
//   the download IPC will accept afterwards.
// - `lastTasks` is rebuilt on every `notion:tasks` call and lets us verify
//   status updates target a task we actually surfaced to the user.
let lastCheckedDownloadUrl: string | null = null;
let lastTasks: Map<string, TaskItem> = new Map();

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

/** Find the configured pairing for a given work-sessions DB id, or throw. */
function pairingForWorkSessionDb(workSessionDbId: string): DbPairing {
  const match = configStore
    .get()
    .pairings.find((p) => p.workSessionDbId === workSessionDbId);
  if (!match) {
    throw new Error(
      `Refusing to write: target Work Sessions DB ${workSessionDbId} is not in the configured pairings.`,
    );
  }
  return match;
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

  ipcMain.handle("notion:tasks", async (): Promise<TasksResult> => {
    const cfg = configStore.get();
    const client = ensureNotion();

    // Silent migration: some users have config.json entries saved before
    // `statusOptions` existed on DbPairing. Fetch + persist the missing
    // options so the in-app status dropdown lights up on next render.
    const missing = cfg.pairings.filter(
      (p) => !p.statusOptions || p.statusOptions.length === 0,
    );
    if (missing.length > 0) {
      const warnings: string[] = [];
      const refreshed = await Promise.all(
        cfg.pairings.map(async (p) => {
          if (p.statusOptions && p.statusOptions.length > 0) return p;
          try {
            const opts = await client.fetchStatusOptions(p.tasksDbId, warnings);
            return { ...p, statusOptions: opts };
          } catch {
            return p;
          }
        }),
      );
      await configStore.update({ pairings: refreshed });
    }

    const current = configStore.get();
    const result = await client.queryTasks({
      pairings: current.pairings,
      assigneeId: current.teamMemberId,
      typeFilter: current.typeFilter,
    });

    // Cache the tasks we just returned so subsequent writes can be bounded
    // by "you may only touch things we actually showed you".
    lastTasks = new Map(result.tasks.map((t) => [t.id, t]));

    return result;
  });

  ipcMain.handle(
    "notion:writeSession",
    async (_evt, input: WriteSessionInput): Promise<{ ok: true } | { ok: false; queued: true }> => {
      // Validate the target matches a trusted pairing BEFORE any attempt to
      // contact Notion. A compromised / misbehaving renderer could otherwise
      // point the write at an arbitrary database the integration token can
      // reach. We also force the relation-property name to the one stored
      // on the pairing, ignoring whatever the renderer sent.
      let pairing: DbPairing;
      try {
        pairing = pairingForWorkSessionDb(input.workSessionDbId);
      } catch (err) {
        console.warn("Rejected writeSession (unknown pairing):", err);
        throw err; // this is a bug / attack, not a transient failure — don't queue
      }
      // Only accept a task id we actually surfaced in the most recent
      // tasks fetch — this keeps write scope bound to what the user could
      // plausibly have clicked.
      const known = lastTasks.get(input.taskId);
      if (!known || known.workSessionDbId !== pairing.workSessionDbId) {
        const msg = `Refusing to write session for unknown or cross-pairing task ${input.taskId}`;
        console.warn(msg);
        throw new Error(msg);
      }

      const trustedInput: WriteSessionInput = {
        ...input,
        taskTitle: known.title, // re-use the title we saw server-side
        workSessionDbId: pairing.workSessionDbId,
        taskRelationName: pairing.taskRelationName,
      };

      try {
        const client = ensureNotion();
        await client.createWorkSession(trustedInput);
        win?.webContents.send("queue:updated", queue.size());
        return { ok: true };
      } catch (err) {
        console.warn("Notion write failed, queuing:", err);
        await queue.enqueue(trustedInput);
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
      // Only allow status updates on tasks we surfaced in the last fetch,
      // and only to a status value we know that task's DB accepts.
      const known = lastTasks.get(payload.taskId);
      if (!known) {
        return {
          ok: false,
          error:
            "Refusing to update: this task isn't in the current list. Refresh and try again.",
        };
      }
      if (
        known.statusOptions.length > 0 &&
        !known.statusOptions.includes(payload.status)
      ) {
        return {
          ok: false,
          error: `"${payload.status}" is not a valid status for this task's database.`,
        };
      }
      try {
        await ensureNotion().updateTaskStatus(payload.taskId, payload.status);
        // Keep the cache in sync so subsequent writes see the new value.
        lastTasks.set(payload.taskId, { ...known, status: payload.status });
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

  ipcMain.handle("app:version", () => app.getVersion());

  ipcMain.handle("updater:check", async (): Promise<UpdateCheckResult> => {
    const result = await checkForUpdate(
      app.getVersion(),
      process.platform,
      process.arch,
    );
    // Remember the URL the server blessed so the renderer can't ask us to
    // download anything else. Reset to null when there's no update offered.
    lastCheckedDownloadUrl = result.downloadUrl;
    return result;
  });

  ipcMain.handle(
    "updater:download",
    async (
      _evt,
      url: string,
    ): Promise<{ ok: true; filepath: string } | { ok: false; error: string }> => {
      // Two layers of protection:
      //   1. The URL must exactly match the one we received from the last
      //      successful updater:check — prevents the renderer from asking
      //      us to download something we never endorsed.
      //   2. isSafeAssetUrl inside downloadAssetToDownloads enforces an
      //      origin + path allowlist — a belt on top of the braces.
      if (!lastCheckedDownloadUrl || url !== lastCheckedDownloadUrl) {
        return {
          ok: false,
          error:
            "Refusing to download: run Check for updates first so we only fetch the URL GitHub just told us about.",
        };
      }
      if (!isSafeAssetUrl(url)) {
        return {
          ok: false,
          error: "Refusing to download: URL is not a trusted release asset.",
        };
      }
      try {
        const filepath = await downloadAssetToDownloads(url);
        // Reveal the DMG / EXE in Finder / Explorer and open it so the user
        // can drag-to-Applications (Mac) or run the installer (Windows).
        shell.openPath(filepath).catch(() => {});
        return { ok: true, filepath };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? String(err) };
      }
    },
  );
}
