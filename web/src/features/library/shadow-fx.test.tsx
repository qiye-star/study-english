import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlurText, ClickSpark, CountUp, GlassSurface, GradientText } from "./shadow-fx";

const matchMedia = (reduce: boolean) => (query: string) => ({
  matches: reduce && query.includes("reduce"), media: query, onchange: null as null,
  addEventListener: (): void => undefined, removeEventListener: (): void => undefined, addListener: (): void => undefined,
  removeListener: (): void => undefined, dispatchEvent: (): boolean => false,
});

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia; // 仓库里的先例:直接改写再还原 window.matchMedia
});

describe("library effects (spec §11.4a)", () => {
  it("CountUp ends on the rounded target value", async () => {
    render(<span data-testid="v"><CountUp to={85.6} /></span>);
    await waitFor(() => expect(screen.getByTestId("v")).toHaveTextContent("86"), { timeout: 3000 });
  });

  it("CountUp shows the target at once when motion is reduced", () => {
    window.matchMedia = matchMedia(true) as unknown as typeof window.matchMedia;
    render(<span data-testid="v"><CountUp to={42} /></span>);
    expect(screen.getByTestId("v")).toHaveTextContent("42");
  });

  it("BlurText always carries the full text, for Latin and CJK alike", () => {
    const { container } = render(<BlurText text="So, Rachel, 你好。what now?" />);
    expect(container).toHaveTextContent("So, Rachel, 你好。what now?");
  });

  it("ClickSpark leaves no timers behind after a burst or an unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ClickSpark><button type="button">go</button></ClickSpark>);
    fireEvent.click(screen.getByText("go"));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByText("go"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ClickSpark does not swallow the click", () => {
    const onClick = vi.fn();
    render(<ClickSpark><button type="button" onClick={onClick}>go</button></ClickSpark>);
    fireEvent.click(screen.getByText("go"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("GradientText and GlassSurface render their children and pass attributes through", () => {
    render(<GlassSurface data-testid="glass" tint><GradientText>great</GradientText></GlassSurface>);
    expect(screen.getByTestId("glass")).toHaveTextContent("great");
  });
});
