import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { LevelHint } from "./level-hint";

describe("LevelHint (plan 2026-10-14-level-annotations R-LV3, R-LV6)", () => {
  beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
  afterEach(async () => { await i18n.changeLanguage("en"); });

  it("shows the meaning of a known level as a block span with the given id", () => {
    render(<LevelHint code="B1" id="lv-hint" />);
    const el = screen.getByTestId("level-hint");
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveAttribute("id", "lv-hint");
    expect(el).toHaveTextContent("能应对大多数日常场景");
    expect(el.className).toMatch(/\bblock\b/);
  });

  it("uses the fallback for unknown or empty codes and renders nothing without one", () => {
    const { container } = render(<LevelHint code="auto" />);
    expect(container).toBeEmptyDOMElement();
    render(<LevelHint code={null} fallback="不选时按你的段位自动定。" testId="lv-fallback" />);
    expect(screen.getByTestId("lv-fallback")).toHaveTextContent("不选时按你的段位自动定。");
  });
});
