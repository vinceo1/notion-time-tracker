import clsx from "clsx";
import type { TaskBucket } from "../lib/groupTasksByDueDate";
import type { TaskItem } from "../api";
import { TaskCard } from "./TaskCard";

const BUCKET_ACCENTS: Record<string, string> = {
  overdue: "bg-due-overdue",
  today: "bg-due-today",
  tomorrow: "bg-due-soon",
  "this-week": "bg-due-soon",
  later: "bg-due-later",
  none: "bg-due-none",
};

interface Props {
  bucket: TaskBucket;
  activeTaskId: string | null;
  anyTimerActive: boolean;
  onStart: (task: TaskItem) => void;
  onOpenInNotion: (url: string) => void;
}

export function TaskGroup({
  bucket,
  activeTaskId,
  anyTimerActive,
  onStart,
  onOpenInNotion,
}: Props): JSX.Element {
  return (
    <section className="mb-6 last:mb-0">
      <header className="mb-2 flex items-center gap-2 px-1">
        <span
          className={clsx(
            "inline-block h-2 w-2 rounded-full",
            BUCKET_ACCENTS[bucket.key] ?? "bg-white/30",
          )}
        />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/60">
          {bucket.label}
        </h2>
        <span className="text-xs text-white/30">{bucket.tasks.length}</span>
      </header>
      <div className="flex flex-col gap-2">
        {bucket.tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            isActive={task.id === activeTaskId}
            disabled={anyTimerActive}
            onStart={onStart}
            onOpenInNotion={onOpenInNotion}
          />
        ))}
      </div>
    </section>
  );
}
