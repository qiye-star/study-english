import { describe, expect, it } from "vitest";
import { FIELD, GHOST, PRIMARY } from "./ui";

describe("library button and field classes (D11)", () => {
  it("makes the primary button the specular glass button, not a flat blue one", () => {
    expect(PRIMARY).toContain("lib-spec");
    expect(PRIMARY).not.toContain("bg-blue");
    expect(PRIMARY).toContain("rounded-button");
  });

  it("keeps the ghost button solid and the field 16px so iOS does not zoom, with the glass-sheet field class", () => {
    expect(GHOST).toContain("bg-surface");
    expect(FIELD).toContain("text-[16px]");
    expect(FIELD).toContain("lib-field");
  });
});
