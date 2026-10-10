import { act, fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import { clozeReducer, initCloze, SENTINEL } from "./cloze-engine";
import { useClozeInput } from "./use-cloze-input";

function Probe({ onSubmit, count = 2, mounted = true }: { onSubmit: () => void; count?: number; mounted?: boolean }) {
  const [state, dispatch] = useReducer(clozeReducer, initCloze(count));
  const { inputProps, formProps, focusBlank } = useClozeInput({ state, dispatch, onSubmit });
  return (
    <div>
      {mounted ? (
        <form {...formProps}>
          <input {...inputProps} />
        </form>
      ) : null}
      <output data-testid="state">{JSON.stringify(state)}</output>
      <button type="button" onClick={() => focusBlank(1)}>
        go2
      </button>
    </div>
  );
}

const stateOf = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}") as { values: string[]; active: number };

function setup(count = 2) {
  const onSubmit = vi.fn();
  render(<Probe onSubmit={onSubmit} count={count} />);
  const input = screen.getByLabelText("Blank 1 of " + count) as HTMLInputElement;
  return { onSubmit, input };
}

describe("useClozeInput", () => {
  it("space advances, the input resets to the sentinel, backspace on empty goes back", () => {
    const { input } = setup();
    expect(input.value).toBe(SENTINEL);
    fireEvent.change(input, { target: { value: SENTINEL + "talk " } });
    expect(stateOf()).toMatchObject({ values: ["talk", ""], active: 1 });
    expect(input.value).toBe(SENTINEL);
    expect(input).toHaveAttribute("aria-label", "Blank 2 of 2");
    fireEvent.change(input, { target: { value: "" } });
    expect(stateOf().active).toBe(0);
    expect(input.value).toBe(SENTINEL + "talk");
  });

  it("does not navigate while an IME composes, previews the letters, and applies the final value once", () => {
    const { input } = setup();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: SENTINEL + "tal" } });
    expect(stateOf()).toMatchObject({ values: ["tal", ""], active: 0 });
    expect(input.value).toBe(SENTINEL + "tal");
    // a space inside the composition (pinyin, Gboard) never jumps blanks while composing
    fireEvent.change(input, { target: { value: SENTINEL + "talk " } });
    expect(stateOf().active).toBe(0);
    expect(input.value).toBe(SENTINEL + "talk ");
    fireEvent.compositionEnd(input, { target: { value: SENTINEL + "talk " } });
    expect(stateOf()).toMatchObject({ values: ["talk", ""], active: 1 });
    expect(input.value).toBe(SENTINEL);
  });

  it("Gboard-style commit: composition ends, then the space arrives as a plain input event", () => {
    const { input } = setup();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: SENTINEL + "talk" } });
    fireEvent.compositionEnd(input);
    expect(stateOf()).toMatchObject({ values: ["talk", ""], active: 0 });
    fireEvent.change(input, { target: { value: SENTINEL + "talk " } });
    expect(stateOf()).toMatchObject({ values: ["talk", ""], active: 1 });
  });

  it("Enter submits once; Enter that confirms an IME candidate does not", () => {
    const { input, onSubmit } = setup();
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // implicit form submission (keyboards whose action key sends no usable keydown)
    fireEvent.submit(input.form!);
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("beforeinput line breaks submit; backspace with the caret before the sentinel still goes back", () => {
    const { input, onSubmit } = setup(3);
    fireEvent.change(input, { target: { value: SENTINEL + "a " } });
    expect(stateOf().active).toBe(1);
    const lineBreak = new InputEvent("beforeinput", { inputType: "insertLineBreak", bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(lineBreak); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(lineBreak.defaultPrevented).toBe(true);
    input.setSelectionRange(0, 0);
    const back = new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(back); });
    expect(back.defaultPrevented).toBe(true);
    expect(stateOf().active).toBe(0);
  });

  it("attaches the beforeinput listener when the input mounts after the first render (and again after a remount)", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Probe onSubmit={onSubmit} count={3} mounted={false} />);
    const check = () => {
      const input = screen.getByLabelText(/^Blank \d of 3$/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: SENTINEL + "a " } });
      expect(stateOf().active).toBe(1);
      const back = new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true });
      act(() => { input.dispatchEvent(back); });
      expect(back.defaultPrevented).toBe(true);
      expect(stateOf().active).toBe(0);
      const enter = new InputEvent("beforeinput", { inputType: "insertLineBreak", bubbles: true, cancelable: true });
      act(() => { input.dispatchEvent(enter); });
      expect(enter.defaultPrevented).toBe(true);
    };
    rerender(<Probe onSubmit={onSubmit} count={3} mounted />);
    check();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    rerender(<Probe onSubmit={onSubmit} count={3} mounted={false} />);
    rerender(<Probe onSubmit={onSubmit} count={3} mounted />);
    check();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("focusBlank moves the active blank and focuses the hidden input with the caret at the end", () => {
    const { input } = setup();
    fireEvent.click(screen.getByRole("button", { name: "go2" }));
    expect(stateOf().active).toBe(1);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(input.value.length);
  });

  it("turns off autocorrect, capitalisation and spellcheck and hints a done key", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("enterkeyhint", "done");
    expect(input).toHaveAttribute("inputmode", "text");
    expect(input).toHaveAttribute("type", "text");
    // visually hidden but focusable: never display:none / visibility:hidden; 16px so iOS does not zoom
    expect(input.className).toMatch(/opacity-0/);
    expect(input.className).toMatch(/text-\[16px\]/);
    expect(input.className).not.toMatch(/\bhidden\b|invisible/);
  });
});
