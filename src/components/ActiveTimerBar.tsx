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
        className="no-drag flex items-center gap-2 py-3 pr-3 sm:gap-4 sm:pr-6"
        style={{ paddingLeft: isMac ? MAC_TRAFFIC_LIGHT_PX : 16 }}
      >
        <div className="min-w-0 flex-1">
          {activeTask ? (
            <div className="flex flex-col gap-0.5">
              <div className="truncate text-[10px] uppercase tracking-wider text-white/40 sm:text-[11px]">
                Tracking · {activeTask.teamspace}
              </div>
              <div className="truncate text-xs font-medium text-white/90 sm:text-sm">
                {activeTask.title}
              </div>
            </div>
          ) : (
            <div className="truncate text-xs text-white/40 sm:text-sm">
              No active timer
            </div>
          )}
        </div>

        <div
          className={clsx(
            "shrink-0 font-mono text-lg font-semibold tabular-nums tracking-tight sm:text-xl md:text-2xl",
            activeTask ? "text-white" : "text-white/30",
          )}
        >
          {formatHMS(elapsedSeconds)}
        </div>

        {activeTask ? (
          <button
            type="button"
            className="btn btn-danger no-drag shrink-0 px-2 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm"
            onClick={onStop}
            disabled={isWriting}
          >
            {isWriting ? "Saving…" : "Stop"}
          </button>
        ) : null}

        {queuedCount > 0 ? (
          <span
            className="pill no-drag shrink-0 border border-amber-400/40 bg-amber-400/10 text-amber-200"
            title={`${queuedCount} session${queuedCount === 1 ? "" : "s"} couldn't reach Notion and will retry automatically`}
          >
            ● {queuedCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}
