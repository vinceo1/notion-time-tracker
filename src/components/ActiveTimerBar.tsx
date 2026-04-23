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
  /** Called when the user clicks Stop in the top bar. */
  onStop: () => void;
  /** True while the Stop→write round-trip is in flight. */
  isWriting: boolean;
}

// Space reserved on macOS for the hidden-inset traffic-light buttons.
const MAC_TRAFFIC_LIGHT_PX = 78;

export function ActiveTimerBar({
  activeTask,
  currentSessionSeconds,
  todayBaselineSeconds,
  queuedCount,
  onStop,
  isWriting,
}: Props): JSX.Element {
  const isMac = api.platform === "darwin";
  const todayTotal = todayBaselineSeconds + currentSessionSeconds;
  return (
    <div className="drag-region sticky top-0 z-20 border-b border-bg-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <div
        className="flex items-center gap-2 py-3 pr-3 sm:gap-3 sm:pr-6"
        style={{ paddingLeft: isMac ? MAC_TRAFFIC_LIGHT_PX : 16 }}
      >
        {/* Left: task label / idle state */}
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

        {/* Middle: session timer + Stop button (only when a timer is running).
            Needed because tasks picked from the Recent dropdown may have no
            visible card — without a Stop here, the user would be stranded. */}
        {activeTask ? (
          <>
            <div
              className="no-drag shrink-0 text-right leading-tight"
              title="Current session time"
            >
              <div className="text-[9px] uppercase tracking-wider text-white/40">
                Session
              </div>
              <div className="font-mono text-xs font-semibold tabular-nums text-red-200 sm:text-sm">
                {formatHMS(currentSessionSeconds)}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-danger no-drag shrink-0 px-2 py-1 text-xs sm:px-3 sm:py-1.5"
              onClick={onStop}
              disabled={isWriting}
            >
              {isWriting ? "Saving…" : "Stop"}
            </button>
          </>
        ) : null}

        {/* Right: today's total. When active, current session is folded in
            so the number ticks up live. */}
        <div
          className={clsx(
            "shrink-0 text-right leading-tight",
            todayTotal > 0 ? "text-white" : "text-white/30",
          )}
          title={`Today's total tracked time${
            activeTask ? " (including current session)" : ""
          }`}
        >
          <div className="text-[9px] uppercase tracking-wider text-white/40">
            Today
          </div>
          <div className="font-mono text-lg font-semibold tabular-nums tracking-tight sm:text-xl md:text-2xl">
            {formatHMS(todayTotal)}
          </div>
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
