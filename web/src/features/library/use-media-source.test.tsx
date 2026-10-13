import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { useMediaSource, type MediaSourceTarget } from "./use-media-source";

class FakeEl extends EventTarget {
  currentTime = 0;
  paused = true;
  play = vi.fn(async () => { this.paused = false; });
}

function setup(enabled = true) {
  let n = 0;
  const mock = createFetchMock({
    "POST /api/library/items/i1/media-ticket": () => { n += 1; return json({ url: `/api/library/items/i1/media?ticket=t${n}`, expires_in: 1800 }); },
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const el = new FakeEl();
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  const hook = renderHook(({ on }) => useMediaSource("i1", on, el as unknown as MediaSourceTarget), { wrapper, initialProps: { on: enabled } });
  return { mock, el, ...hook };
}

describe("useMediaSource (spec §10, R-L15)", () => {
  it("asks for a ticket only when enabled", async () => {
    const { mock, result, rerender } = setup(false);
    expect(result.current.url).toBeNull();
    expect(mock.calls).toHaveLength(0);
    rerender({ on: true });
    await waitFor(() => expect(result.current.url).toBe("/api/library/items/i1/media?ticket=t1"));
  });

  it("gets a fresh ticket after a media error and restores time and playback", async () => {
    const { el, result } = setup();
    await waitFor(() => expect(result.current.url).toContain("t1"));
    el.currentTime = 12.5;
    el.paused = false;
    act(() => { el.dispatchEvent(new Event("error")); });
    await waitFor(() => expect(result.current.url).toContain("t2"));
    el.currentTime = 0;
    act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
    expect(el.currentTime).toBe(12.5);
    expect(el.play).toHaveBeenCalled();
  });

  it("gives up after two refreshes without playback in between, and retry starts over", async () => {
    const { el, mock, result } = setup();
    await waitFor(() => expect(result.current.url).toContain("t1"));
    act(() => { el.dispatchEvent(new Event("error")); });
    await waitFor(() => expect(result.current.url).toContain("t2"));
    act(() => { el.dispatchEvent(new Event("error")); });
    await waitFor(() => expect(result.current.url).toContain("t3"));
    act(() => { el.dispatchEvent(new Event("error")); });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(mock.calls).toHaveLength(3);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.url).toContain("t4"));
    expect(result.current.error).toBeNull();
  });

  it("a successful 'playing' resets the refresh budget", async () => {
    const { el, mock, result } = setup();
    await waitFor(() => expect(result.current.url).toContain("t1"));
    for (let i = 0; i < 3; i += 1) {
      act(() => { el.dispatchEvent(new Event("error")); });
      await waitFor(() => expect(mock.calls).toHaveLength(i + 2));
      act(() => { el.dispatchEvent(new Event("playing")); });
    }
    expect(result.current.error).toBeNull();
  });
});
