import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { NotionColor, StatusOption } from "../api";
import { NOTION_DOT_CLASSES, NOTION_PILL_CLASSES } from "../lib/notionColors";

interface Props {
  value: string | null;
  valueColor: NotionColor | null;
  options: StatusOption[];
  disabled: boolean;
  onChange: (next: string) => void;
}

/**
 * Custom popover dropdown. Native <select> elements on macOS don't let
 * us style individual <option>s, so we roll our own so each status shows
 * its Notion color on both the closed chip and the open list.
 */
export function StatusPopover({
  value,
  valueColor,
  options,
  disabled,
  onChange,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  if (options.length === 0) {
    return value ? <span>· {value}</span> : <span />;
  }

  const pillClass = valueColor
    ? NOTION_PILL_CLASSES[valueColor]
    : NOTION_PILL_CLASSES.default;

  return (
    <div className="relative inline-flex" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Change status"
        className={clsx(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide outline-none transition",
          pillClass,
          "hover:brightness-110 focus:ring-1 focus:ring-white/30",
          disabled && "opacity-60",
        )}
      >
        <span>{value ?? "—"}</span>
        <ChevronIcon />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-40 mt-1 min-w-[11rem] overflow-hidden rounded-md border border-bg-border bg-bg-surface shadow-xl"
        >
          <ul className="max-h-72 overflow-y-auto py-1">
            {options.map((o) => {
              const selected = o.name === value;
              return (
                <li key={o.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={clsx(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-white/5",
                      selected && "bg-white/[0.03]",
                    )}
                    onClick={() => {
                      setOpen(false);
                      if (o.name !== value) onChange(o.name);
                    }}
                  >
                    <span
                      className={clsx(
                        "inline-block h-2 w-2 shrink-0 rounded-full",
                        NOTION_DOT_CLASSES[o.color],
                      )}
                    />
                    <span className="flex-1 truncate text-white/80">{o.name}</span>
                    {selected ? (
                      <span className="text-[10px] text-white/40">✓</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ChevronIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="9"
      height="9"
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
