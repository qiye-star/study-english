import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountUp, GradientText, countUpValue, useCountUp } from "./count-up";
import type { FrameSource } from "./motion";

function fakeFrames() {
  const pending = new Map<number, (t: number) => void>();
  let next = 1;
  let t = 0;
  const frames: FrameSource = {
    request: (cb) => { const id = next++; pending.set(id, cb); return id; },
    cancel: (id) => { pending.delete(id); },
    now: () => t,
  };
  return {
    frames,
    pendingCount: () => pending.size,
    advance(ms: number) {
      t += ms;
      const run = [...pending.values()];
      pending.clear();
      act(() => run.forEach((cb) => cb(t)));
    },
  };
}

describe("countUpValue", () => {
  it("eases out from 0 to the target", () => {
    expect(countUpValue(0, 86)).toBe(0);
    expect(countUpValue(1, 86)).toBe(86);
    expect(countUpValue(0.5, 100)).toBeGreaterThan(50); // 先快后慢
    expect(countUpValue(0.5, 100)).toBeLessThan(100);
  });
});

describe("CountUp (spec §11.4a)", () => {
  it("starts at zero, rolls up to the target and keeps the final value for assistive tech", () => {
    const f = fakeFrames();
    const { container } = render(<CountUp to={86} frames={f.frames} enabled />);
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent("0");
    expect(container.querySelector(".sr-only")).toHaveTextContent("86");
    f.advance(16); // 第一帧只记起点
    f.advance(550);
    const mid = Number(container.querySelector("[aria-hidden]")?.textContent);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(86);
    f.advance(1200);
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent("86");
    expect(f.pendingCount()).toBe(0);
  });

  it("formats the animated value and the final value with the same function", () => {
    const f = fakeFrames();
    const { container } = render(<CountUp to={1536} format={(n) => `${Math.round(n)} MB`} frames={f.frames} enabled />);
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent("0 MB");
    expect(container.querySelector(".sr-only")).toHaveTextContent("1536 MB");
  });

  it("shows the final value at once when motion is off (reduced motion or low-end device)", () => {
    const { container } = render(<CountUp to={86} enabled={false} />);
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent("86");
  });

  it("stops asking for frames when unmounted", () => {
    const f = fakeFrames();
    const { unmount } = render(<CountUp to={86} frames={f.frames} enabled />);
    expect(f.pendingCount()).toBe(1);
    unmount();
    expect(f.pendingCount()).toBe(0);
  });

  it("rolls on from the previous value when the target changes", () => {
    const f = fakeFrames();
    function Probe({ to }: { to: number }) {
      return <p data-testid="v">{useCountUp(to, { frames: f.frames, enabled: true, durationMs: 100 })}</p>;
    }
    const { rerender } = render(<Probe to={10} />);
    f.advance(16);
    f.advance(200);
    expect(screen.getByTestId("v")).toHaveTextContent("10");
    rerender(<Probe to={20} />);
    expect(Number(screen.getByTestId("v").textContent)).toBe(10); // 不是回到 0
    f.advance(16);
    f.advance(200);
    expect(screen.getByTestId("v")).toHaveTextContent("20");
  });
});

describe("GradientText", () => {
  it("renders its children with the gradient class", () => {
    render(<GradientText className="x">Great</GradientText>);
    expect(screen.getByText("Great").className).toMatch(/\blib-gt\b/);
  });
});
