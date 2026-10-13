import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShinyText } from "./shiny-text";

describe("ShinyText (spec §11.4a)", () => {
  it("renders its text with the shine class", () => {
    render(<ShinyText className="num">Transcribing 62%</ShinyText>);
    const el = screen.getByText("Transcribing 62%");
    expect(el.className).toMatch(/\blib-shiny\b/);
    expect(el.className).toMatch(/\bnum\b/);
  });
});
