import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import { LinksPage } from "./links-page";

const counters = { published: 0, handled: 0, skipped: 0, failed: 0, timeouts: 0, dropped: 0, breaker_skipped: 0, extra: {} };
const link = (key: string, label: string, extra: Record<string, unknown> = {}) => ({
  key, label_zh: label, label_en: key, global: true, effective: true, subscribed: false, stats: counters,
  breaker: "closed", open_seconds: 0, users_off: 0, ...extra,
});

const view = {
  enabled: true,
  queue: { size: 3, max: 1000, dropped: 0 },
  links: [
    link("word_actions", "单词操作位置", { users_off: 3 }),
    link("daily_tasks", "今日任务聚合卡"),
    link("mistakes", "易错词", { subscribed: true, users_off: 1, stats: { ...counters, published: 20, handled: 18204, skipped: 312 } }),
    link("pron_shadow", "发音弱词与跟读", {
      subscribed: true, breaker: "open", open_seconds: 42, stats: { ...counters, published: 6, handled: 1206, failed: 4, timeouts: 1 },
    }),
    link("chat_words", "对话用到今日词", { subscribed: true, global: false, effective: false }),
    link("rank_sources", "联动段位点"),
  ],
  rank_sources: [{ kind: "word_in_chat", default_points: 1, points: 1, label_zh: "对话用到新词", label_en: "New word used in chat" }],
  errors: [{ at: "2026-10-11T10:42:07+00:00", link: "pron_shadow", event: "WordAnswered", error: "RuntimeError" }],
  process_local: true,
};

function stubFetch(body: unknown = view) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const out = init?.method === "POST" ? { key: "pron_shadow", state: "closed" } : body;
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

const renderPage = () => render(<MemoryRouter><LinksPage /></MemoryRouter>);
const rowOf = (label: string) => screen.getByText(label).closest("tr") as HTMLElement;

beforeEach(() => signIn("operator"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.resetSessionForTests();
});

describe("LinksPage", () => {
  it("lists the six links with counters, breaker state and users who turned each off", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("易错词");
    const table = screen.getByRole("table", { name: "联动" });
    expect(within(table).getAllByRole("row")).toHaveLength(7); // 表头 + 六行
    const pron = rowOf("发音弱词与跟读");
    expect(within(pron).getByText("打开 · 42 秒")).toBeTruthy();
    expect(within(pron).getByText("4").className).toContain("text-bad");
    expect(within(rowOf("易错词")).getByText("1 人关闭")).toBeTruthy();
    expect(within(rowOf("易错词")).getByText("18,204")).toBeTruthy();
    expect(within(rowOf("单词操作位置")).getByText("word_actions · 无事件订阅")).toBeTruthy();
    expect(within(rowOf("单词操作位置")).getAllByText("—")).toHaveLength(5);
    expect(within(rowOf("对话用到今日词")).getByText("关")).toBeTruthy();
    expect(within(rowOf("对话用到今日词")).getByText("未生效")).toBeTruthy();
    expect(screen.getByText(/本进程统计,重启清零/)).toBeTruthy();
    expect(screen.getByText("总开关 开")).toBeTruthy();
    expect(screen.getByText("发音弱词与跟读 · 剩 42 秒")).toBeTruthy();
  });

  it("shows rank sources and recent errors without any user data", async () => {
    stubFetch();
    renderPage();
    const sources = await screen.findByRole("table", { name: "段位来源" });
    const row = within(sources).getByText("word_in_chat").closest("tr") as HTMLElement;
    expect(within(row).getByText("对话用到新词")).toBeTruthy();
    expect(within(row).getAllByText("1")).toHaveLength(2);
    const errors = screen.getByRole("region", { name: "最近错误" });
    expect(within(errors).getByText("pron_shadow · WordAnswered · RuntimeError")).toBeTruthy();
    expect(screen.getByRole("link", { name: "段位规则" }).getAttribute("href")).toBe("/rank/rules");
  });

  it("lets an operator reset an open breaker and reloads the view", async () => {
    const calls = stubFetch();
    renderPage();
    await screen.findByText("易错词");
    const buttons = screen.getAllByRole("button", { name: "复位熔断" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/api/admin/links/pron_shadow/reset-breaker") && c.init?.method === "POST")).toBe(true),
    );
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith("/api/admin/links") && c.init?.method !== "POST").length).toBe(2));
    const post = calls.find((c) => c.init?.method === "POST");
    expect(new Headers(post?.init?.headers).get("X-Admin-CSRF")).toBe("c");
  });

  it("shows a failed reset without leaving the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ error: "Unknown link" }), { status: 404, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify(view), { status: 200, headers: { "Content-Type": "application/json" } })));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "复位熔断" }));
    expect((await screen.findByRole("alert")).textContent).toBe("复位失败:Unknown link");
  });

  it("hides the reset button from viewers", async () => {
    signIn("viewer");
    stubFetch();
    renderPage();
    await screen.findByText("易错词");
    expect(screen.queryByRole("button", { name: "复位熔断" })).toBeNull();
  });

  it("says when the master switch is off and links to the settings group", async () => {
    stubFetch({ ...view, enabled: false, links: view.links.map((l) => ({ ...l, effective: false })) });
    renderPage();
    expect(await screen.findByText("学习联动总开关已关闭")).toBeTruthy();
    expect(screen.queryByText("总开关 开")).toBeNull();
    expect(screen.getByRole("link", { name: "去设置" }).getAttribute("href")).toBe("/settings/links");
  });

  it("shows a load error with retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } })));
    renderPage();
    expect(await screen.findByText("boom")).toBeTruthy();
  });
});

describe("navigation", () => {
  it("lists 学习联动 in the 配置 group for every role", async () => {
    const { NAV } = await import("../../components/layout");
    const config = NAV.find((g) => g.group === "配置");
    expect(config?.items.find((i) => i.to === "/links")).toMatchObject({ label: "学习联动", min: "viewer" });
  });
});
