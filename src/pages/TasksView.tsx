import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type AppConfig, type TaskItem } from "../api";
import { ActiveTimerBar } from "../components/ActiveTimerBar";
import { TaskGroup } from "../components/TaskGroup";
import { groupTasksByDueDate } from "../lib/groupTasksByDueDate";
import { useTimer } from "../hooks/useTimer";

interface Props {
  config: AppConfig;
  onOpenSettings: () => void;
}

interface TimerState {
  task: TaskItem;
  startedAt: number;
}

export function TasksView({ config, onOpenSettings }: Props): JSX.Element {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [isWriting, setIsWriting] = useState<boolean>(false);
  const [queuedCount, setQueuedCount] = useState<number>(0);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const elapsed = useTimer(timer?.startedAt ?? null, timer !== null);

  const groups = useMemo(() => groupTasksByDueDate(tasks), [tasks]);

  // Load tasks
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.notion
      .tasks()
      .then((list) => {
        if (cancelled) return;
        setTasks(list);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, config.teamMemberId, config.typeFilter, config.pairings]);

  // Load queue size + subscribe to updates
  useEffect(() => {
    api.queue.size().then(setQueuedCount).catch(() => {});
    return api.queue.onUpdated(setQueuedCount);
  }, []);

  const handleStart = useCallback((task: TaskItem) => {
    setTimer({ task, startedAt: Date.now() });
  }, []);

  const handleStop = useCallback(async () => {
    if (!timer) return;
    setIsWriting(true);
    const endedAt = Date.now();
    try {
      const result = await api.notion.writeSession({
        taskId: timer.task.id,
        taskTitle: timer.task.title,
        workSessionDbId: timer.task.workSessionDbId,
        taskRelationName: timer.task.taskRelationName,
        teamMemberId: config.teamMemberId,
        startIso: new Date(timer.startedAt).toISOString(),
        endIso: new Date(endedAt).toISOString(),
      });
      setTimer(null);
      // Refresh queue size in case it was updated
      api.queue.size().then(setQueuedCount).catch(() => {});
      if (!result.ok) {
        setError(
          "Couldn't reach Notion — your session was saved locally and will be sent automatically when the connection comes back.",
        );
      }
    } catch (err) {
      setError((err as Error).message ?? "Failed to save session");
    } finally {
      setIsWriting(false);
    }
  }, [timer, config.teamMemberId]);

  const handleOpenInNotion = useCallback((url: string) => {
    api.app.openExternal(url);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleStatusChanged = useCallback(
    (taskId: string, newStatus: string) => {
      // Optimistically update the in-memory list. If the new status is
      // Complete or Blocked the row will disappear on next refresh.
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
      );
    },
    [],
  );

  return (
    <div className="flex h-full flex-col bg-bg text-white">
      <ActiveTimerBar
        activeTask={timer?.task ?? null}
        elapsedSeconds={elapsed}
        queuedCount={queuedCount}
        onStop={handleStop}
        isWriting={isWriting}
      />

      <div className="flex items-center justify-between border-b border-bg-border bg-bg px-6 py-3">
        <div className="text-xs uppercase tracking-wider text-white/50">
          Your tasks
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh"
          >
            <RefreshIcon spinning={loading} />
            <span className="text-xs">Refresh</span>
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={onOpenSettings}
            title="Settings"
          >
            <GearIcon />
            <span className="text-xs">Settings</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error ? (
          <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading && tasks.length === 0 ? (
          <EmptyState label="Loading tasks…" />
        ) : groups.length === 0 ? (
          <EmptyState
            label={
              config.pairings.length === 0
                ? "No databases connected yet. Open Settings to discover your Work Sessions."
                : "No open tasks assigned to you. Time to breathe."
            }
          />
        ) : (
          groups.map((bucket) => (
            <TaskGroup
              key={bucket.key}
              bucket={bucket}
              activeTaskId={timer?.task.id ?? null}
              anyTimerActive={timer !== null}
              onStart={handleStart}
              onOpenInNotion={handleOpenInNotion}
              onStatusChanged={handleStatusChanged}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }): JSX.Element {
  return (
    <div className="mt-16 flex flex-col items-center justify-center text-white/40">
      <div className="mb-2 text-3xl">⏱</div>
      <div className="text-sm">{label}</div>
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : ""}
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function GearIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
