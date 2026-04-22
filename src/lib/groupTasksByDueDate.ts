import {
  endOfDay,
  endOfWeek,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
  startOfToday,
} from "date-fns";
import type { TaskItem } from "../api";

export type TaskBucketKey =
  | "overdue"
  | "today"
  | "tomorrow"
  | "this-week"
  | "later"
  | "none";

export interface TaskBucket {
  key: TaskBucketKey;
  label: string;
  tasks: TaskItem[];
}

const ORDER: TaskBucketKey[] = [
  "overdue",
  "today",
  "tomorrow",
  "this-week",
  "later",
  "none",
];

const LABELS: Record<TaskBucketKey, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  "this-week": "This week",
  later: "Later",
  none: "No due date",
};

function bucketFor(task: TaskItem, now: Date): TaskBucketKey {
  if (!task.dueDate) return "none";
  const due = parseISO(task.dueDate);
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 }); // week ends Sunday

  if (isSameDay(due, today)) return "today";
  if (isBefore(endOfDay(due), now)) return "overdue";
  if (isSameDay(due, tomorrow)) return "tomorrow";
  if (isBefore(startOfDay(due), weekEnd)) return "this-week";
  return "later";
}

/**
 * Group tasks into due-date buckets. Each bucket is sorted by:
 *   1. due date ascending (null last),
 *   2. priority (Urgent > High > Normal > Low > null),
 *   3. title asc.
 */
export function groupTasksByDueDate(tasks: TaskItem[]): TaskBucket[] {
  const now = new Date();
  const map = new Map<TaskBucketKey, TaskItem[]>();
  for (const t of tasks) {
    const k = bucketFor(t, now);
    const arr = map.get(k) ?? [];
    arr.push(t);
    map.set(k, arr);
  }
  for (const [, arr] of map) arr.sort(compareTasks);
  return ORDER.filter((k) => map.has(k) && map.get(k)!.length > 0).map(
    (k) => ({ key: k, label: LABELS[k], tasks: map.get(k)! }),
  );
}

const PRIORITY_ORDER: Record<string, number> = {
  Urgent: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};

function compareTasks(a: TaskItem, b: TaskItem): number {
  // Due date asc, nulls last
  const aDue = a.dueDate ? parseISO(a.dueDate).getTime() : Infinity;
  const bDue = b.dueDate ? parseISO(b.dueDate).getTime() : Infinity;
  if (aDue !== bDue) return aDue - bDue;

  const aPri = a.priority ? PRIORITY_ORDER[a.priority] : 4;
  const bPri = b.priority ? PRIORITY_ORDER[b.priority] : 4;
  if (aPri !== bPri) return aPri - bPri;

  return a.title.localeCompare(b.title);
}
