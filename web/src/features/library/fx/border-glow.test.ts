import { describe, expect, it } from "vitest";
import { borderGlowClass } from "./border-glow";

describe("BorderGlow (spec §11.4a, R-L29)", () => {
  it("is the flowing-border class only for the active item", () => {
    expect(borderGlowClass(true)).toBe("lib-glow");
    expect(borderGlowClass(false)).toBe("");
  });
});
