import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GlassSurface } from "./glass-surface";

describe("GlassSurface (spec §11.4a)", () => {
  it("renders the glass class, the strong variant and passes props through", () => {
    render(<><GlassSurface data-testid="a">x</GlassSurface><GlassSurface strong as="section" data-testid="b" className="extra">y</GlassSurface></>);
    expect(screen.getByTestId("a").className).toBe("lib-glass");
    expect(screen.getByTestId("a").tagName).toBe("DIV");
    expect(screen.getByTestId("b").tagName).toBe("SECTION");
    expect(screen.getByTestId("b").className).toMatch(/\blib-glass\b/);
    expect(screen.getByTestId("b").className).toMatch(/\blib-glass--strong\b/);
    expect(screen.getByTestId("b").className).toMatch(/\bextra\b/);
  });
});
