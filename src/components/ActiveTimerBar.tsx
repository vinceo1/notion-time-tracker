import clsx from "clsx";
import { formatHMS } from "../lib/formatDuration";
import type { TaskItem } from "../api";
import { api } from "../api";

interface Props {
  activeTask: TaskItem | null;
  /** Seconds elapsed in the currently-running session (0 when idle). */
  currentSessionSeconds: number;
  /** Seconds already logged today *before* the current session started. */
  todayBaselineSeconds: number;
  queuedCount: number;
}

// Space reserved on macOS for the hidden-inset traffic-light buttons.
const MAC_TRAFFIC_LIGHT_PX = 78;

export function ActiveTimerBar({
  activeTask,
  currentSessionSeconds,
  todayBaselineSeconds,
  queuedCount,
}: Props): JSX.Element {
  const isMac = api.platform === "darwin";
  const todayTotal = todayBaselineSeconds + currentSessionSeconds;
  return (
    <div className="drag-region sticky top-0 z-20 border-b border-bg-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <div
        className="flex items-center gap-2 py-3 pr-3 sm:gap-4 sm:pr-6"
        style={{ paddingLeft: isMac ? MAC_TRAFFIC_LIGHT_PX : 16 }}
      >
        <div className="min-w-0 flex-1">
          {activeTask ? (
            <div className="flex flex-col gap-0.5">
              <div className="truncate text-[10px] uppercase tracking-wider text-red-300 sm:text-[11px]">
                ● Tracking · {activeTask.teamspace}
              </div>
              <div className="truncate text-xs font-medium text-white/90 sm:text-sm">
                {activeTask.title}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="truncate text-[10px] uppercase tracking-wider text-white/40 sm:text-[11px]">
                Today
              </div>
              <div className="truncate text-xs text-white/40 sm:text-sm">
                No active timer
              </div>
            </div>
          )}
        </div>

        <div
          className={clsx(
            "shrink-0 text-right font-mono text-lg font-semibold tabular-nums tracking-tight sm:text-xl md:text-2xl",
            todayTotal > 0 ? "text-white" : "text-white/30",
          )}
          title={`Today's total tracked time${
            activeTask ? " (including current session)" : ""
          }`}
        >
          {formatHMS(todayTotal)}
        </div>

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
