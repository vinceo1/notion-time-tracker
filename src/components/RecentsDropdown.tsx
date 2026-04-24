import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { api, type RecentTask, type TaskItem } from "../api";

interface Props {
  recents: RecentTask[];
  anyTimerActive: boolean;
  onPick: (r: RecentTask) => void;
  /** Pick a full TaskItem (used for search hits outside the recents LRU). */
  onPickTask: (t: TaskItem) => void;
}

/**
 * Small dropdown button in the page header. Lists the last tasks the
 * user tracked (LRU, stored locally) so floating work like "Email" or
 * "Other tasks" — which never get a due date and therefore don't show
 * up in the main task list — can still be time-tracked with one click.
 *
 * Also exposes a free-text search that hits every connected Tasks DB
 * via Notion's search API, so tasks that aren't in the local list or
 * recents (e.g. another teammate's task) can still be tracked.
 */
export function RecentsDropdown({
  recents,
  anyTimerActive,
  onPick,
  onPickTask,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Reset search state and focus the input whenever the dropdown opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setSearchError(null);
    setSearching(false);
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Debounced search. Cancellation flag prevents a slow earlier response
  // from overwriting a newer one.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const handle = window.setTimeout(() => {
      api.notion
        .searchTasks(trimmed)
        .then((hits) => {
          if (cancelled) return;
          setResults(hits);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setSearchError(err.message || String(err));
          setResults([]);
        })
        .finally(() => {
          if (cancelled) return;
          setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  const isSearching = query.trim().length >= 2;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen((v) => !v)}
        title="Recent tasks"
      >
        <HistoryIcon />
        <span className="flex items-center gap-0.5 text-xs">
          Recent
          <ChevronIcon />
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-2 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-bg-border bg-bg-surface shadow-2xl"
        >
          <div className="border-b border-bg-border p-2">
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all connected tasks…"
              className="w-full rounded-md border border-bg-border bg-bg px-3 py-1.5 text-xs text-white/90 placeholder-white/30 focus:border-white/20 focus:outline-none"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {isSearching ? (
            <SearchResults
              query={query.trim()}
              results={results}
              searching={searching}
              error={searchError}
              anyTimerActive={anyTimerActive}
              onPick={(t) => {
                onPickTask(t);
                setOpen(false);
              }}
            />
          ) : (
            <RecentsList
              recents={recents}
              anyTimerActive={anyTimerActive}
              onPick={(r) => {
                onPick(r);
                setOpen(false);
              }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function RecentsList({
  recents,
  anyTimerActive,
  onPick,
}: {
  recents: RecentTask[];
  anyTimerActive: boolean;
  onPick: (r: RecentTask) => void;
}): JSX.Element {
  return (
    <>
      <div className="border-b border-bg-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        Recently tracked
      </div>
      {recents.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-white/40">
          No recent tasks yet. Stop a timer and it'll show up here.
        </div>
      ) : (
        <ul className="max-h-96 overflow-y-auto py-1">
          {recents.map((r) => {
            const context = [r.clientName, r.teamspace]
              .filter(Boolean)
              .join(" · ");
            const lastSession = formatMinutes(r.lastSessionMin);
            const total = formatMinutes(r.timeTrackedMin);
            return (
              <li key={r.taskId}>
                <button
                  type="button"
                  className={clsx(
                    "flex w-full flex-col items-start gap-1 px-4 py-2.5 text-left transition hover:bg-white/5",
                    anyTimerActive && "opacity-60",
                  )}
                  disabled={anyTimerActive}
                  onClick={() => onPick(r)}
                  title={buildTooltip({
                    anyTimerActive,
                    title: r.title,
                    total,
                    lastSession,
                  })}
                >
                  <div className="w-full truncate text-sm text-white/90">
                    {r.title}
                  </div>
                  <div className="flex w-full items-center gap-2 text-[11px] text-white/40">
                    {context ? (
                      <span className="min-w-0 flex-1 truncate">
                        {context}
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1" />
                    )}
                    {lastSession ? (
                      <span
                        className="shrink-0 whitespace-nowrap font-mono tabular-nums text-white/50"
                        title={
                          total
                            ? `Last session: ${lastSession} · Total tracked: ${total}`
                            : `Last session: ${lastSession}`
                        }
                      >
                        ⏱ {lastSession}
                      </span>
                    ) : null}
                    <span className="shrink-0 whitespace-nowrap text-[10px]">
                      {formatRelative(r.lastTrackedAt)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function SearchResults({
  query,
  results,
  searching,
  error,
  anyTimerActive,
  onPick,
}: {
  query: string;
  results: TaskItem[];
  searching: boolean;
  error: string | null;
  anyTimerActive: boolean;
  onPick: (t: TaskItem) => void;
}): JSX.Element {
  return (
    <>
      <div className="flex items-center justify-between border-b border-bg-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        <span>Search results</span>
        {searching ? (
          <span className="normal-case tracking-normal text-white/30">
            Searching…
          </span>
        ) : !error && results.length > 0 ? (
          <span className="normal-case tracking-normal text-white/30">
            {results.length}
          </span>
        ) : null}
      </div>
      {error ? (
        <div className="px-4 py-6 text-center text-xs text-red-300">
          {error}
        </div>
      ) : searching && results.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-white/40">
          Searching Notion for "{query}"…
        </div>
      ) : results.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-white/40">
          No tasks match "{query}".
        </div>
      ) : (
        <ul className="max-h-96 overflow-y-auto py-1">
          {results.map((t) => {
            const context = [t.clientName, t.teamspace]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className={clsx(
                    "flex w-full flex-col items-start gap-1 px-4 py-2.5 text-left transition hover:bg-white/5",
                    anyTimerActive && "opacity-60",
                  )}
                  disabled={anyTimerActive}
                  onClick={() => onPick(t)}
                  title={
                    anyTimerActive
                      ? "Stop the current timer first"
                      : `Start timer on ${t.title}`
                  }
                >
                  <div className="w-full truncate text-sm text-white/90">
                    {t.title}
                  </div>
                  <div className="flex w-full items-center gap-2 text-[11px] text-white/40">
                    {context ? (
                      <span className="min-w-0 flex-1 truncate">
                        {context}
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1" />
                    )}
                    {t.status ? (
                      <span className="shrink-0 whitespace-nowrap text-[10px] text-white/50">
                        {t.status}
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function buildTooltip(opts: {
  anyTimerActive: boolean;
  title: string;
  total: string | null;
  lastSession: string | null;
}): string {
  if (opts.anyTimerActive) return "Stop the current timer first";
  const pieces = [`Start timer on ${opts.title}`];
  if (opts.lastSession) pieces.push(`last session: ${opts.lastSession}`);
  if (opts.total) pieces.push(`total: ${opts.total}`);
  return pieces.join(" · ");
}

function formatMinutes(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}m`;
  const hours = Math.floor(rounded / 60);
  const remMin = rounded % 60;
  if (remMin === 0) return `${hours}h`;
  return `${hours}h ${remMin}m`;
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function HistoryIcon(): JSX.Element {
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
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      <polyline points="12 7 12 12 15 14" />
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
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
