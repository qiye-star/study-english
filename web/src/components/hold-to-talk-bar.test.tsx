import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdMic } from "~/test/hold";
import { renderWithProviders } from "~/test/render";
import { HoldToTalkBar } from "./hold-to-talk-bar";

function setup(allowToText?: boolean) {
  const calls: string[] = [];
  let live = false;
  const view = renderWithProviders(<div />);
  const render = () => view.rerender(
    <HoldToTalkBar testId="bar" disabled={false} live={live} maxHoldMs={30_000} allowToText={allowToText}
      onStart={async () => { calls.push("start"); live = true; render(); return true; }}
      onFinish={(d) => { calls.push(`finish:${d}`); live = false; render(); }}
      onDiscard={(r) => { calls.push(`discard:${r}`); live = false; render(); }}
      onRelease={() => undefined} />,
  );
  render();
  return { calls, bar: screen.getByTestId("bar") };
}

describe("HoldToTalkBar allowToText", () => {
  let innerWidth = window.innerWidth;
  beforeEach(() => { innerWidth = window.innerWidth; window.innerWidth = 400; });
  afterEach(() => { window.innerWidth = innerWidth; vi.restoreAllMocks(); });

  it("offers both drop zones by default", async () => {
    const { bar } = setup();
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
    await waitFor(() => expect(bar).toHaveAttribute("data-hold", "recording"));
    expect(screen.getByTestId("hold-zone-cancel")).toBeTruthy();
    expect(screen.getByTestId("hold-zone-text")).toBeTruthy();
    fireEvent.pointerCancel(bar, { pointerId: 1 });
  });

  it("allowToText={false} hides the to-text zone and the hint, and a right-side slide cancels", async () => {
    const { bar, calls } = setup(false);
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
    await waitFor(() => expect(bar).toHaveAttribute("data-hold", "recording"));
    expect(screen.getByTestId("hold-zone-cancel")).toBeTruthy();
    expect(screen.queryByTestId("hold-zone-text")).toBeNull();
    expect(screen.getByTestId("hold-status").textContent).not.toMatch(/text|文字/i);
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 380, clientY: 560 });
    expect(bar).toHaveAttribute("data-hold", "armed-cancel");
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 380, clientY: 560 });
    expect(calls).toEqual(["start", "discard:slide"]);
  });

  it("allowToText={false} still sends a plain hold", async () => {
    const { bar, calls } = setup(false);
    await holdMic(bar, { ms: 1500 });
    expect(calls).toEqual(["start", "finish:send"]);
  });
});
