import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SoftAurora } from "./soft-aurora";

describe("SoftAurora (spec §11.4a, R-L30)", () => {
  it("is three pure-CSS blobs, hidden from assistive tech, with no canvas or WebGL", () => {
    const { container } = render(<SoftAurora />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe("lib-aurora");
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root.querySelectorAll("i")).toHaveLength(3);
    expect(container.querySelector("canvas")).toBeNull();
  });
});
