import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "./bottom-sheet";

const sheet = (glass?: boolean) =>
  render(
    <BottomSheet open>
      <BottomSheetContent glass={glass} data-testid="c" aria-describedby={undefined}>
        <BottomSheetHeader title="t" />
      </BottomSheetContent>
    </BottomSheet>,
  );
const classes = (id: string) => screen.getByTestId(id).className.split(/\s+/);

describe("BottomSheetContent (plan 2026-10-15 R-G3)", () => {
  it("keeps the solid sheet by default", () => {
    sheet();
    expect(classes("c")).toEqual(expect.arrayContaining(["inset-x-0", "bottom-0", "rounded-t-sheet", "bg-surface"]));
    expect(classes("c")).not.toContain("glass-sheet");
    expect(classes("sheet-overlay")).toContain("bg-[rgba(17,19,24,0.32)]");
  });
  it("floats a rounded glass card over a light scrim when `glass`", () => {
    sheet(true);
    expect(classes("c")).toEqual(expect.arrayContaining(["glass-sheet", "inset-x-2", "rounded-dock", "pb-4", "z-50", "max-w-screen-sm"]));
    for (const cls of ["bg-surface", "rounded-t-sheet", "inset-x-0", "w-full"]) expect(classes("c")).not.toContain(cls);
    expect(classes("sheet-overlay")).toContain("bg-[color:var(--lookup-scrim)]");
  });
});
