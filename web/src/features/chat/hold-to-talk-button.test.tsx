import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "~/test/render";
import { holdMic, pressKey } from "~/test/hold";
import { HoldToTalkButton } from "./hold-to-talk-button";
import type { VoiceTurnState } from "./use-voice-turn";

function Harness(props: { start?: () => Promise<boolean> }) {
  const [state, setState] = useState<VoiceTurnState>("idle");
  const calls = (window as unknown as { calls: string[] }).calls;
  return (
    <HoldToTalkButton voiceState={state} disabled={false}
      onStart={async () => { calls.push("start"); const ok = await (props.start?.() ?? Promise.resolve(true)); if (ok) setState("recording"); return ok; }}
      onFinish={(d) => { calls.push(`finish:${d}`); setState("idle"); }}
      onDiscard={(r) => { calls.push(`discard:${r}`); setState("idle"); }}
      onRelease={() => calls.push("release")} />
  );
}
function setup(start?: () => Promise<boolean>) {
  const calls: string[] = [];
  (window as unknown as { calls: string[] }).calls = calls;
  renderWithProviders(<Harness start={start} />);
  return { calls, mic: screen.getByTestId("chat-mic") };
}

describe("HoldToTalkButton", () => {
  it("is a 44 px button that suppresses touch scrolling and the context menu", () => {
    const { mic } = setup();
    expect(mic).toHaveAttribute("data-hold-to-talk");
    expect(mic.className).toMatch(/h-11/);
    expect(mic.style.touchAction).toBe("none");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    mic.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mic).toHaveAccessibleName(/hold|按住/i);
  });

  it("hold and release sends, priming on release", async () => {
    const { calls, mic } = setup();
    await holdMic(mic, { ms: 1200 });
    expect(calls).toEqual(["start", "release", "finish:send"]);
  });

  it("slide up to the left cancels, to the right fills the composer", async () => {
    const a = setup();
    window.innerWidth = 400;
    await holdMic(a.mic, { dy: -120, x: 50 });
    expect(a.calls.at(-1)).toBe("discard:slide");
  });

  it("slide up to the right fills", async () => {
    const { calls, mic } = setup();
    window.innerWidth = 400;
    await holdMic(mic, { dy: -120, x: 350 });
    expect(calls.at(-1)).toBe("finish:fill");
  });

  it("shows the two drop zones while recording", async () => {
    const { mic } = setup();
    window.innerWidth = 400;
    fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700 });
    await waitFor(() => expect(screen.getByTestId("hold-overlay")).toBeInTheDocument());
    fireEvent.pointerMove(mic, { pointerId: 1, clientX: 50, clientY: 560 });
    expect(screen.getByTestId("hold-zone-cancel")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("hold-zone-text")).toHaveAttribute("data-active", "false");
    fireEvent.pointerCancel(mic, { pointerId: 1 });
    await waitFor(() => expect(screen.queryByTestId("hold-overlay")).toBeNull());
  });

  it("a pointer cancel (system gesture, incoming call) discards", async () => {
    const { calls, mic } = setup();
    fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700 });
    await waitFor(() => expect(mic).toHaveAttribute("data-hold", "recording"));
    fireEvent.pointerCancel(mic, { pointerId: 1 });
    expect(calls.at(-1)).toBe("discard:cancel");
  });

  it("releasing during the permission prompt discards and a late mic-ready is ignored", async () => {
    let resolve!: (ok: boolean) => void;
    const { calls, mic } = setup(() => new Promise((r) => (resolve = r)));
    fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700 });
    fireEvent.pointerUp(mic, { pointerId: 1, clientX: 200, clientY: 700 });
    expect(calls.at(-1)).toMatch(/^discard:(short|not-ready)$/);
    await act(async () => resolve(true));
    expect(mic).toHaveAttribute("data-hold", "idle");
  });

  it("keyboard: Space starts, Space again sends; Escape cancels", async () => {
    const { calls, mic } = setup();
    pressKey(mic, " ");
    await waitFor(() => expect(mic).toHaveAttribute("data-hold", "keyboard"));
    await waitFor(() => expect(mic).toHaveAttribute("data-state", "recording"));
    pressKey(mic, "Enter");
    expect(calls).toEqual(["start", "release", "finish:send"]);
    pressKey(mic, " ");
    await waitFor(() => expect(mic).toHaveAttribute("data-state", "recording"));
    pressKey(mic, "Escape");
    expect(calls.at(-1)).toBe("discard:cancel");
  });

  it("hiding the page cancels a hold", async () => {
    const { calls, mic } = setup();
    fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700 });
    await waitFor(() => expect(mic).toHaveAttribute("data-hold", "recording"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(calls.at(-1)).toBe("discard:cancel");
  });

  it("the 60 s limit sends unless a zone is armed", async () => {
    vi.useFakeTimers();
    try {
      const { calls, mic } = setup();
      fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700 });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(mic).toHaveAttribute("data-hold", "recording");
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(calls.at(-1)).toBe("finish:send");
    } finally {
      vi.useRealTimers();
    }
  });
});
