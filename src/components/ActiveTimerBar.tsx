import clsx from "clsx";
import { formatHMS } from "../lib/formatDuration";
import type { TaskItem } from "../api";
import { api } from "../api";

interface Props {
  activeTask: TaskItem | null;
  elapsedSeconds: number;
  queuedCount: number;
  onStop: () => void;
  isWriting: boolean;
}

// Space reserved on macOS for the hidden-inset traffic-light buttons.
const MAC_TRAFFIC_LIGHT_PX = 78;

export function ActiveTimerBar({
  activeTask,
  elapsedSeconds,
  queuedCount,
  onStop,
  isWriting,
}: Props): JSX.Element {
  const isMac = api.platform === "darwin";
  return (
    <div className="drag-region sticky top-0 z-20 border-b border-bg-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <div
        className="no-drag flex items-center gap-4 py-3 pr-6"
        style={{ paddingLeft: isMac ? MAC_TRAFFIC_LIGHT_PX : 24 }}
      >
        <div className="flex-1 min-w-0">
          {activeTask ? (
            <div className="flex flex-col gap-0.5">
              <div className="text-[11px] uppercase tracking-wider text-white/40">
                Tracking · {activeTask.teamspace}
              </div>
              <div className="truncate text-sm font-medium text-white/90">
                {activeTask.title}
              </div>
            </div>
          ) : (
            <div className="text-sm text-white/40">No active timer</div>
          )}
        </div>

        <div
          className={clsx(
            "font-mono text-2xl font-semibold tabular-nums tracking-tight",
            activeTask ? "text-white" : "text-white/30",
          )}
        >
          {formatHMS(elapsedSeconds)}
        </div>

        {activeTask ? (
          <button
            type="button"
            className="btn btn-danger no-drag"
            onClick={onStop}
            disabled={isWriting}
          >
            {isWriting ? "Saving…" : "Stop"}
          </button>
        ) : null}

        {queuedCount > 0 ? (
          <span
            className="pill no-drag border border-amber-400/40 bg-amber-400/10 text-amber-200"
            title={`${queuedCount} session${queuedCount === 1 ? "" : "s"} couldn't reach Notion and will retry automatically`}
          >
            ● {queuedCount} queued
          </span>
        ) : null}
      </div>
    </div>
  );
}
