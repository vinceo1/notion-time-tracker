import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NotionClient } from "./lib/notion.js";
import { ConfigStore } from "./lib/storage.js";
import { installDmgViaDitto } from "./lib/macInstaller.js";
import { OfflineQueue } from "./lib/queue.js";
import { StatsStore } from "./lib/stats.js";
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
  RecentTask,
  StatusOption,
  TaskItem,
  TasksResult,
  TodayStats,
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
let stats: StatsStore;
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

  stats = new StatsStore(app.getPath("userData"));
  await stats.load();

  registerIpc();
  createWindow();

  // Try flushing the offline queue on boot (fire-and-forget)
  setTimeout(() => tryFlushQueue().catch(() => {}), 1500);

  // Hydrate today's total + recent tasks from Notion after the window
  // appears, so the UI reflects sessions tracked elsewhere (phone, the
  // Notion UI itself, another machine). Non-blocking — first paint
  // shows local values, this overwrites them when it resolves.
  setTimeout(() => hydrateFromNotion().catch(() => {}), 500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * Pull today's session total + recent-task list from Notion and merge
 * with whatever we have cached locally. Local stats win when ahead of
 * Notion (you could be mid-session with a write queued), Notion wins
 * when behind (another device added something).
 */
async function hydrateFromNotion(): Promise<void> {
  const cfg = configStore.get();
  if (!cfg.notionToken || cfg.pairings.length === 0) return;
  const client = ensureNotion();

  try {
    const notionSeconds = await client.fetchTodaySessionsSeconds(
      cfg.pairings,
      cfg.teamMemberId,
    );
    const local = stats.getToday();
    if (notionSeconds > local.totalSeconds) {
      const updated = await stats.setTodayTotal(notionSeconds);
      win?.webContents.send("stats:today", updated);
    }
  } catch (err) {
    console.warn("Could not hydrate today total from Notion:", err);
  }

  try {
    const remote = await client.fetchRecentTasks(
      cfg.pairings,
      cfg.teamMemberId,
      20,
    );
    const merged = await stats.mergeRecentFromRemote(remote);
    win?.webContents.send("stats:recent", merged);
  } catch (err) {
    console.warn("Could not hydrate recent tasks from Notion:", err);
  }
}

async function tryFlushQueue(): Promise<void> {
  if (!configStore.get().notionToken) return;
  const client = ensureNotion();
  await queue.flush(async (item) => {
    // Re-validate at flush time: the user may have removed the pairing
    // between enqueue and flush. Writing anyway would put the session in
    // a DB the user no longer thinks is connected.
    const pairing = configStore
      .get()
      .pairings.find((p) => p.workSessionDbId === item.workSessionDbId);
    if (!pairing) {
      throw new Error(
        `Queued session's Work Sessions DB is no longer in the configured pairings; dropping.`,
      );
    }
    const sanitized: WriteSessionInput = {
      ...item,
      workSessionDbId: pairing.workSessionDbId,
      taskRelationName: pairing.taskRelationName,
    };
    await client.createWorkSession(sanitized);
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

    // Silent migration: pairings saved before we started detecting the
    // full per-DB schema (assignee property name, completed-status group,
    // status colors, etc.) can be missing those fields OR have the old
    // string-only statusOptions format. Refetch + backfill so the user
    // doesn't need to click Discover again after an upgrade.
    const needsMigration = cfg.pairings.some((p) => {
      const statusOk =
        Array.isArray(p.statusOptions) &&
        p.statusOptions.length > 0 &&
        // Old string[] format → migrate.
        typeof p.statusOptions[0] === "object";
      return (
        !statusOk ||
        p.assigneePropertyName === undefined ||
        p.statusPropertyName === undefined ||
        !Array.isArray(p.completedStatusNames)
      );
    });
    if (needsMigration) {
      const warnings: string[] = [];
      const refreshed = await Promise.all(
        cfg.pairings.map(async (p) => {
          const statusOk =
            Array.isArray(p.statusOptions) &&
            p.statusOptions.length > 0 &&
            typeof p.statusOptions[0] === "object";
          const hasAll =
            statusOk &&
            p.assigneePropertyName !== undefined &&
            p.statusPropertyName !== undefined &&
            Array.isArray(p.completedStatusNames);
          if (hasAll) return p;
          try {
            const meta = await client.fetchTasksDbMeta(p.tasksDbId, warnings);
            return {
              ...p,
              // Always take Notion's StatusOption[] during migration — the
              // old string[] format lacks colors we now need.
              statusOptions: meta.statusOptions,
              assigneePropertyName:
                p.assigneePropertyName ?? meta.assigneePropertyName,
              statusPropertyName:
                p.statusPropertyName ?? meta.statusPropertyName,
              completedStatusNames: Array.isArray(p.completedStatusNames)
                ? p.completedStatusNames
                : meta.completedStatusNames,
            };
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

    // Cache the tasks we just returned. Status updates (which mutate
    // existing pages) validate against this. Session writes only need
    // to validate the *pairing*, so they don't depend on this cache.
    lastTasks = new Map(result.tasks.map((t) => [t.id, t]));

    return result;
  });

  ipcMain.handle(
    "notion:writeSession",
    async (_evt, input: WriteSessionInput): Promise<{ ok: true } | { ok: false; queued: true }> => {
      // Validate the target matches a trusted pairing BEFORE any attempt
      // to contact Notion. A compromised / misbehaving renderer could
      // otherwise point the write at an arbitrary database the integration
      // token can reach. We also force the relation-property name to the
      // one stored on the pairing, ignoring whatever the renderer sent.
      //
      // We intentionally do NOT require the taskId to appear in the last
      // tasks fetch: users refresh while tracking, and losing an active
      // session to a cache mismatch is worse UX than the residual risk.
      // Notion's own relation validation still rejects tasks that don't
      // belong to the pairing's Tasks DB.
      let pairing: DbPairing;
      try {
        pairing = pairingForWorkSessionDb(input.workSessionDbId);
      } catch (err) {
        console.warn("Rejected writeSession (unknown pairing):", err);
        throw err; // this is a bug / attack, not a transient failure — don't queue
      }

      // Use the cached task title if we still have it (accurate + tamper-
      // resistant); otherwise fall back to whatever the renderer sent.
      const known = lastTasks.get(input.taskId);
      const trustedInput: WriteSessionInput = {
        ...input,
        taskTitle: known?.title ?? input.taskTitle,
        workSessionDbId: pairing.workSessionDbId,
        taskRelationName: pairing.taskRelationName,
      };

      const durationSec = Math.max(
        0,
        Math.floor(
          (new Date(trustedInput.endIso).getTime() -
            new Date(trustedInput.startIso).getTime()) /
            1000,
        ),
      );

      // Regardless of whether the Notion write ends up queued, from the
      // user's perspective they just tracked time, so reflect it in
      // today's total and bump the recent-tasks LRU.
      const newToday = await stats.addSessionSeconds(durationSec);
      win?.webContents.send("stats:today", newToday);

      const knownTask = lastTasks.get(trustedInput.taskId);
      const recentClientName = knownTask?.clientName ?? null;
      // Pre-fill timeTrackedMin with whatever we last saw for this task
      // so the Recent dropdown doesn't temporarily blank it out between
      // a fresh stop and the next Notion rehydrate.
      const existing = stats
        .getRecent()
        .find((r) => r.taskId === trustedInput.taskId);
      const newRecent = await stats.touchRecent({
        taskId: trustedInput.taskId,
        title: trustedInput.taskTitle,
        teamspace: pairing.label,
        workSessionDbId: pairing.workSessionDbId,
        tasksDbId: pairing.tasksDbId,
        taskRelationName: pairing.taskRelationName,
        clientName: recentClientName,
        timeTrackedMin:
          (existing?.timeTrackedMin ?? knownTask?.timeTrackedMin ?? 0) +
          durationSec / 60,
      });
      win?.webContents.send("stats:recent", newRecent);

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
        !known.statusOptions.some((o) => o.name === payload.status)
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

  ipcMain.handle("stats:today", (): TodayStats => stats.getToday());
  ipcMain.handle("stats:recent", (): RecentTask[] => stats.getRecent());
  ipcMain.handle(
    "stats:hydrate",
    async (): Promise<{ today: TodayStats; recent: RecentTask[] }> => {
      await hydrateFromNotion();
      return {
        today: stats.getToday(),
        recent: stats.getRecent(),
      };
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
    ): Promise<
      | { ok: true; filepath: string; installing: boolean }
      | { ok: false; error: string }
    > => {
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
        // Throttle progress events to avoid swamping the IPC bridge on
        // fast connections (chunks arrive every few ms).
        let lastEmit = 0;
        const filepath = await downloadAssetToDownloads(url, {
          onProgress: ({ bytesDownloaded, totalBytes }) => {
            const now = Date.now();
            if (now - lastEmit < 150 && totalBytes && bytesDownloaded < totalBytes) {
              return;
            }
            lastEmit = now;
            win?.webContents.send("updater:progress", {
              bytesDownloaded,
              totalBytes,
            });
          },
        });

        // On macOS, try to install the DMG programmatically (mount
        // via hdiutil, ditto into a staging folder, swap into
        // /Applications from a detached helper after we quit). This
        // bypasses Finder's drag-to-Applications path which trips on
        // -36 ("data could not be read or written") when trying to
        // overwrite the currently-running .app bundle.
        if (process.platform === "darwin") {
          const outcome = await installDmgViaDitto(filepath);
          if (outcome.ok) {
            // Helper script is detached and ticking; quit ourselves in
            // a moment so it can do the swap on unlocked files.
            setTimeout(() => {
              try {
                app.quit();
              } catch {
                /* ignored */
              }
            }, 500);
            return { ok: true, filepath, installing: true };
          }
          console.warn(
            "Programmatic DMG install failed:",
            outcome.error,
          );
          // Surface the error back to the UI instead of silently
          // falling through to Finder (which triggers -36 again).
          // If the user then wants to retry via Finder anyway they
          // can open the DMG manually from ~/Downloads.
          return {
            ok: false,
            error: `Auto-install failed: ${outcome.error ?? "unknown error"}. The DMG is at ${filepath}.`,
          };
        }

        // Non-macOS path: let the OS installer handle it.
        shell.openPath(filepath).catch(() => {});
        return { ok: true, filepath, installing: false };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? String(err) };
      }
    },
  );
}
