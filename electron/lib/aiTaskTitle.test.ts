import { describe, expect, it } from "vitest";
import { parseAiTaskTitle } from "./aiTaskTitle.js";

describe("parseAiTaskTitle", () => {
  it.each([
    ["[AI] Prepare brief", "Prepare brief", "ai"],
    ["[AI review] Draft client email", "Draft client email", "ai"],
    ["[ai] Check images", "Check images", "ai"],
    ["[AI REVIEW] Publish copy", "Publish copy", "ai"],
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

  it("maps the retired review marker to the single AI category", () => {
    const current = parseAiTaskTitle("[AI] Draft client email");
    const legacy = parseAiTaskTitle("[AI review] Draft client email");

    expect(current.title).toBe(legacy.title);
    expect(current.aiMode).toBe("ai");
    expect(legacy.aiMode).toBe("ai");
  });
});
