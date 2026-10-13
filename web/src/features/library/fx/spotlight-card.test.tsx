import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpotlightCard, pointerOffset } from "./spotlight-card";

/** jsdom 26 没有 PointerEvent 构造函数:`fireEvent.pointerDown(el, { clientX })` 传不进坐标。用 MouseEvent 派发同名事件(React 按事件类型分发)。 */
const pointer = (el: Element, type: string, x = 0, y = 0) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));

describe("SpotlightCard (spec §11.4a)", () => {
  it("computes the pointer offset inside the card", () => {
    expect(pointerOffset({ left: 10, top: 20 }, 55, 30)).toEqual({ x: 45, y: 10 });
  });

  it("writes the highlight position to CSS variables without re-rendering and marks a press", () => {
    const onPointerDown = vi.fn();
    render(<SpotlightCard data-testid="card" onPointerDown={onPointerDown}>x</SpotlightCard>);
    const card = screen.getByTestId("card");
    card.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 80, right: 300, bottom: 130, x: 100, y: 50, toJSON() {} }) as DOMRect;
    pointer(card, "pointerdown", 130, 70);
    expect(card.style.getPropertyValue("--mx")).toBe("30px");
    expect(card.style.getPropertyValue("--my")).toBe("20px");
    expect(card).toHaveAttribute("data-press");
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    pointer(card, "pointermove", 150, 90);
    expect(card.style.getPropertyValue("--mx")).toBe("50px");
    pointer(card, "pointerup");
    expect(card).not.toHaveAttribute("data-press");
  });

  it("releases the press when the pointer leaves or the gesture is cancelled", () => {
    render(<SpotlightCard data-testid="card">x</SpotlightCard>);
    const card = screen.getByTestId("card");
    for (const release of [fireEvent.pointerLeave, fireEvent.pointerCancel]) {
      pointer(card, "pointerdown", 1, 1);
      expect(card).toHaveAttribute("data-press");
      release(card);
      expect(card).not.toHaveAttribute("data-press");
    }
  });

  it("is a tinted spot surface that keeps extra classes", () => {
    render(<SpotlightCard data-testid="card" className="p-3">x</SpotlightCard>);
    expect(screen.getByTestId("card").className).toMatch(/\blib-spot\b/);
    expect(screen.getByTestId("card").className).toMatch(/\blib-tint\b/);
    expect(screen.getByTestId("card").className).toMatch(/\bp-3\b/);
  });
});
