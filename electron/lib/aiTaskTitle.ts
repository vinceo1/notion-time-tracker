import type { AiMode } from "./types.js";

export interface ParsedAiTaskTitle {
  title: string;
  aiMode: AiMode | null;
}

/**
 * Parse the two optional AI markers used at the start of Notion task titles.
 *
 * The marker remains in Notion; callers use the returned clean title only for
 * display. Requiring whitespace and a non-empty title keeps malformed or
 * incidental bracket text untouched.
 */
export function parseAiTaskTitle(rawTitle: string): ParsedAiTaskTitle {
  const match = rawTitle.match(/^\[(AI|AI review)\]\s+(.+)$/i);
  if (!match) return { title: rawTitle, aiMode: null };

  const title = match[2].trim();
  if (!title) return { title: rawTitle, aiMode: null };

  return {
    title,
    aiMode: match[1].toLowerCase() === "ai review" ? "review" : "ai",
  };
}
