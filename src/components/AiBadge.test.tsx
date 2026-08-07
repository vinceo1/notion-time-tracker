import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiBadge } from "./AiBadge";

describe("AiBadge", () => {
  it("renders the violet AI badge", () => {
    const html = renderToStaticMarkup(<AiBadge aiMode="ai" />);

    expect(html).toContain(">AI</span>");
    expect(html).toContain("violet");
  });

  it("renders the teal review badge", () => {
    const html = renderToStaticMarkup(<AiBadge aiMode="review" />);

    expect(html).toContain("AI · Review");
    expect(html).toContain("teal");
  });

  it("renders nothing for a human-led task", () => {
    expect(renderToStaticMarkup(<AiBadge aiMode={null} />)).toBe("");
  });
});
