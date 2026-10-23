import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RehearsalView } from "./rehearsal-view";

const LINES = [
  { idx: 0, text: "Where are you going?", mine: false },
  { idx: 1, text: "I am late for my flight.", mine: true },
];

describe("rehearsal view (plan L5 W9)", () => {
  it("shows every line, marking the ones the user will say", () => {
    render(<RehearsalView roleName="A" lines={LINES} onRehearse={() => {}} onStart={() => {}} onBack={() => {}} />);
    expect(screen.getByText("Where are you going?")).toBeInTheDocument();
    expect(screen.getByText("I am late for my flight.").closest("li")).toHaveAttribute("data-mine", "true");
    expect(screen.getByText("Where are you going?").closest("li")).toHaveAttribute("data-mine", "false");
  });

  it("'Start recording' fires its handler once, on the tap itself (the gesture is kept)", () => {
    const onStart = vi.fn();
    render(<RehearsalView roleName="A" lines={LINES} onRehearse={() => {}} onStart={onStart} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("'Rehearse' plays the clip without recording", () => {
    const onRehearse = vi.fn();
    const onStart = vi.fn();
    render(<RehearsalView roleName="A" lines={LINES} onRehearse={onRehearse} onStart={onStart} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Rehearse" }));
    expect(onRehearse).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("names the role being played, using the label the caller passes", () => {
    render(<RehearsalView roleName="Red·Alex" lines={LINES} onRehearse={() => {}} onStart={() => {}} onBack={() => {}} />);
    expect(screen.getByText("You are Red·Alex")).toBeInTheDocument();
  });

  it("draws the role's colour dot when it knows the role", () => {
    const { container, rerender } = render(<RehearsalView roleName="Red·Alex" lines={LINES} onRehearse={() => {}} onStart={() => {}} onBack={() => {}} />);
    expect(container.querySelector("[data-role-color]")).toBeNull();
    rerender(<RehearsalView role="A" roleName="Red·Alex" lines={LINES} onRehearse={() => {}} onStart={() => {}} onBack={() => {}} />);
    expect(container.querySelector('[data-role-color="red"][aria-hidden="true"]')).not.toBeNull();
  });
});
