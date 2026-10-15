import { render, screen } from "@testing-library/react";
import { MessagesSquareIcon } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { setLiquid } from "~/test/glass";
import { EmptyState } from "./empty-state";
import { LQ_PANEL, LQ_PRIMARY, LQ_SECONDARY } from "./liquid";
import { ScoreDot, scoreDotClass } from "./score-dot";
import { TOAST_CLASSNAMES } from "./toast-classes";

afterEach(() => setLiquid(false));

describe("liquid vocabulary (plan 2026-10-15-liquid-glass INDEX §5.4)", () => {
  it("constants carry only liquid tokens or self-gated material classes", () => {
    for (const value of [LQ_PANEL, LQ_PRIMARY, LQ_SECONDARY]) {
      for (const token of value.split(/\s+/)) expect(token, value).toMatch(/^(liquid:|mat-|well$|plate$)/);
    }
  });

  it("ScoreDot: green ≥ 85, amber 70–84, nothing below; hidden unless liquid", () => {
    expect(scoreDotClass(92)).toBe("bg-green");
    expect(scoreDotClass(78)).toBe("bg-amber");
    expect(scoreDotClass(64)).toBeNull();
    const { container, rerender } = render(<ScoreDot score={92} />);
    const dot = container.querySelector("[data-score-dot]")!;
    expect(dot.className).toMatch(/\bhidden\b/);
    expect(dot.className).toMatch(/liquid:inline-block/);
    rerender(<ScoreDot score={50} />);
    expect(container.querySelector("[data-score-dot]")).toBeNull();
  });

  it("EmptyState is an E1 panel with a well icon, title, line and action", () => {
    render(<EmptyState icon={MessagesSquareIcon} title="还没有对话" body="选一个角色" action={<button type="button">新对话</button>} testId="empty" />);
    const box = screen.getByTestId("empty");
    expect(box.className).toContain("mat-surface");
    expect(box.querySelector(".well")).not.toBeNull();
    expect(screen.getByText("还没有对话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新对话" })).toBeInTheDocument();
  });

  it("toast classes keep the classic look and add a plate pill without blur", () => {
    expect(TOAST_CLASSNAMES.toast).toContain("!rounded-card");
    expect(TOAST_CLASSNAMES.toast).toContain("liquid:!bg-plate");
    expect(TOAST_CLASSNAMES.toast).toContain("liquid:backdrop-filter-none");
  });
});
