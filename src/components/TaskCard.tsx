import clsx from "clsx";
import { format, isToday, parseISO } from "date-fns";
import { useState } from "react";
import type { TaskItem } from "../api";
import { api } from "../api";

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
  onStart: (task: TaskItem) => void;
  onOpenInNotion: (url: string) => void;
  onStatusChanged: (taskId: string, newStatus: string) => void;
}

export function TaskCard({
  task,
  isActive,
  disabled,
  onStart,
  onOpenInNotion,
  onStatusChanged,
}: Props): JSX.Element {
  const dueLabel = formatDueLabel(task.dueDate, task.dueHasTime);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState(task.status);

  async function handleStatusChange(next: string) {
    if (!next || next === currentStatus) return;
    const previous = currentStatus;
    setCurrentStatus(next); // optimistic
    setStatusBusy(true);
    setStatusError(null);
    const res = await api.notion.updateTaskStatus(task.id, next);
    setStatusBusy(false);
    if (!res.ok) {
      setCurrentStatus(previous); // rollback
      setStatusError(res.error);
      return;
    }
    onStatusChanged(task.id, next);
  }

  return (
    <div
      className={clsx(
        "group card flex items-center gap-3 transition",
        isActive ? "border-white/70 ring-1 ring-white/40" : "hover:border-white/15",
      )}
    >
      <button
        type="button"
        onClick={() => onStart(task)}
        disabled={disabled && !isActive}
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition",
          isActive
            ? "border-white bg-white text-black"
            : "border-bg-border bg-bg-elev text-white/70 hover:border-white/40 hover:text-white disabled:opacity-30",
        )}
        title={isActive ? "Currently tracking" : "Start timer"}
      >
        {isActive ? <PulseDot /> : <PlayIcon />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-medium text-white/90">
            {task.title}
          </div>
          {task.priority ? (
            <span
              className={clsx(
                "pill border",
                PRIORITY_COLORS[task.priority] ?? "",
              )}
            >
              {task.priority}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/50">
          <span className="pill border border-bg-border bg-bg-elev text-white/60">
            {task.teamspace}
          </span>

          <StatusDropdown
            value={currentStatus}
            options={task.statusOptions}
            disabled={statusBusy}
            onChange={handleStatusChange}
          />

          {dueLabel ? <span>· {dueLabel}</span> : null}
          {task.type ? <span>· {task.type}</span> : null}

          {(task.timeEstimateMin !== null || task.timeTrackedMin !== null) && (
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
          )}

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
  options: string[];
  disabled: boolean;
  onChange: (next: string) => void;
}

function StatusDropdown({
  value,
  options,
  disabled,
  onChange,
}: StatusDropdownProps): JSX.Element {
  // If the DB didn't provide options, fall back to a read-only label so we
  // don't show an empty dropdown.
  if (options.length === 0) {
    return value ? <span>· {value}</span> : <span />;
  }
  return (
    <label className="relative inline-flex">
      <select
        className={clsx(
          "appearance-none rounded-full border border-bg-border bg-bg-elev px-2.5 py-0.5 pr-5 text-[10px] font-semibold uppercase tracking-wide text-white/70 transition hover:border-white/30 hover:text-white focus:border-white/40 focus:outline-none",
          disabled && "opacity-60",
        )}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        title="Change status"
      >
        {value && !options.includes(value) ? (
          <option value={value}>{value}</option>
        ) : null}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
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
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function PulseDot(): JSX.Element {
  return (
    <span className="flex h-3 w-3 items-center justify-center">
      <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-red-500 opacity-40" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
    </span>
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
      className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-white/50"
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
