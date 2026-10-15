import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GLASS_ATTR } from "~/lib/glass-flag";
import { blurLayers, setLiquid, textOutsidePlates } from "./glass";

describe("glass test helpers (plan 2026-10-15-liquid-glass INDEX §8)", () => {
  afterEach(() => setLiquid(false));

  it("setLiquid toggles the attribute", () => {
    setLiquid(true);
    expect(document.documentElement.getAttribute(GLASS_ATTR)).toBe("v2");
    setLiquid(false);
    expect(document.documentElement.hasAttribute(GLASS_ATTR)).toBe(false);
  });

  it("counts blurring layers and finds loose text on them", () => {
    const { container } = render(
      <div>
        <header className="mat-chrome-bar"><h1 data-glass-title>Title</h1><p>loose subtitle</p><span className="sr-only">ok</span></header>
        <div className="mat-chrome"><div className="plate">on a plate</div><svg><text>icon</text></svg></div>
        <div className="mat-surface">no blur</div>
      </div>,
    );
    expect(blurLayers(container)).toHaveLength(2);
    expect(textOutsidePlates(container.querySelector(".mat-chrome-bar")!)).toEqual(["loose subtitle"]);
    expect(textOutsidePlates(container.querySelector(".mat-chrome")!)).toEqual([]);
  });
});
