import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLiquid } from "~/test/glass";
import { PronunciationBadge } from "./result-badges";

describe("result badges (plan 2026-10-15-liquid-glass R-L5-5)", () => {
  afterEach(() => setLiquid(false));

  it("mono pill with a score dot", () => {
    setLiquid(true);
    render(<PronunciationBadge view={{ status: "done", scores: { pronunciationScore: 91 } } as never} onOpen={vi.fn()} />);
    const badge = screen.getByTestId("badge-pronunciation");
    expect(badge.querySelector("span")!.className).toContain("liquid:bg-wash");
    expect(badge.querySelector("[data-score-dot]")!.className).toContain("bg-green");
  });

  it("no score dot while pending", () => {
    render(<PronunciationBadge view={{ status: "pending" } as never} onOpen={vi.fn()} />);
    expect(screen.getByTestId("badge-pronunciation").querySelector("[data-score-dot]")).toBeNull();
  });
});
