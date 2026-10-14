import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { CatalogView, levelsOf } from "./catalog-view";
import type { CatalogCard } from "./catalog-api";
import { itemRaw } from "./test-fixtures";
import { setUiLanguage } from "./test-i18n";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const card = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "c1", title: "VOA: Coffee", level: "B1", tags: ["news", "food", "travel", "extra"], license_note: "VOA · Public domain",
  duration_ms: 61000, seg_count: 12, has_poster: false, published_at: "2026-10-14T00:00:00Z", added_item_id: null, ...over,
});

beforeEach(async () => {
  vi.mocked(toast.error).mockClear();
  await setUiLanguage("zh-CN");
});

function render(items: Record<string, unknown>[], extra: Record<string, Handler> = {}) {
  const mock = createFetchMock({
    "GET /api/library/catalog": () => json({ items }),
    "POST /api/library/catalog/c1/add": () => json({ item: itemRaw({ id: "i9", source: "catalog" }), created: true }),
    ...extra,
  });
  renderWithProviders(<CatalogView />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/library?tab=catalog", path: "/library" });
  return mock;
}

describe("CatalogView", () => {
  it("shows cards with level, at most three tags, length and the license line", async () => {
    render([card()]);
    expect(await screen.findByText("VOA: Coffee")).toBeInTheDocument();
    const c = screen.getByTestId("catalog-card-c1");
    expect(within(c).getByText("B1")).toBeInTheDocument();
    expect(within(c).getByText("food")).toBeInTheDocument();
    expect(within(c).queryByText("extra")).toBeNull();
    expect(within(c).getByText("1:01 · 12 句")).toBeInTheDocument();
    expect(within(c).getByText("VOA · Public domain")).toBeInTheDocument();
  });

  it("adds and opens the player", async () => {
    const mock = render([card()]);
    fireEvent.click(await screen.findByRole("button", { name: "添加到我的库" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/library/i9"));
    expect(mock.calls.some((c) => c.method === "POST" && c.url.pathname === "/api/library/catalog/c1/add")).toBe(true);
  });

  it("shows 添加中 on the busy card while the request runs", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    render([card()], { "POST /api/library/catalog/c1/add": async () => { await gate; return json({ item: itemRaw({ id: "i9" }), created: true }); } });
    fireEvent.click(await screen.findByRole("button", { name: "添加到我的库" }));
    const busy = await screen.findByRole("button", { name: "正在添加" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    release();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/library/i9"));
  });

  it("an added card opens the existing copy without another request", async () => {
    const mock = render([card({ added_item_id: "i1" })]);
    fireEvent.click(await screen.findByRole("button", { name: /已添加.*去学习/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/library/i1"));
    expect(mock.calls).toHaveLength(1); // 只有列表
  });

  it("a gone item (404): the toast says so and the card disappears at once", async () => {
    render([card(), card({ id: "c2", title: "Other" })], { "POST /api/library/catalog/c1/add": () => json({ error: "Built-in item not found" }, 404) });
    fireEvent.click((await screen.findAllByRole("button", { name: "添加到我的库" }))[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("这条精选素材已下架。"));
    await waitFor(() => expect(screen.queryByText("VOA: Coffee")).toBeNull());
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/library");
  });

  it("filters by level on the client, ordered A1..C2, and goes back to all when the level is gone", async () => {
    render([card(), card({ id: "c2", title: "Other", level: "A2" }), card({ id: "c3", title: "Third", level: "B2" })]);
    await screen.findByText("VOA: Coffee");
    const chips = within(screen.getByRole("group", { name: "按级别筛选" })).getAllByRole("button").map((b) => b.textContent);
    expect(chips).toEqual(["全部", "A2", "B1", "B2"]);
    fireEvent.click(screen.getByRole("button", { name: "A2" }));
    expect(screen.queryByText("VOA: Coffee")).toBeNull();
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A2" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the empty state", async () => {
    render([]);
    expect(await screen.findByText("精选素材正在准备中")).toBeInTheDocument();
    expect(screen.getByText("管理员发布后会出现在这里。")).toBeInTheDocument();
  });

  it("shows a retryable error", async () => {
    let fail = true;
    render([], { "GET /api/library/catalog": () => (fail ? json({ error: "Built-in library is disabled" }, 404) : json({ items: [card()] })) });
    expect(await screen.findByText("精选库暂未开放。")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("VOA: Coffee")).toBeInTheDocument();
  });
});

describe("levelsOf", () => {
  it("is unique and ordered", () => {
    const c = (level: string | null) => ({ level }) as CatalogCard;
    expect(levelsOf([c("B2"), c(null), c("A2"), c("B2"), c("X1")])).toEqual(["A2", "B2", "X1"]);
  });
});
