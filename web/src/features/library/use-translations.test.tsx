import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { MAX_TRANSLATE_BATCH, type LibrarySegment, type TranslateResult, type TranslatedSegment } from "./library-api";
import { NEAR_SENTENCES, TranslationBatcher, resetUnavailable, useTranslations, type TranslateNotice, type UseTranslationsArgs, type WindowRow } from "./use-translations";

type Translate = (indices: number[], signal: AbortSignal) => Promise<TranslateResult>;

function makeBatcher(translate: Translate) {
  const notices: Array<TranslateNotice | null> = [];
  const pendings: number[][] = [];
  const results: TranslatedSegment[][] = [];
  const batcher = new TranslationBatcher({
    translate,
    onResult: (items) => results.push(items),
    onPending: (set) => pendings.push([...set]),
    onNotice: (n) => notices.push(n),
    delayMs: 0,
  });
  const applied = () => results.flat();
  return { batcher, notices, pendings, results, applied };
}
const ok = (indices: number[]): TranslateResult => ({ items: indices.map((idx) => ({ idx, zh: `zh${idx}` })), limited: false });
const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);
const rows = (idxs: number[], withZh: number[] = []): WindowRow[] => idxs.map((idx) => ({ idx, hasZh: withZh.includes(idx) }));
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("TranslationBatcher (spec §9, E12; plan W2 R-SH27)", () => {
  it("requests at most 20 sentences per call, in order, one call at a time, and hands each batch back once", async () => {
    const calls: number[][] = [];
    let running = 0;
    let overlap = false;
    const { batcher, results, applied } = makeBatcher(async (indices) => {
      running += 1;
      overlap = overlap || running > 1;
      calls.push(indices);
      await settle(5);
      running -= 1;
      return ok(indices);
    });
    batcher.sync(rows(range(45)));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(applied()).toHaveLength(45));
    expect(calls.map((c) => c.length)).toEqual([MAX_TRANSLATE_BATCH, MAX_TRANSLATE_BATCH, 5]);
    expect(calls[0]).toEqual(range(20));
    expect(overlap).toBe(false);
    expect(results.map((r) => r.length)).toEqual([20, 20, 5]);
    batcher.dispose();
  });

  it("skips sentences that already have a translation, are in flight, or were just handed back", async () => {
    const calls: number[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { batcher, applied, pendings } = makeBatcher(async (indices) => {
      calls.push(indices);
      if (calls.length === 1) await gate;
      return ok(indices);
    });
    batcher.sync(rows([0, 1, 2], [0]));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual([1, 2]);
    expect(pendings.at(-1)).toEqual([1, 2]); // 骨架:正在取的句子
    batcher.sync(rows([0, 1, 2, 3], [0])); // 在途时视野移动:1、2 不会重复请求
    release();
    await vi.waitFor(() => expect(applied().map((a) => a.idx)).toEqual([1, 2, 3]));
    expect(calls).toEqual([[1, 2], [3]]);
    batcher.sync(rows([0, 1, 2, 3], [0])); // 句子表还没反映出已取到的译文:不会再取
    await settle();
    expect(calls).toHaveLength(2);
    expect(pendings.at(-1)).toEqual([]);
    batcher.dispose();
  });

  it("does nothing while disabled and starts when enabled", async () => {
    const calls: number[][] = [];
    const { batcher, applied } = makeBatcher(async (indices) => { calls.push(indices); return ok(indices); });
    batcher.sync(rows([0]));
    await settle(20);
    expect(calls).toHaveLength(0);
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(applied()).toHaveLength(1));
    batcher.dispose();
  });

  it("hands back what came, stops and says so once when the daily limit is reached", async () => {
    const calls: number[][] = [];
    const { batcher, applied, notices } = makeBatcher(async (indices) => {
      calls.push(indices);
      return { items: [{ idx: indices[0], zh: "zh" }], limited: true };
    });
    batcher.sync(rows(range(3)));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(notices).toEqual(["limited"]));
    expect(applied()).toEqual([{ idx: 0, zh: "zh" }]);
    batcher.sync(rows([...range(3), 9]));
    await settle();
    expect(calls).toHaveLength(1);
    expect(notices).toEqual(["limited"]);
    batcher.dispose();
  });

  it("marks a failed batch, stops after two failures in a row, and never retries the failed ones", async () => {
    const calls: number[][] = [];
    const { batcher, applied, notices } = makeBatcher(async (indices) => {
      calls.push(indices);
      throw new ApiError(500, "boom");
    });
    batcher.sync(rows(range(45)));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await settle();
    expect(calls).toHaveLength(2); // 第二次失败后停止,第三批没有发
    expect(notices).toEqual(["failed", "failed"]);
    expect(applied()).toHaveLength(0);
    batcher.dispose();
  });

  it("stops at once on 404 (feature off) and on 429 (quota)", async () => {
    const offCalls: number[][] = [];
    const off = makeBatcher(async (indices) => { offCalls.push(indices); throw new ApiError(404, "AI is disabled"); });
    off.batcher.sync(rows(range(30)));
    off.batcher.setEnabled(true);
    await vi.waitFor(() => expect(off.notices).toEqual(["failed"]));
    await settle();
    expect(offCalls).toHaveLength(1);
    off.batcher.dispose();

    const calls: number[][] = [];
    const quota = makeBatcher(async (indices) => { calls.push(indices); throw new ApiError(429, "Daily analysis limit reached"); });
    quota.batcher.sync(rows(range(30)));
    quota.batcher.setEnabled(true);
    await vi.waitFor(() => expect(quota.notices).toEqual(["limited"]));
    await settle();
    expect(calls).toHaveLength(1);
    quota.batcher.dispose();
  });

  it("starts a fresh session when the switch is turned off and on again, and clears the notice", async () => {
    let fail = true;
    const { batcher, applied, notices } = makeBatcher(async (indices) => {
      if (fail) throw new ApiError(500, "boom");
      return ok(indices);
    });
    batcher.sync(rows([1]));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(notices).toEqual(["failed"]));
    fail = false;
    batcher.setEnabled(false);
    expect(notices.at(-1)).toBeNull();
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(applied()).toEqual([{ idx: 1, zh: "zh1" }]));
    batcher.dispose();
  });

  it("retry() clears the failures and asks again", async () => {
    let fail = true;
    const calls: number[][] = [];
    const { batcher, applied, notices } = makeBatcher(async (indices) => {
      calls.push(indices);
      if (fail) throw new ApiError(500, "boom");
      return ok(indices);
    });
    batcher.sync(rows([1]));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(notices).toEqual(["failed"]));
    fail = false;
    batcher.retry();
    expect(notices.at(-1)).toBeNull();
    await vi.waitFor(() => expect(applied()).toEqual([{ idx: 1, zh: "zh1" }]));
    expect(calls).toEqual([[1], [1]]);
    batcher.dispose();
  });

  it("fetches again after a sentence's text was edited and its translation cleared", async () => {
    const calls: number[][] = [];
    const { batcher } = makeBatcher(async (indices) => { calls.push(indices); return ok(indices); });
    batcher.sync(rows([1]));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    batcher.sync(rows([1], [1])); // 译文已并入句子表
    batcher.sync(rows([1])); // 改字:译文被清
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual([1]);
    batcher.dispose();
  });

  it("ignores results for sentences it did not ask for and empty translations", async () => {
    const { batcher, applied } = makeBatcher(async (indices) => ({
      items: [...ok(indices).items, { idx: 99, zh: "stray" }, { idx: 1, zh: "" }],
      limited: false,
    }));
    batcher.sync(rows([1, 2]));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(applied()).toHaveLength(2));
    await settle();
    expect(applied()).toEqual([{ idx: 1, zh: "zh1" }, { idx: 2, zh: "zh2" }]);
    batcher.dispose();
  });

  it("drops a late result after dispose and after the switch went off", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { batcher, results } = makeBatcher(async (indices) => {
      await gate;
      return ok(indices);
    });
    batcher.sync(rows([1]));
    batcher.setEnabled(true);
    await settle(20);
    batcher.dispose();
    release();
    await settle(20);
    expect(results).toHaveLength(0);

    let release2!: () => void;
    const gate2 = new Promise<void>((r) => { release2 = r; });
    const off = makeBatcher(async (indices) => {
      await gate2;
      return ok(indices);
    });
    off.batcher.sync(rows([1]));
    off.batcher.setEnabled(true);
    await settle(20);
    off.batcher.setEnabled(false);
    release2();
    await settle(20);
    expect(off.results).toHaveLength(0);
    off.batcher.dispose();
  });
});

