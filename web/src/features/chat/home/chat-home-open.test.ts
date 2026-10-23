import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { RESUME_GAP_MS, refreshOnEnter, startOpenDetection, type OpenEnv } from "./chat-home-open";
import { getChatHomeState, requestToday, resetChatHomeStore } from "./chat-home-store";
import contract from "./chat-home-contract.stub.json";

function setup() {
  const mock = createFetchMock({ "POST /api/chat-home/today": () => json(contract.today_ready_bilingual) });
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}

function fakeEnv(start = 0) {
  let now = start;
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_: string, l: () => void) => { listeners.add(l); },
    removeEventListener: (_: string, l: () => void) => { listeners.delete(l); },
  };
  const env: OpenEnv = { doc: doc as unknown as OpenEnv["doc"], now: () => now };
  return {
    env,
    advance: (ms: number) => { now += ms; },
    setVisibility(v: DocumentVisibilityState) { doc.visibilityState = v; listeners.forEach((l) => l()); },
    listenerCount: () => listeners.size,
  };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => { vi.useFakeTimers(); resetChatHomeStore(); });
afterEach(() => { vi.useRealTimers(); resetChatHomeStore(); });

describe("open detection", () => {
  it("a cold start requests today once and marks the open", async () => {
    const { api, mock } = setup();
    const f = fakeEnv();
    const stop = startOpenDetection(api, f.env);
    await flush();
    expect(mock.calls).toHaveLength(1);
    expect(getChatHomeState()).toMatchObject({ phase: "ready", openSeq: 1, pendingModal: true });
    stop();
    expect(f.listenerCount()).toBe(0);
  });

  it("coming back after less than 30 min is not an open", async () => {
    const { api, mock } = setup();
    const f = fakeEnv();
    startOpenDetection(api, f.env);
    await flush();
    f.setVisibility("hidden");
    f.advance(RESUME_GAP_MS - 1);
    f.setVisibility("visible");
    await flush();
    expect(mock.calls).toHaveLength(1);
  });

  it("coming back after 30 min or more is a new open and re-arms the modal", async () => {
    const { api, mock } = setup();
    const f = fakeEnv();
    startOpenDetection(api, f.env);
    await flush();
    const { consumePendingModal } = await import("./chat-home-store");
    consumePendingModal();
    f.setVisibility("hidden");
    f.advance(RESUME_GAP_MS);
    f.setVisibility("visible");
    await flush();
    expect(mock.calls).toHaveLength(2);
    expect(getChatHomeState()).toMatchObject({ openSeq: 2, pendingModal: true });
  });

  it("the online event does not trigger anything", async () => {
    const { api, mock } = setup();
    const f = fakeEnv();
    startOpenDetection(api, f.env);
    await flush();
    window.dispatchEvent(new Event("online"));
    await flush();
    expect(mock.calls).toHaveLength(1);
  });
});

describe("refreshOnEnter", () => {
  it("does nothing before there is a result or on the same day", async () => {
    const { api, mock } = setup();
    expect(refreshOnEnter(api, "2026-10-23")).toBe(false);
    await requestToday(api, { open: true });
    expect(refreshOnEnter(api, "2026-10-23")).toBe(false);
    expect(mock.calls).toHaveLength(1);
  });

  it("re-requests as a new open after the local midnight", async () => {
    const { api, mock } = setup();
    await requestToday(api, { open: true });
    expect(refreshOnEnter(api, "2026-10-24")).toBe(true);
    await flush();
    expect(mock.calls).toHaveLength(2);
    expect(getChatHomeState().openSeq).toBe(2);
  });

  it("re-requests once when the last open ended pending", async () => {
    const pending = createFetchMock({ "POST /api/chat-home/today": () => json(contract.today_pending) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: pending.fetch });
    const done = requestToday(api, { open: true });
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(getChatHomeState().today?.status).toBe("pending");
    const before = pending.calls.length;
    expect(refreshOnEnter(api, "2026-10-23")).toBe(true);
    await flush();
    expect(pending.calls.length).toBeGreaterThan(before);
  });
});
