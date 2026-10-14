import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BubbleActions } from "./message-bubble";

describe("BubbleActions", () => {
  it("is not text-selectable, so a long-press selection cannot spill into the action row", () => {
    render(<BubbleActions><button>Listen</button></BubbleActions>);
    expect(screen.getByTestId("bubble-actions")).toHaveClass("select-none");
  });
});
