import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import { WordbookPage } from "./wordbook-page";

const overview = {
  enabled: true,
  ai: { enabled: false, available: false, today_calls: 0, global_daily: 200, cached: 3 },
  books: [
    { id: "junior", title_zh: "初中", enabled: true, file: { bytes: 4068095, sha256_ok: true, entries: 3223, unique: 1987 },
      index: { loaded: true, keys: 1985, dropped: 2, built_ms: 160, stale: false }, learners: 4, learners_7d: 2, learned: 120, mastered: 9, reports_open: 1 },
    { id: "toefl", title_zh: "托福", enabled: true, file: { bytes: 0, sha256_ok: null, entries: 9000, unique: 8000 },
      index: { loaded: false, keys: 0, dropped: 0, built_ms: null, stale: false }, learners: 0, learners_7d: 0, learned: 0, mastered: 0, reports_open: 0 },
  ],
};
const reports = { reports: [{ id: 5, book_id: "junior", word: "talk", sentence_id: "a".repeat(16), sentence: "After a long talk, we decided.", reason: "wrong", count: 2, created_at: "2026-10-10T09:00:00+00:00" }] };

function stubFetch(body: unknown = overview) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const out = url.endsWith("/reports") ? reports : init?.method === "POST" ? { ok: true } : body;
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}

function signIn(role: session.Role) {
  session.setSession({
    username: role, role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: false, maintenanceMode: "off",
  });
}

const renderPage = () => render(<MemoryRouter><WordbookPage /></MemoryRouter>);

beforeEach(() => signIn("operator"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.resetSessionForTests();
});

describe("WordbookPage", () => {
  it("shows per-book file, index and learning numbers", async () => {
    stubFetch();
    renderPage();
    const row = await screen.findByTestId("wordbook-book-junior");
    expect(within(row).getByText("初中")).toBeTruthy();
    expect(within(row).getByText("1,985")).toBeTruthy();
    expect(within(row).getByText("校验通过")).toBeTruthy();
    expect(within(row).getByText("120")).toBeTruthy();
    const missing = screen.getByTestId("wordbook-book-toefl");
    expect(within(missing).getByText("未加载")).toBeTruthy();
    expect(within(missing).getByText("文件缺失")).toBeTruthy();
    expect(screen.getByText("AI 讲解未开启")).toBeTruthy();
    expect(screen.getByText("After a long talk, we decided.")).toBeTruthy();
  });

  it("flags a changed file and shows the AI budget when enabled", async () => {
    stubFetch({
      ...overview,
      ai: { enabled: true, available: true, today_calls: 12, global_daily: 200, cached: 3 },
      books: [{ ...overview.books[0], file: { ...overview.books[0].file, sha256_ok: false }, index: { ...overview.books[0].index, stale: true } }],
    });
    renderPage();
    const row = await screen.findByTestId("wordbook-book-junior");
    expect(within(row).getByText("校验失败")).toBeTruthy();
    expect(within(row).getByText("文件已变化,需重新加载")).toBeTruthy();
    expect(screen.getByText("AI 讲解已开启 · 今日 12 / 上限 200 · 缓存 3 条")).toBeTruthy();
  });

  it("hides a reported sentence with a reason", async () => {
    const calls = stubFetch();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "屏蔽此句" }));
    fireEvent.change(screen.getByLabelText("理由"), { target: { value: "例句不当" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/reports/5/hide") && c.init?.method === "POST")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("reloads the dictionary with a reason", async () => {
    const calls = stubFetch();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "重新加载词典" }));
    fireEvent.change(screen.getByLabelText("理由"), { target: { value: "数据更新了" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/wordbook/reload") && c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/wordbook/reload"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ reason: "数据更新了" });
  });

  it("hides operator actions from viewers", async () => {
    signIn("viewer");
    stubFetch();
    renderPage();
    await screen.findByTestId("wordbook-book-junior");
    expect(screen.queryByRole("button", { name: "重新加载词典" })).toBeNull();
    expect(screen.queryByRole("button", { name: "屏蔽此句" })).toBeNull();
  });
});
