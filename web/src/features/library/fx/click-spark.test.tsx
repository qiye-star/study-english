import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClickSpark, SPARK_COUNT, SPARK_MS, sparkBurst } from "./click-spark";

describe("sparkBurst", () => {
  it("makes SPARK_COUNT sparks spread around the origin with distinct directions", () => {
    const burst = sparkBurst({ x: 10, y: 20 });
    expect(burst).toHaveLength(SPARK_COUNT);
    expect(new Set(burst.map((s) => `${s.dx.toFixed(1)},${s.dy.toFixed(1)}`)).size).toBe(SPARK_COUNT);
    expect(burst.every((s) => s.x === 10 && s.y === 20)).toBe(true);
    expect(sparkBurst({ x: 0, y: 0 }, 3)).toHaveLength(3);
  });
});

describe("ClickSpark (spec §11.4a)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("bursts at the click, passes the click through and cleans up after SPARK_MS", () => {
    const onClick = vi.fn();
    const { container } = render(<ClickSpark><button onClick={onClick}>star</button></ClickSpark>);
    fireEvent.click(screen.getByRole("button", { name: "star" }), { clientX: 5, clientY: 6 });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".lib-spark")).toHaveLength(SPARK_COUNT);
    act(() => { vi.advanceTimersByTime(SPARK_MS); });
    expect(container.querySelectorAll(".lib-spark")).toHaveLength(0);
  });

  it("does nothing when disabled or when motion is reduced", () => {
    const { container, rerender } = render(<ClickSpark disabled><button>star</button></ClickSpark>);
    fireEvent.click(screen.getByRole("button", { name: "star" }));
    expect(container.querySelectorAll(".lib-spark")).toHaveLength(0);
    rerender(<ClickSpark><button>star</button></ClickSpark>);
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    fireEvent.click(screen.getByRole("button", { name: "star" }));
    expect(container.querySelectorAll(".lib-spark")).toHaveLength(0);
  });

  it("clears its pending timers on unmount", () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = render(<ClickSpark><button>star</button></ClickSpark>);
    fireEvent.click(screen.getByRole("button", { name: "star" }));
    clear.mockClear();
    unmount();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
