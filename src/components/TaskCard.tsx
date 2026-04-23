import clsx from "clsx";
import { format, isToday, parseISO } from "date-fns";
import { useState } from "react";
import type { NotionColor, StatusOption, TaskItem } from "../api";
import { api } from "../api";
import { formatHMS } from "../lib/formatDuration";
import { NOTION_DOT_CLASSES, NOTION_PILL_CLASSES } from "../lib/notionColors";

const PRIORITY_COLORS: Record<string, string> = {
  Urgent: "text-red-300 bg-red-500/10 border-red-500/30",
  High: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  Normal: "text-sky-300 bg-sky-500/10 border-sky-500/30",
  Low: "text-zinc-400 bg-zinc-500/10 border-zinc-500/30",
};

interface Props {
  task: TaskItem;
  isActive: boolean;
  disabled: boolean;
  /** Live seconds since the timer started. Null when this task isn't active. */
  elapsedSeconds: number | null;
  onStart: (task: TaskItem) => void;
  onStop: () => void;
  onOpenInNotion: (url: string) => void;
  onStatusChanged: (taskId: string, newStatus: string) => void;
}

export function TaskCard({
  task,
  isActive,
  disabled,
  elapsedSeconds,
  onStart,
  onStop,
  onOpenInNotion,
  onStatusChanged,
}: Props): JSX.Element {
  const dueLabel = formatDueLabel(task.dueDate, task.dueHasTime);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState(task.status);
  const [currentStatusColor, setCurrentStatusColor] = useState<NotionColor | null>(
    task.statusColor,
  );

  async function handleStatusChange(next: string) {
    if (!next || next === currentStatus) return;
    const previous = currentStatus;
    const previousColor = currentStatusColor;
    const match = task.statusOptions.find((o) => o.name === next);
    setCurrentStatus(next); // optimistic
    setCurrentStatusColor(match?.color ?? null);
    setStatusBusy(true);
    setStatusError(null);
    const res = await api.notion.updateTaskStatus(task.id, next);
    setStatusBusy(false);
    if (!res.ok) {
      setCurrentStatus(previous); // rollback
      setCurrentStatusColor(previousColor);
      setStatusError(res.error);
      return;
    }
    onStatusChanged(task.id, next);
  }

  function handleToggle() {
    if (isActive) onStop();
    else onStart(task);
  }

  // "Growth · DermaWlosy" when both are present; otherwise whichever we have.
  const contextLabel = [task.clientName, task.teamspace]
    .filter((x) => !!x)
    .join(" · ");

  return (
    <div
      className={clsx(
        "group card flex items-center gap-3 transition",
        isActive
          ? "border-red-400/70 ring-1 ring-red-400/30"
          : "hover:border-white/15",
      )}
    >
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        aria-label={isActive ? "Stop timer" : "Start timer"}
        title={isActive ? "Stop timer" : "Start timer"}
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition",
          isActive
            ? "border-red-400 bg-red-500/90 text-white hover:bg-red-500"
            : "border-bg-border bg-bg-elev text-white/70 hover:border-white/40 hover:text-white disabled:opacity-30",
        )}
      >
        {isActive ? <StopSquare /> : <PlayIcon />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">
            {task.title}
          </div>
          {isActive ? (
            <span className="pill shrink-0 border border-red-400/50 bg-red-500/15 text-red-200">
              ● REC
            </span>
          ) : null}
          {task.priority ? (
            <span
              className={clsx(
                "pill shrink-0 border",
                PRIORITY_COLORS[task.priority] ?? "",
              )}
            >
              {task.priority}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/50">
          <StatusDropdown
            value={currentStatus}
            valueColor={currentStatusColor}
            options={task.statusOptions}
            disabled={statusBusy}
            onChange={handleStatusChange}
          />

          {dueLabel ? <span>· {dueLabel}</span> : null}

          {isActive && elapsedSeconds !== null ? (
            <span className="flex items-center gap-1 font-mono tabular-nums text-red-200">
              ·
              <ClockIcon />
              <span className="font-semibold">
                {formatHMS(elapsedSeconds)}
              </span>
              {task.timeEstimateMin !== null ? (
                <span className="text-white/30">
                  {" / "}
                  {formatMinutes(task.timeEstimateMin)}
                </span>
              ) : null}
            </span>
          ) : task.timeEstimateMin !== null || task.timeTrackedMin !== null ? (
            <span className="flex items-center gap-1 text-white/40">
              ·
              <ClockIcon />
              <span>
                {formatMinutes(task.timeTrackedMin)}
                {task.timeEstimateMin !== null ? (
                  <span className="text-white/30">
                    {" / "}
                    {formatMinutes(task.timeEstimateMin)}
                  </span>
                ) : null}
              </span>
            </span>
          ) : null}

          {contextLabel ? (
            <span className="text-white/40">· {contextLabel}</span>
          ) : null}

          {statusError ? (
            <span className="text-red-300" title={statusError}>
              · status save failed
            </span>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        className="btn-ghost opacity-0 transition group-hover:opacity-100 no-drag"
        onClick={() => onOpenInNotion(task.url)}
        title="Open in Notion"
      >
        <ExternalIcon />
      </button>
    </div>
  );
}

interface StatusDropdownProps {
  value: string | null;
  valueColor: NotionColor | null;
  options: StatusOption[];
  disabled: boolean;
  onChange: (next: string) => void;
}

function StatusDropdown({
  value,
  valueColor,
  options,
  disabled,
  onChange,
}: StatusDropdownProps): JSX.Element {
  if (options.length === 0) {
    return value ? <span>· {value}</span> : <span />;
  }
  const pillClass = valueColor
    ? NOTION_PILL_CLASSES[valueColor]
    : NOTION_PILL_CLASSES.default;
  return (
    <label className="relative inline-flex">
      <select
        className={clsx(
          "appearance-none rounded-full border px-2.5 py-0.5 pr-5 text-[10px] font-semibold uppercase tracking-wide outline-none transition",
          pillClass,
          "hover:brightness-110 focus:ring-1 focus:ring-white/30",
          disabled && "opacity-60",
        )}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        title="Change status"
      >
        {value && !options.some((o) => o.name === value) ? (
          <option value={value}>{value}</option>
        ) : null}
        {options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.name}
          </option>
        ))}
      </select>
      <ChevronIcon />
    </label>
  );
}

function formatDueLabel(dueDate: string | null, hasTime: boolean): string | null {
  if (!dueDate) return null;
  const d = parseISO(dueDate);
  if (isToday(d)) {
    return hasTime ? `Today · ${format(d, "HH:mm")}` : "Today";
  }
  return format(d, hasTime ? "EEE d MMM · HH:mm" : "EEE d MMM");
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded}m`;
  const hours = Math.floor(rounded / 60);
  const remMin = rounded % 60;
  if (remMin === 0) return `${hours}h`;
  return `${hours}h ${remMin}m`;
}

function PlayIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function StopSquare(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function ExternalIcon(): JSX.Element {
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
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function ChevronIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-70"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ClockIcon(): JSX.Element {
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
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// NOTION_DOT_CLASSES is exposed in case a future dropdown variant renders
// dots next to option names; kept in the import list so linting surfaces
// if the dot classes themselves fall out of sync with the color union.
void NOTION_DOT_CLASSES;
