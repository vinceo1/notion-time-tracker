import type { AiMode } from "../api";

export function AiBadge({
  aiMode,
}: {
  aiMode: AiMode | null | undefined;
}): JSX.Element | null {
  if (!aiMode) return null;

  return (
    <span
      className="pill shrink-0 border border-violet-400/30 bg-violet-500/15 text-violet-200"
      title="AI produces the primary deliverable"
    >
      AI
    </span>
  );
}
