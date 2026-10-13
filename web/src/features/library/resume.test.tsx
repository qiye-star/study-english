import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { createResumeSaver, sendResumeKeepalive, useResume, type ResumeSource } from "./resume";
import type { PlayerState } from "./use-media-player";

describe("createResumeSaver", () => {
  it("saves at most every 5 s and never right after opening", () => {
    let now = 0;
    const save = vi.fn();
    const saver = createResumeSaver(save, { now: () => now, initial: { resumeMs: 0, resumeIdx: 0 } });
    now = 1000;
    saver.note({ resumeMs: 1000, resumeIdx: 0 });
    expect(save).not.toHaveBeenCalled();
    now = 5000;
    saver.note({ resumeMs: 5000, resumeIdx: 1 });
    expect(save).toHaveBeenCalledWith({ resumeMs: 5000, resumeIdx: 1 }, false);
    now = 6000;
    saver.note({ resumeMs: 6000.4, resumeIdx: 1 });
    expect(save).toHaveBeenCalledTimes(1);
    saver.flush(true);
    expect(save).toHaveBeenLastCalledWith({ resumeMs: 6000, resumeIdx: 1 }, true);
    saver.flush(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("does not resend the position it was opened with", () => {
    const save = vi.fn();
    const saver = createResumeSaver(save, { initial: { resumeMs: 4000, resumeIdx: 2 } });
    saver.note({ resumeMs: 4000, resumeIdx: 2 });
    saver.flush(true);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("sendResumeKeepalive", () => {
  it("PATCHes with keepalive and the bearer token, nothing in the query", () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    sendResumeKeepalive("a/b", { resumeMs: 12_000, resumeIdx: 3 }, "tok", fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/library/items/a%2Fb");
    expect(init).toMatchObject({ method: "PATCH", keepalive: true });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({ resume_ms: 12_000, resume_idx: 3 });
  });

  it("does nothing without a token and swallows a throwing fetch", () => {
    const fetchImpl = vi.fn(() => { throw new Error("boom"); });
    sendResumeKeepalive("i1", { resumeMs: 1, resumeIdx: 0 }, null, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => sendResumeKeepalive("i1", { resumeMs: 1, resumeIdx: 0 }, "tok", fetchImpl as unknown as typeof fetch)).not.toThrow();
  });
});

describe("useResume (R-L14)", () => {
  let state: PlayerState;
  let ms: number;
  const subs = new Set<() => void>();
  const player: ResumeSource = { getState: () => state, subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; }, currentMs: () => ms };
  const emit = () => subs.forEach((fn) => fn());

  beforeEach(() => {
    vi.useFakeTimers();
    state = { index: 0, playing: false, loop: "off", rate: 1, repeats: 0, once: false };
    ms = 0;
    subs.clear();
  });
  afterEach(() => vi.useRealTimers());

  function setup() {
    const mock = createFetchMock({ "PATCH /api/library/items/i1": () => json({}) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const keep = vi.fn(async () => new Response(null));
    const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
    const hook = renderHook(() => useResume("i1", player, {
      initial: { resumeMs: 0, resumeIdx: 0 }, getToken: () => "tok", fetchImpl: keep as unknown as typeof fetch,
    }), { wrapper });
    return { mock, keep, ...hook };
  }

  it("saves every 5 s while playing and at once on pause", async () => {
    const { mock } = setup();
    state = { ...state, playing: true };
    emit();
    ms = 4000;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mock.calls).toHaveLength(1);
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ resume_ms: 4000, resume_idx: 0 });
    ms = 7000;
    state = { ...state, playing: false, index: 1 };
    await act(async () => { emit(); await vi.advanceTimersByTimeAsync(0); });
    expect(mock.calls).toHaveLength(2);
    expect(JSON.parse(String(mock.calls[1].body))).toEqual({ resume_ms: 7000, resume_idx: 1 });
  });

  it("uses keepalive when the page is hidden and when leaving", () => {
    const { keep, unmount } = setup();
    ms = 3000;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(keep).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    ms = 3500;
    unmount();
    expect(keep).toHaveBeenCalledTimes(2);
  });
});