// ---- 钩子:真实的 translateSegments(W1)、真实的契约形状 {segments, limited} ----

const SEGMENTS: LibrarySegment[] = range(40).map((idx) => ({ idx, startMs: idx * 1000, endMs: idx * 1000 + 900, text: `Sentence ${idx}.` }));
const TRANSLATE = "POST /api/library/items/i1/translate";
const reply = (indices: number[], limited = false) => json({ segments: indices.map((idx) => ({ idx, zh: `译${idx}` })), limited });

function mount(handler: Handler, over: Partial<UseTranslationsArgs> = {}) {
  const mock = createFetchMock({ [TRANSLATE]: handler });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const onTranslated = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  const base: UseTranslationsArgs = { itemId: "i1", enabled: true, segments: SEGMENTS, anchorIdx: 0, native: "zh-CN", onTranslated, ...over };
  const view = renderHook((args: UseTranslationsArgs) => useTranslations(args), { wrapper, initialProps: base });
  return { mock, onTranslated, view, base };
}
const bodyOf = (mock: ReturnType<typeof createFetchMock>, n = 0) => JSON.parse(mock.calls[n].body as string);

describe("useTranslations (W1 seam)", () => {
  beforeEach(resetUnavailable);

  it("asks for the sentences within 10 of the anchor, ids and language in the body only, and returns the batch", async () => {
    const { mock, onTranslated } = mount(() => reply(range(11)));
    await waitFor(() => expect(onTranslated).toHaveBeenCalledTimes(1));
    expect(bodyOf(mock)).toEqual({ indices: range(NEAR_SENTENCES + 1), native_language: "zh-CN" });
    expect(mock.calls[0].url.search).toBe("");
    expect(onTranslated.mock.calls[0][0]).toEqual(range(11).map((idx) => ({ idx, zh: `译${idx}` })));
    expect(mock.calls).toHaveLength(1);
  });

  it("shows the in-flight sentences as pending, then nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { view, onTranslated } = mount(async () => {
      await gate;
      return reply(range(11));
    });
    await waitFor(() => expect(view.result.current.pending.size).toBe(11));
    expect(view.result.current.pending.has(3)).toBe(true);
    release();
    await waitFor(() => expect(onTranslated).toHaveBeenCalled());
    await waitFor(() => expect(view.result.current.pending.size).toBe(0));
  });

  it("does not request while the switch is off, and starts when it goes on", async () => {
    const { mock, view, base, onTranslated } = mount(() => reply(range(11)), { enabled: false });
    await settle(250);
    expect(mock.calls).toHaveLength(0);
    view.rerender({ ...base, enabled: true });
    await waitFor(() => expect(onTranslated).toHaveBeenCalled());
  });

  it("follows the anchor and skips sentences that already have a valid translation", async () => {
    const segs = SEGMENTS.map((s) => (s.idx <= 10 ? { ...s, zh: "有了", zhLang: "zh-CN" } : s));
    const { mock, onTranslated } = mount(() => reply(range(15, 11)), { segments: segs, anchorIdx: 15 });
    await waitFor(() => expect(onTranslated).toHaveBeenCalled());
    expect(bodyOf(mock).indices).toEqual(range(15, 11)); // 5..25 里 5..10 已有,取 11..25
  });

  it("treats a translation in another language as missing", async () => {
    const segs = SEGMENTS.map((s) => (s.idx === 0 ? { ...s, zh: "hola", zhLang: "es-ES" } : s));
    const { mock, onTranslated } = mount(() => reply([0]), { segments: segs, anchorIdx: 0 });
    await waitFor(() => expect(onTranslated).toHaveBeenCalled());
    expect(bodyOf(mock).indices[0]).toBe(0);
  });

  it("reports the daily limit as a notice and stops asking; retry() starts a new session", async () => {
    let limited = true;
    const { mock, view } = mount(() => (limited ? reply([0], true) : reply(range(11))));
    await waitFor(() => expect(view.result.current.notice).toBe("limited"));
    await settle(250);
    expect(mock.calls).toHaveLength(1);
    limited = false;
    act(() => view.result.current.retry());
    expect(view.result.current.notice).toBeNull();
    await waitFor(() => expect(mock.calls).toHaveLength(2));
  });

  it("reports a 429 and a server failure with the fixed notices", async () => {
    const quota = mount(() => json({ error: "Daily analysis limit reached" }, 429));
    await waitFor(() => expect(quota.view.result.current.notice).toBe("limited"));
    const broken = mount(() => json({ error: "AI is unavailable" }, 503));
    await waitFor(() => expect(broken.view.result.current.notice).toBe("failed"));
  });

  it("treats 503 AI is unavailable as terminal after the first failure, even when the anchor moves on", async () => {
    const { mock, view, base } = mount(() => json({ error: "AI is unavailable" }, 503));
    await waitFor(() => expect(view.result.current.notice).toBe("failed"));
    view.rerender({ ...base, anchorIdx: 20 });
    view.rerender({ ...base, anchorIdx: 35 });
    await settle(300);
    expect(mock.calls).toHaveLength(1);
    expect(view.result.current.notice).toBe("failed");
  });

  it("does not ask again after AI was found unavailable when the batcher is rebuilt (native change); retry() does", async () => {
    const { mock, view, base } = mount(() => json({ error: "AI is unavailable" }, 503));
    await waitFor(() => expect(view.result.current.notice).toBe("failed"));
    view.rerender({ ...base, native: "es-ES" });
    await settle(300);
    expect(mock.calls).toHaveLength(1);
    expect(view.result.current.notice).toBe("failed");
    act(() => view.result.current.retry());
    await waitFor(() => expect(mock.calls).toHaveLength(2));
  });

  it("still allows two attempts for other server failures", async () => {
    const { mock, view, base } = mount(() => json({ error: "boom" }, 500));
    await waitFor(() => expect(view.result.current.notice).toBe("failed"));
    view.rerender({ ...base, anchorIdx: 20 });
    await waitFor(() => expect(mock.calls).toHaveLength(2));
    view.rerender({ ...base, anchorIdx: 35 });
    await settle(300);
    expect(mock.calls).toHaveLength(2);
  });

  it("does nothing for an empty sentence list", async () => {
    const { mock } = mount(() => reply([]), { segments: [] });
    await settle(250);
    expect(mock.calls).toHaveLength(0);
  });
});
