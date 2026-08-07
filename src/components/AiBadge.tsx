import clsx from "clsx";
import type { AiMode } from "../api";

const AI_BADGE_STYLES: Record<AiMode, string> = {
  ai: "border-violet-400/30 bg-violet-500/15 text-violet-200",
  review: "border-teal-400/30 bg-teal-500/15 text-teal-200",
};

export function AiBadge({
  aiMode,
}: {
  aiMode: AiMode | null | undefined;
}): JSX.Element | null {
  if (!aiMode) return null;

  return (
    <span
      className={clsx("pill shrink-0 border", AI_BADGE_STYLES[aiMode])}
      title={
        aiMode === "review"
          ? "AI produces the work; human review or action is required"
          : "AI produces the primary deliverable"
      }
    >
      {aiMode === "review" ? "AI · Review" : "AI"}
    </span>
  );
}
