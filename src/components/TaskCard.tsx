import clsx from "clsx";
import { format, isToday, parseISO } from "date-fns";
import type { TaskItem } from "../api";

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
}

export function TaskCard({
  task,
  isActive,
  disabled,
  onStart,
  onOpenInNotion,
}: Props): JSX.Element {
  const dueLabel = formatDueLabel(task.dueDate, task.dueHasTime);

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
        <div className="mt-1 flex items-center gap-2 text-[11px] text-white/50">
          <span className="pill border border-bg-border bg-bg-elev text-white/60">
            {task.teamspace}
          </span>
          {task.status ? <span>· {task.status}</span> : null}
          {dueLabel ? <span>· {dueLabel}</span> : null}
          {task.type ? <span>· {task.type}</span> : null}
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

function formatDueLabel(dueDate: string | null, hasTime: boolean): string | null {
  if (!dueDate) return null;
  const d = parseISO(dueDate);
  if (isToday(d)) {
    return hasTime ? `Today · ${format(d, "HH:mm")}` : "Today";
  }
  return format(d, hasTime ? "EEE d MMM · HH:mm" : "EEE d MMM");
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
