import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "~/i18n";
import { PreviewCard } from "./preview-card";

describe("PreviewCard structure", () => {
  it("is a plain flex column: no absolutely positioned content (nothing can overlap text)", () => {
    const { getByTestId } = render(<PreviewCard />);
    const root = getByTestId("appearance-preview");
    expect(root.className).toContain("flex-col");
    expect(root.querySelectorAll(".absolute")).toHaveLength(0);
  });
});
