import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useLongPress } from "./use-long-press";

// jsdom has no PointerEvent: without one, fireEvent builds a plain Event and drops clientX / button / pointerId.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.isPrimary = init.isPrimary ?? true;
  }
}
beforeAll(() => { vi.stubGlobal("PointerEvent", TestPointerEvent); });
afterAll(() => { vi.unstubAllGlobals(); });

let clock = 0;
function Row({ onLong, onClick }: { onLong: (el: HTMLElement) => void; onClick: () => void }) {
  const press = useLongPress(onLong, { now: () => clock });
  return <div data-testid="row" {...press("a")} onClick={onClick}>word</div>;
}
const row = () => screen.getByTestId("row");
const down = (x = 10, y = 10) => fireEvent.pointerDown(row(), { pointerId: 1, clientX: x, clientY: y, button: 0, isPrimary: true });

beforeEach(() => { vi.useFakeTimers(); clock = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("useLongPress (R-L2 / R-L3 / R-L4)", () => {
  it("calls back with the pressed element after 450 ms, not before", () => {
    const onLong = vi.fn();
    render(<Row onLong={onLong} onClick={vi.fn()} />);
    down();
    vi.advanceTimersByTime(449);
    expect(onLong).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLong).toHaveBeenCalledWith(row());
  });

  it("cancels on a move beyond 8 px, on pointercancel, on scroll and on an early release", () => {
    const onLong = vi.fn();
    render(<Row onLong={onLong} onClick={vi.fn()} />);
    down();
    fireEvent.pointerMove(row(), { pointerId: 1, clientX: 19, clientY: 10 });
    vi.advanceTimersByTime(500);
    down();
    fireEvent.pointerCancel(row(), { pointerId: 1 });
    vi.advanceTimersByTime(500);
    down();
    fireEvent.scroll(document);
    vi.advanceTimersByTime(500);
    down();
    vi.advanceTimersByTime(300);
    fireEvent.pointerUp(row(), { pointerId: 1 });
    vi.advanceTimersByTime(500);
    expect(onLong).not.toHaveBeenCalled();
  });

  it("tolerates a wobble of up to 8 px", () => {
    const onLong = vi.fn();
    render(<Row onLong={onLong} onClick={vi.fn()} />);
    down();
    fireEvent.pointerMove(row(), { pointerId: 1, clientX: 18, clientY: 10 });
    vi.advanceTimersByTime(450);
    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it("ignores a secondary mouse button", () => {
    const onLong = vi.fn();
    render(<Row onLong={onLong} onClick={vi.fn()} />);
    fireEvent.pointerDown(row(), { pointerId: 1, clientX: 10, clientY: 10, button: 2 });
    vi.advanceTimersByTime(600);
    expect(onLong).not.toHaveBeenCalled();
  });

  it("swallows the click that follows the release of a long press, once, and lets later clicks through", () => {
    const onClick = vi.fn();
    render(<Row onLong={vi.fn()} onClick={onClick} />);
    down();
    vi.advanceTimersByTime(450);
    clock = 1000;
    fireEvent.pointerUp(row(), { pointerId: 1 });
    clock = 1010;
    fireEvent.click(row());
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(row());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("lets a plain tap's click through", () => {
    const onClick = vi.fn();
    render(<Row onLong={vi.fn()} onClick={onClick} />);
    down();
    vi.advanceTimersByTime(100);
    fireEvent.pointerUp(row(), { pointerId: 1 });
    fireEvent.click(row());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("suppresses the native context menu on the element", () => {
    render(<Row onLong={vi.fn()} onClick={vi.fn()} />);
    expect(fireEvent.contextMenu(row())).toBe(false); // default prevented
  });

  it("clears its timer on unmount", () => {
    const onLong = vi.fn();
    const { unmount } = render(<Row onLong={onLong} onClick={vi.fn()} />);
    down();
    unmount();
    vi.advanceTimersByTime(600);
    expect(onLong).not.toHaveBeenCalled();
  });
});
