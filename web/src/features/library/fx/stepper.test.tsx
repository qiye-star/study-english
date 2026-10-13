import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stepper, stepIndex, type StepperStep } from "./stepper";

const STEPS: StepperStep[] = [
  { key: "probe", label: "Check" }, { key: "transcode", label: "Convert" }, { key: "transcribe", label: "Transcribe" }, { key: "segment", label: "Split" },
];
const states = (el: Element) => [...el.querySelectorAll(".lib-step")].map((s) => s.getAttribute("data-state"));
const lines = (el: Element) => [...el.querySelectorAll(".lib-step-line")].map((s) => s.getAttribute("data-state"));

describe("Stepper (spec §11.4a)", () => {
  it("finds the current stage and treats unknown or missing stages as not started", () => {
    expect(stepIndex(STEPS, "transcode")).toBe(1);
    expect(stepIndex(STEPS, "nope")).toBe(-1);
    expect(stepIndex(STEPS, null)).toBe(-1);
  });

  it("marks stages before the current one done, the current one now and the rest todo", () => {
    const { container } = render(<Stepper steps={STEPS} current="transcribe" />);
    expect(states(container)).toEqual(["done", "done", "now", "todo"]);
    expect(lines(container)).toEqual(["done", "done", "todo"]);
    expect([...container.querySelectorAll(".lib-step-labels span")].map((s) => s.textContent)).toEqual(["Check", "Convert", "Transcribe", "Split"]);
  });

  it("shows nothing done before the first stage starts", () => {
    const { container } = render(<Stepper steps={STEPS} current={null} />);
    expect(states(container)).toEqual(["todo", "todo", "todo", "todo"]);
    expect(lines(container)).toEqual(["todo", "todo", "todo"]);
  });

  it("is decorative: the card's progress bar carries the semantics", () => {
    const { container } = render(<Stepper steps={STEPS} current="probe" className="mt-1" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root.className).toMatch(/\bmt-1\b/);
  });
});
