import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RolePicker } from "./role-picker";

const counts = { A: 3, B: 2, C: 0, D: 0, E: 0, F: 0 } as const;

describe("role picker (plan L5 W8)", () => {
  it("one card per role in the clip, with the sentence count; roles with no lines cannot be chosen", () => {
    const onSelect = vi.fn();
    render(<RolePicker names={{}} counts={counts} selected={null} editable onSelect={onSelect} onRename={() => {}} />);
    expect(screen.getByRole("button", { name: /Role A/ })).toHaveTextContent("3 sentences");
    expect(screen.getByRole("button", { name: /Role C/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Role B/ }));
    expect(onSelect).toHaveBeenCalledWith("B");
  });

  it("shows the name when there is one", () => {
    render(<RolePicker names={{ A: "Host" }} counts={counts} selected="A" editable onSelect={() => {}} onRename={() => {}} />);
    expect(screen.getByRole("button", { name: /Host/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("renaming trims the name, caps it at 24 characters and clears it when empty", () => {
    const onRename = vi.fn();
    render(<RolePicker names={{ A: "Host" }} counts={counts} selected="A" editable onSelect={() => {}} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename role A" }));
    const input = screen.getByRole("textbox", { name: "Name for role A" });
    expect(input).toHaveAttribute("maxLength", "24");
    fireEvent.change(input, { target: { value: "  Narrator  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(onRename).toHaveBeenLastCalledWith("A", "Narrator");
    fireEvent.click(screen.getByRole("button", { name: "Rename role A" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name for role A" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(onRename).toHaveBeenLastCalledWith("A", null);
  });

  it("a copy of a catalog item cannot be renamed", () => {
    render(<RolePicker names={{ A: "Host" }} counts={counts} selected="A" editable={false} onSelect={() => {}} onRename={() => {}} />);
    expect(screen.queryByRole("button", { name: "Rename role A" })).toBeNull();
  });
});
