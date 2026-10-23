import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import {
  PENDING_MAX_RETRIES, PENDING_RETRY_MS, clearGreetingFacts, consumePendingModal, getChatHomeState, rebuildToday, requestToday, resetChatHomeStore,
} from "./chat-home-store";
import contract from "./chat-home-contract.stub.json";

const READY = contract.today_ready_bilingual;
const PENDING = contract.today_pending;

function setup(handler: () => Response) {
  const mock = createFetchMock({ "POST /api/chat-home/today": handler });
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}
const bodies = (mock: ReturnType<typeof createFetchMock>) => mock.calls.map((c) => JSON.parse(String(c.body)));

beforeEach(() => { vi.useFakeTimers(); resetChatHomeStore(); });
afterEach(() => { vi.useRealTimers(); resetChatHomeStore(); });

describe("chat home store", () => {
  it("an open stores the result, bumps openSeq and marks the modal pending", async () => {
    const { api, mock } = setup(() => json(READY));
    await requestToday(api, { open: true });
    const s = getChatHomeState();
    expect(s.phase).toBe("ready");
    expect(s.today?.greeting?.id).toBe("g1");
    expect(s.localDate).toBe("2026-10-23");
    expect(s.openSeq).toBe(1);
    expect(s.pendingModal).toBe(true);
    expect(Object.keys(bodies(mock)[0]).sort()).toEqual(["client_request_id", "tz_offset_minutes"]);
    expect(mock.calls[0].url.search).toBe("");
  });

  it("concurrent opens share one request", async () => {
    const { api, mock } = setup(() => json(READY));
    await Promise.all([requestToday(api, { open: true }), requestToday(api, { open: true })]);
    expect(mock.calls).toHaveLength(1);
  });

  it("pending is retried every 1.5 s up to 4 times with the same request id, then the open does not pop", async () => {
    const { api, mock } = setup(() => json(PENDING));
    const done = requestToday(api, { open: true });
    await vi.advanceTimersByTimeAsync(PENDING_RETRY_MS * PENDING_MAX_RETRIES + 10);
    await done;
    expect(mock.calls).toHaveLength(1 + PENDING_MAX_RETRIES);
    expect(new Set(bodies(mock).map((b) => b.client_request_id)).size).toBe(1);
    expect(getChatHomeState().today?.status).toBe("pending");
  });

  it("pending then ready stops retrying", async () => {
    let n = 0;
    const { api, mock } = setup(() => json(++n < 3 ? PENDING : READY));
    const done = requestToday(api, { open: true });
    await vi.advanceTimersByTimeAsync(PENDING_RETRY_MS * 3);
    await done;
    expect(mock.calls).toHaveLength(3);
    expect(getChatHomeState().today?.status).toBe("ready");
  });

  it("a network failure is an error state with no retry storm and no invented conversation", async () => {
    const { api, mock } = setup(() => json({ error: "Upstream unavailable" }, 502));
    await requestToday(api, { open: true });
    await vi.advanceTimersByTimeAsync(PENDING_RETRY_MS * 10);
    expect(mock.calls).toHaveLength(1);
    expect(getChatHomeState()).toMatchObject({ phase: "error", today: null, pendingModal: false });
  });

  it("rebuildToday clears first, uses a new request id and is not an open", async () => {
    const { api, mock } = setup(() => json(READY));
    await requestToday(api, { open: true });
    consumePendingModal();
    const seq = getChatHomeState().openSeq;
    const first = bodies(mock)[0].client_request_id;
    const p = rebuildToday(api);
    expect(getChatHomeState()).toMatchObject({ phase: "loading", today: null });
    await p;
    expect(bodies(mock)[1].client_request_id).not.toBe(first);
    expect(getChatHomeState()).toMatchObject({ phase: "ready", openSeq: seq, pendingModal: false });
  });

  it("consumePendingModal clears the flag once; clearGreetingFacts empties facts only", async () => {
    const { api } = setup(() => json(READY));
    await requestToday(api, { open: true });
    expect(getChatHomeState().today?.greeting?.facts.streak).toBe(23);
    clearGreetingFacts();
    expect(getChatHomeState().today?.greeting?.facts).toEqual({});
    expect(getChatHomeState().today?.greeting?.lines).toHaveLength(3);
    consumePendingModal();
    expect(getChatHomeState().pendingModal).toBe(false);
  });

  it("reset aborts an in-flight request and empties the store", async () => {
    const { api } = setup(() => json(READY));
    const p = requestToday(api, { open: true });
    resetChatHomeStore();
    await p;
    expect(getChatHomeState().phase).toBe("idle");
  });
});
