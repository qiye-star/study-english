import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ElasticSlider, snapIndex } from "./elastic-slider";

const STEPS = [0.5, 0.75, 1, 1.25] as const;
type Step = (typeof STEPS)[number];
const rect = (width: number) => ({ left: 0, top: 0, width, height: 36, right: width, bottom: 36, x: 0, y: 0, toJSON() {} }) as DOMRect;
/** jsdom 26 没有 PointerEvent 构造函数:用 MouseEvent 派发同名事件才带得上 clientX(React 按事件类型分发)。 */
const pointer = (el: Element, type: string, x = 0) => fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x }));

describe("snapIndex", () => {
  it("snaps a pointer position to the nearest of N steps and clamps outside the track", () => {
    expect(snapIndex(0, 0, 300, 4)).toBe(0);
    expect(snapIndex(60, 0, 300, 4)).toBe(1); // 60 / 300 × 3 = 0.6 → 最近的档是 1
    expect(snapIndex(149, 0, 300, 4)).toBe(1);
    expect(snapIndex(150, 0, 300, 4)).toBe(2);
    expect(snapIndex(300, 0, 300, 4)).toBe(3);
    expect(snapIndex(-50, 0, 300, 4)).toBe(0);
    expect(snapIndex(900, 0, 300, 4)).toBe(3);
    expect(snapIndex(10, 0, 0, 4)).toBe(0);
    expect(snapIndex(10, 0, 300, 1)).toBe(0);
  });
});

describe("ElasticSlider (spec §11.4a, R-L31)", () => {
  function setup(value: Step = 1) {
    const onChange = vi.fn();
    const view = render(<ElasticSlider steps={STEPS} value={value} onChange={onChange} label="Speed" format={(v) => `${v}x`} />);
    const track = screen.getByRole("slider", { name: "Speed" });
    track.getBoundingClientRect = () => rect(300);
    return { onChange, track, ...view };
  }

  it("is an accessible slider showing the current step", () => {
    const { track } = setup(0.75);
    expect(track).toHaveAttribute("aria-valuemin", "0.5");
    expect(track).toHaveAttribute("aria-valuemax", "1.25");
    expect(track).toHaveAttribute("aria-valuenow", "0.75");
    expect(track).toHaveAttribute("aria-valuetext", "0.75x");
    expect(screen.getAllByText(/x$/).map((s) => s.textContent)).toEqual(["0.5x", "0.75x", "1x", "1.25x"]);
  });

  it("moves between steps with the arrow keys", () => {
    const { track, onChange } = setup(1);
    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(1.25);
    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(0.75);
  });

  it("stops at the ends and ignores other keys", () => {
    const { track, onChange } = setup(1.25);
    fireEvent.keyDown(track, { key: "ArrowRight" });
    fireEvent.keyDown(track, { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("snaps to the pressed position, follows a drag and marks the dragging state", () => {
    const { track, onChange, container } = setup(1);
    pointer(track, "pointerdown", 300);
    expect(onChange).toHaveBeenLastCalledWith(1.25);
    expect(container.firstElementChild).toHaveAttribute("data-drag", "true");
    pointer(track, "pointermove", 10);
    expect(onChange).toHaveBeenLastCalledWith(0.5);
    pointer(track, "pointerup");
    expect(container.firstElementChild).not.toHaveAttribute("data-drag");
    onChange.mockClear();
    pointer(track, "pointermove", 150);
    expect(onChange).not.toHaveBeenCalled(); // 松手后移动不再改值
  });

  it("only moves transforms: the fill scales and the knob translates", () => {
    const { track } = setup(1);
    expect(track.style.getPropertyValue("--p")).toBe("0.6666666666666666");
    const knob = track.querySelector(".lib-slider-knob") as HTMLElement;
    expect(knob.style.transform).toMatch(/^translateX\(.*px\) scale\(1\)$/);
    expect(track.querySelector(".lib-slider-fill")).not.toBeNull();
  });
});
