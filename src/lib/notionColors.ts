import type { NotionColor } from "../api";

/**
 * Tailwind classes for the filled-pill variant of each Notion color.
 * Tuned to sit on a dark background without blowing out, matching the
 * native Notion status chip look as closely as we can with Tailwind's
 * palette.
 */
export const NOTION_PILL_CLASSES: Record<NotionColor, string> = {
  default: "bg-white/10 text-white/80 border-white/15",
  gray: "bg-zinc-500/20 text-zinc-200 border-zinc-500/30",
  brown: "bg-amber-900/25 text-amber-200 border-amber-800/35",
  orange: "bg-orange-500/20 text-orange-200 border-orange-500/35",
  yellow: "bg-yellow-500/20 text-yellow-100 border-yellow-500/35",
  green: "bg-emerald-500/20 text-emerald-200 border-emerald-500/35",
  blue: "bg-blue-500/20 text-blue-200 border-blue-500/35",
  purple: "bg-purple-500/20 text-purple-200 border-purple-500/35",
  pink: "bg-pink-500/20 text-pink-200 border-pink-500/35",
  red: "bg-red-500/20 text-red-200 border-red-500/35",
};

/** Small colored dot used next to option names inside the dropdown. */
export const NOTION_DOT_CLASSES: Record<NotionColor, string> = {
  default: "bg-white/40",
  gray: "bg-zinc-400",
  brown: "bg-amber-700",
  orange: "bg-orange-400",
  yellow: "bg-yellow-300",
  green: "bg-emerald-400",
  blue: "bg-blue-400",
  purple: "bg-purple-400",
  pink: "bg-pink-400",
  red: "bg-red-400",
};
