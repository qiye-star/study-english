import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import { AppShell } from "../../components/layout";
import { LibraryPage } from "./library-page";

const ID1 = "3f2a9c1e-0000-4000-8000-000000000001";
const ID2 = "9b7d0c2a-0000-4000-8000-000000000002";
const overview = {
  enabled: true,
  available: true,
  asr: { enabled: true, available: true, today_minutes: 25, global_daily_minutes: 600 },
  ai: { enabled: true, available: true, today_translated: 120, today_analysed: 4, global_daily: 5000,
    translate_daily_per_user: 500, analysis_daily_per_user: 30 },
  link: { enabled: true, available: false, allow_generic: false, cookies_configured: true, proxy_configured: false },
  tools: { ffmpeg: "7.1", ytdlp: null },
  totals: { items: 2, bytes: 12582912, users: 2 },
  by_status: { uploading: 0, queued: 0, processing: 1, ready: 0, failed: 1, canceled: 0 },
  queue: { queued: 0, processing: 1, running: 1, concurrency: 1 },
  limits: { quota_mb: 2000, max_items: 100, max_upload_mb: 500, max_duration_minutes: 90 },
  purge_confirm: "PURGE 1 ITEMS",
};
const row = (over: Record<string, unknown> = {}) => ({
  id: ID1, user_id: 10000101, username: "alice", kind: "video", source: "link", status: "failed", stage: null,
  progress: 0, error_kind: "blocked", duration_ms: 61000, bytes: 12582912, sub_source: null,
  source_host: "www.youtube.com", created_at: "2026-10-13T09:00:00+00:00", ...over,
});
const items = {
  items: [
    row(),
    row({ id: ID2, user_id: 10000102, username: "bob", kind: "audio", source: "upload", status: "processing",
      stage: "transcribe", progress: 70, error_kind: null, source_host: null, bytes: 0 }),
  ],
  page: 1,
  next: null,
  total: 2,
};
const top = { users: [{ user_id: 10000101, username: "alice", items: 1, bytes: 12582912 }] };

function stubFetch(ov: unknown = overview) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const path = url.split("?")[0];
      const out =
        init?.method === "POST" ? { ok: true }
        : path === "/api/admin/library" ? ov
        : path === "/api/admin/library/top-users" ? top
        : items;
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

function signIn(role: session.Role) {
  session.setSession({
    username: role, role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: false, maintenanceMode: "off",
  });
}

const renderPage = (entry = "/library") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <LibraryPage />
    </MemoryRouter>,
  );

const itemCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.startsWith("/api/admin/library/items"));

beforeEach(() => signIn("operator"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.resetSessionForTests();
});

describe("LibraryPage", () => {
  it("shows switches, numbers and rows without any content", async () => {
    stubFetch();
    renderPage();
    expect(await screen.findByText("自动转写已开启 · 今日 25 / 上限 600 分钟")).toBeTruthy();
    expect(screen.getByText("链接导入已开启,但 yt-dlp 不可用")).toBeTruthy();
    expect(screen.getByText("译文与分析已开启 · 今日译文 120 句 / 分析 4 句 · 全站上限 5,000 句")).toBeTruthy();
    expect(screen.getByText("每人每天:译文 500 句 / 分析 30 句")).toBeTruthy();
    expect(screen.getByText(/cookies:已配置/)).toBeTruthy();
    expect(screen.getByText("ffmpeg 7.1 · yt-dlp 未安装")).toBeTruthy();
    expect(await screen.findByText("站点拒绝服务器")).toBeTruthy();
    expect(screen.getByText("www.youtube.com")).toBeTruthy();
    expect(screen.getByText("转写 · 70%")).toBeTruthy();
    expect(screen.getAllByText("12.0 MB").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "alice" })[0].getAttribute("href")).toBe("/users/10000101");
  });

  it("shows the AI switch off, and on but unavailable (D8)", async () => {
    stubFetch({ ...overview, ai: { ...overview.ai, enabled: false, available: false } });
    renderPage();
    expect(await screen.findByText("译文与分析未开启")).toBeTruthy();
    expect(screen.queryByText(/每人每天:译文/)).toBeNull();
    cleanup();
    stubFetch({ ...overview, ai: { ...overview.ai, available: false } });
    renderPage();
    expect(await screen.findByText("译文与分析已开启,但当前不可用")).toBeTruthy();
  });

  it("hides write actions from viewers", async () => {
    signIn("viewer");
    stubFetch();
    renderPage();
    await screen.findByText("站点拒绝服务器");
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消处理" })).toBeNull();
    expect(screen.queryByRole("button", { name: "清理失败项" })).toBeNull();
  });

  it("deletes an item only after the typed phrase and a reason", async () => {
    const calls = stubFetch();
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: "删除" }))[0]);
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "确认" });
    fireEvent.change(within(dialog).getByLabelText("理由"), { target: { value: "清理旧素材" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("输入 DELETE 3f2a9c1e 以确认"), { target: { value: "DELETE 3f2a9c1e" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.url === `/api/admin/library/items/${ID1}/delete`)).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/delete"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ reason: "清理旧素材", confirm: "DELETE 3f2a9c1e" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers cancel only for running items", async () => {
    const calls = stubFetch();
    renderPage();
    const cancels = await screen.findAllByRole("button", { name: "取消处理" });
    expect(cancels).toHaveLength(1);
    fireEvent.click(cancels[0]);
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("理由"), { target: { value: "任务卡住了" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
    await waitFor(() => expect(calls.some((c) => c.url === `/api/admin/library/items/${ID2}/cancel`)).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/cancel"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ reason: "任务卡住了" });
  });

  it("purges failed items with the phrase from the overview", async () => {
    const calls = stubFetch();
    renderPage();
    await screen.findByText("站点拒绝服务器");
    fireEvent.click(screen.getByRole("button", { name: "清理失败项" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("理由"), { target: { value: "每周清理" } });
    fireEvent.change(within(dialog).getByLabelText("输入 PURGE 1 ITEMS 以确认"), { target: { value: "PURGE 1 ITEMS" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/admin/library/purge-failed")).toBe(true));
    const post = calls.find((c) => c.url === "/api/admin/library/purge-failed");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ reason: "每周清理", confirm: "PURGE 1 ITEMS" });
  });

  it("filters by status and kind through query parameters", async () => {
    const calls = stubFetch();
    renderPage();
    await screen.findByText("站点拒绝服务器");
    expect(itemCalls(calls)[0].url).toBe("/api/admin/library/items?page=1");
    fireEvent.click(screen.getByRole("button", { name: "失败" }));
    await waitFor(() => expect(itemCalls(calls).some((c) => c.url === "/api/admin/library/items?status=failed&page=1")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "音频" }));
    await waitFor(() =>
      expect(itemCalls(calls).some((c) => c.url === "/api/admin/library/items?status=failed&kind=audio&page=1")).toBe(true),
    );
  });

  it("takes the owner filter from ?user= and can clear it", async () => {
    const calls = stubFetch();
    renderPage("/library?user=10000101");
    await screen.findByText("站点拒绝服务器");
    expect(itemCalls(calls)[0].url).toBe("/api/admin/library/items?user_id=10000101&page=1");
    expect(screen.getByText(/只看用户 10000101/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除用户筛选" }));
    await waitFor(() => expect(itemCalls(calls).at(-1)?.url).toBe("/api/admin/library/items?page=1"));
  });

  it("adds a nav item that viewers can see", () => {
    signIn("viewer");
    stubFetch();
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "跟读库" }).getAttribute("href")).toBe("/library");
  });
});
