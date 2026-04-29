import { useCallback, useEffect, useState } from "react";
import {
  api,
  type AppConfig,
  type RecentTask,
  type TaskItem,
  type UpdateCheckResult,
} from "./api";
import { ActiveTimerBar } from "./components/ActiveTimerBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { useTimer } from "./hooks/useTimer";
import { SettingsView } from "./pages/SettingsView";
import { TasksView } from "./pages/TasksView";

type View = "loading" | "tasks" | "settings";

interface TimerState {
  task: TaskItem;
  startedAt: number;
}

export default function App(): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [view, setView] = useState<View>("loading");

  // Timer + surrounding state is owned here (not inside TasksView) so
  // opening Settings doesn't unmount the timer and lose the session.
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [isWriting, setIsWriting] = useState<boolean>(false);
  const [queuedCount, setQueuedCount] = useState<number>(0);
  const [todayBaseline, setTodayBaseline] = useState<number>(0);
  const [recents, setRecents] = useState<RecentTask[]>([]);
  const [tasksRefreshKey, setTasksRefreshKey] = useState<number>(0);
  const [topError, setTopError] = useState<string | null>(null);
  const [updateBanner, setUpdateBanner] = useState<UpdateCheckResult | null>(
    null,
  );

  const elapsed = useTimer(timer?.startedAt ?? null, timer !== null);

  // Initial config load.
  useEffect(() => {
    api.config.get().then((cfg) => {
      setConfig(cfg);
      setView(!cfg.notionToken || cfg.pairings.length === 0 ? "settings" : "tasks");
    });
  }, []);

  // Queue size subscription.
  useEffect(() => {
    api.queue.size().then(setQueuedCount).catch(() => {});
    return api.queue.onUpdated(setQueuedCount);
  }, []);

  // Update banner: subscribe to the periodic background check and also
  // ask main for whatever the most recent check produced (so the banner
  // repaints on app reopen without forcing another GitHub round-trip).
  // Suppress the banner once the user dismisses this exact version.
  useEffect(() => {
    let cancelled = false;
    api.updater
      .lastBackgroundResult()
      .then((r) => {
        if (cancelled) return;
        if (r && r.hasUpdate) setUpdateBanner(r);
      })
      .catch(() => {});
    const off = api.updater.onAvailable((r) => {
      if (r.hasUpdate) setUpdateBanner(r);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Today total + recent tasks: primed from disk, then live-updated
  // whenever the main process writes a session or hydrates from Notion.
  useEffect(() => {
    api.stats
      .today()
      .then((t) => setTodayBaseline(t.totalSeconds))
      .catch(() => {});
    api.stats
      .recent()
      .then(setRecents)
      .catch(() => {});
    const offToday = api.stats.onTodayUpdated((t) =>
      setTodayBaseline(t.totalSeconds),
    );
    const offRecent = api.stats.onRecentUpdated(setRecents);
    return () => {
      offToday();
      offRecent();
    };
  }, []);

  const handleStart = useCallback((task: TaskItem) => {
    setTimer({ task, startedAt: Date.now() });
  }, []);

  const handleStop = useCallback(async () => {
    if (!timer || !config) return;
    // Optimistic clear so the UI feels instant — failed Notion writes
    // fall into the offline queue and retry silently.
    const stopped = timer;
    const endedAt = Date.now();
    setTimer(null);
    setIsWriting(true);
    setTopError(null);
    try {
      const result = await api.notion.writeSession({
        taskId: stopped.task.id,
        taskTitle: stopped.task.title,
        workSessionDbId: stopped.task.workSessionDbId,
        taskRelationName: stopped.task.taskRelationName,
        teamMemberId: config.teamMemberId,
        startIso: new Date(stopped.startedAt).toISOString(),
        endIso: new Date(endedAt).toISOString(),
      });
      api.queue.size().then(setQueuedCount).catch(() => {});
      if (!result.ok) {
        setTopError(
          "Couldn't reach Notion — your session was saved locally and will be sent automatically when the connection comes back.",
        );
      }
    } catch (err) {
      setTopError((err as Error).message ?? "Failed to save session");
    } finally {
      setIsWriting(false);
      // Trigger a task-list refetch so Time Tracked on the card
      // reflects the session we just wrote.
      window.setTimeout(() => setTasksRefreshKey((k) => k + 1), 600);
    }
  }, [timer, config]);

  const triggerTasksRefresh = useCallback(() => {
    setTasksRefreshKey((k) => k + 1);
  }, []);

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-white/50">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg text-white">
      {updateBanner ? (
        <UpdateBanner
          result={updateBanner}
          onOpenSettings={() => setView("settings")}
          onDismiss={() => {
            const v = updateBanner.latestVersion;
            setUpdateBanner(null);
            if (v) api.updater.dismissVersion(v).catch(() => {});
          }}
        />
      ) : null}
      <ActiveTimerBar
        activeTask={timer?.task ?? null}
        currentSessionSeconds={elapsed}
        todayBaselineSeconds={todayBaseline}
        queuedCount={queuedCount}
        onStop={handleStop}
        isWriting={isWriting}
      />
      {view === "settings" ? (
        <SettingsView
          config={config}
          hasActiveTimer={timer !== null}
          onStopTimer={handleStop}
          onSaved={(next) => {
            setConfig(next);
            setView("tasks");
          }}
          onClose={() =>
            setView(config.notionToken && config.pairings.length > 0 ? "tasks" : "settings")
          }
        />
      ) : (
        <TasksView
          config={config}
          timer={timer}
          elapsedSeconds={elapsed}
          recents={recents}
          refreshKey={tasksRefreshKey}
          topError={topError}
          onStart={handleStart}
          onStop={handleStop}
          onRefresh={triggerTasksRefresh}
          onOpenSettings={() => setView("settings")}
          onClearTopError={() => setTopError(null)}
        />
      )}
    </div>
  );
}
