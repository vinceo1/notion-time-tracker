import clsx from "clsx";
import { formatHMS } from "../lib/formatDuration";
import type { PomodoroConfig, TaskItem } from "../api";
import { api } from "../api";

interface Props {
  activeTask: TaskItem | null;
  /** Seconds elapsed in the currently-running session (0 when idle). */
  currentSessionSeconds: number;
  /** Seconds from the current session that belong to today's local date. */
  currentSessionTodaySeconds: number;
  /** Seconds already logged today *before* the current session started. */
  todayBaselineSeconds: number;
  pomodoro: PomodoroConfig;
  pomodoroElapsedSeconds: number;
  isPomodoroRunning: boolean;
  onStartPomodoro: () => void;
  onResetPomodoro: () => void;
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
  currentSessionTodaySeconds,
  todayBaselineSeconds,
  pomodoro,
  pomodoroElapsedSeconds,
  isPomodoroRunning,
  onStartPomodoro,
  onResetPomodoro,
  queuedCount,
  onStop,
  isWriting,
}: Props): JSX.Element {
  const isMac = api.platform === "darwin";
  const todayTotal = todayBaselineSeconds + currentSessionTodaySeconds;
  const pomodoroState = pomodoro.enabled
    ? getPomodoroState(pomodoroElapsedSeconds, pomodoro)
    : null;
  const leftPad = isMac ? MAC_TRAFFIC_LIGHT_PX : 16;
  return (
    <div className="drag-region sticky top-0 z-20 border-b border-bg-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <div
        className="flex items-center gap-2 py-3 pr-3 sm:gap-3 sm:pr-6"
        style={{ paddingLeft: leftPad }}
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
      {pomodoro.enabled && pomodoroState ? (
        <div
          className="no-drag flex items-center gap-3 border-t border-bg-border/70 px-3 py-2 pr-3 sm:pr-6"
          style={{ paddingLeft: leftPad }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={clsx(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                pomodoroState.phase === "focus"
                  ? "border-red-300/30 bg-red-300/10 text-red-200"
                  : "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
              )}
              title="Pomodoro timer"
            >
              <HourglassIcon />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-white/55">
                  Pomodoro · {pomodoroState.label}
                </span>
                <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-white/85">
                  {isPomodoroRunning
                    ? formatPomodoroRemaining(pomodoroState.remainingSeconds)
                    : `${pomodoro.focusMinutes}:00`}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className={clsx(
                    "h-full transition-[width] duration-300",
                    pomodoroState.phase === "focus"
                      ? "bg-red-300"
                      : "bg-emerald-300",
                  )}
                  style={{
                    width: isPomodoroRunning
                      ? `${pomodoroState.progressPct}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          </div>
          {isPomodoroRunning ? (
            <button
              type="button"
              className="btn-ghost shrink-0 px-2 py-1 text-xs"
              onClick={onResetPomodoro}
            >
              Reset
            </button>
          ) : (
            <button
              type="button"
              className="btn shrink-0 px-2 py-1 text-xs"
              onClick={onStartPomodoro}
            >
              Start Pomodoro
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

type PomodoroPhase = "focus" | "short-break" | "long-break";

interface PomodoroState {
  phase: PomodoroPhase;
  label: string;
  remainingSeconds: number;
  progressPct: number;
}

function getPomodoroState(
  elapsedSeconds: number,
  config: PomodoroConfig,
): PomodoroState {
  const focusSeconds = minutesToSeconds(config.focusMinutes, 25);
  const shortBreakSeconds = minutesToSeconds(config.shortBreakMinutes, 5);
  const longBreakSeconds = minutesToSeconds(config.longBreakMinutes, 15);
  const sessionsUntilLongBreak = Math.max(
    1,
    Math.floor(config.sessionsUntilLongBreak || 4),
  );

  let remaining = Math.max(0, elapsedSeconds);
  let focusNumber = 1;

  while (true) {
    if (remaining < focusSeconds) {
      return makePomodoroState(
        "focus",
        `Focus ${focusNumber}`,
        remaining,
        focusSeconds,
      );
    }
    remaining -= focusSeconds;

    const isLongBreak = focusNumber % sessionsUntilLongBreak === 0;
    const breakSeconds = isLongBreak ? longBreakSeconds : shortBreakSeconds;
    if (remaining < breakSeconds) {
      return makePomodoroState(
        isLongBreak ? "long-break" : "short-break",
        isLongBreak ? "Long break" : "Break",
        remaining,
        breakSeconds,
      );
    }

    remaining -= breakSeconds;
    focusNumber += 1;
  }
}

function makePomodoroState(
  phase: PomodoroPhase,
  label: string,
  elapsedInPhase: number,
  phaseSeconds: number,
): PomodoroState {
  const safePhaseSeconds = Math.max(1, phaseSeconds);
  return {
    phase,
    label,
    remainingSeconds: Math.max(0, safePhaseSeconds - elapsedInPhase),
    progressPct: Math.min(
      100,
      Math.max(0, (elapsedInPhase / safePhaseSeconds) * 100),
    ),
  };
}

function minutesToSeconds(value: number, fallback: number): number {
  const minutes = Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.max(60, Math.round(minutes * 60));
}

function formatPomodoroRemaining(seconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function HourglassIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.2a4 4 0 0 0-1.2-2.8L13 12l2.8-3A4 4 0 0 0 17 6.2V2" />
      <path d="M7 2v4.2A4 4 0 0 0 8.2 9L11 12l-2.8 3A4 4 0 0 0 7 17.8V22" />
    </svg>
  );
}
