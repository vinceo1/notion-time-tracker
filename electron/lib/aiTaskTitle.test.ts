import { describe, expect, it } from "vitest";
import { parseAiTaskTitle } from "./aiTaskTitle.js";

describe("parseAiTaskTitle", () => {
  it.each([
    ["[AI] Prepare brief", "Prepare brief", "ai"],
    ["[AI review] Draft client email", "Draft client email", "review"],
    ["[ai] Check images", "Check images", "ai"],
    ["[AI REVIEW] Publish copy", "Publish copy", "review"],
  ] as const)("parses %s", (raw, title, aiMode) => {
    expect(parseAiTaskTitle(raw)).toEqual({ title, aiMode });
  });

  it.each([
    "Human-led task",
    "[AIish] Research",
    "[AI]No space",
    "[AI review Research",
    "Research [AI] competitors",
    "[AI]   ",
    "[AI review]",
  ])("leaves unprefixed or malformed title unchanged: %s", (raw) => {
    expect(parseAiTaskTitle(raw)).toEqual({ title: raw, aiMode: null });
  });

  it("reflects a category change without changing the deliverable title", () => {
    const before = parseAiTaskTitle("[AI] Draft client email");
    const after = parseAiTaskTitle("[AI review] Draft client email");

    expect(before.title).toBe(after.title);
    expect(before.aiMode).toBe("ai");
    expect(after.aiMode).toBe("review");
  });
});
