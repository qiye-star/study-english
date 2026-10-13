import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GradualBlur } from "./gradual-blur";

describe("GradualBlur (spec §11.4a, R-L26)", () => {
  it("is a decorative, click-through blur layer", () => {
    const { container } = render(<GradualBlur className="extra" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toMatch(/\blib-gblur\b/);
    expect(el.className).toMatch(/\bextra\b/);
    expect(el).toHaveAttribute("aria-hidden", "true");
  });
});
