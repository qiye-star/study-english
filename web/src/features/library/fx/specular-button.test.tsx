import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SPECULAR_CLASS, SpecularButton } from "./specular-button";

describe("SpecularButton (spec §11.4a)", () => {
  it("is a 44px-high button with the specular class that does not submit forms by default", () => {
    const onClick = vi.fn();
    render(<SpecularButton onClick={onClick}>Go</SpecularButton>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain(SPECULAR_CLASS);
    expect(button.className).toMatch(/\bmin-h-tap\b/);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("can be disabled and keeps a caller's type and classes", () => {
    render(<SpecularButton type="submit" disabled className="h-12">Send</SpecularButton>);
    const button = screen.getByRole("button", { name: "Send" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("type", "submit");
    expect(button.className).toMatch(/\bh-12\b/);
  });
});
