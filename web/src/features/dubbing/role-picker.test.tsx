import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RolePicker } from "./role-picker";

const counts = { A: 3, B: 2, C: 0, D: 0, E: 0, F: 0 } as const;

describe("role picker (plan L5 W8)", () => {
  it("one card per role in the clip, with the sentence count; roles with no lines cannot be chosen", () => {
    const onSelect = vi.fn();
    render(<RolePicker names={{}} counts={counts} selected={null} editable onSelect={onSelect} onRename={() => {}} />);
    expect(screen.getByRole("button", { name: /^Red·Alex/ })).toHaveTextContent("3 sentences");
    expect(screen.getByRole("button", { name: /^Green·Chris/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Blue·Bella/ }));
    expect(onSelect).toHaveBeenCalledWith("B");
  });

  it("each card shows a dot of its own colour, and the chosen card carries a check", () => {
    const { container } = render(<RolePicker names={{}} counts={counts} selected="B" editable onSelect={() => {}} onRename={() => {}} />);
    const blue = screen.getByRole("button", { name: /^Blue·Bella/ });
    expect(blue.querySelector('[data-role-color="blue"][aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Red·Alex/ }).querySelector('[data-role-color="red"]')).not.toBeNull();
    expect(blue).toHaveAttribute("aria-pressed", "true");
    expect(blue.querySelector('[data-testid="role-check"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="role-check"]')).toHaveLength(1);
  });

  it("shows the name when there is one", () => {
    render(<RolePicker names={{ A: "Host" }} counts={counts} selected="A" editable onSelect={() => {}} onRename={() => {}} />);
    expect(screen.getByRole("button", { name: /^Red·Host/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("renaming trims the name, caps it at 24 characters and clears it when empty", () => {
    const onRename = vi.fn();
    render(<RolePicker names={{ A: "Host" }} counts={counts} selected="A" editable onSelect={() => {}} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Red·Host" }));
    const input = screen.getByRole("textbox", { name: "Name for Red·Host" });
    expect(input).toHaveAttribute("maxLength", "24");
    fireEvent.change(input, { target: { value: "  Narrator  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(onRename).toHaveBeenLastCalledWith("A", "Narrator");
    fireEvent.click(screen.getByRole("button", { name: "Rename Red·Host" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name for Red·Host" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(onRename).toHaveBeenLastCalledWith("A", null);
  });

  it("a copy of a catalog item cannot be renamed", () => {
    render(<RolePicker names={{ A: "Host" }} counts={counts} selected="A" editable={false} onSelect={() => {}} onRename={() => {}} />);
    expect(screen.queryByRole("button", { name: "Rename Red·Host" })).toBeNull();
  });
});
