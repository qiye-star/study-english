import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("keeps a custom font-size token together with a colour class", () => {
    expect(cn("text-meta", "text-ink")).toBe("text-meta text-ink");
    expect(cn("text-ink-2", "text-body")).toBe("text-ink-2 text-body");
  });
  it("lets later conflicting classes override", () => {
    expect(cn("text-meta", "text-body")).toBe("text-body");
    expect(cn("text-ink", "text-blue")).toBe("text-blue");
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
