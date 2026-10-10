import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, routesFor, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { Slot } from "~/lib/extension-points-react";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { MistakesPage } from "./mistakes-page";
import "./index";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

const ON: LinkFlags = { enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k === "mistakes"])) as LinkFlags["links"] };
type Raw = { word: string; wrong_count: number; last_wrong_at: string; meaning: string; box: number | null; due_at: string | null; book_id: string };
const ITEMS: Raw[] = [
  { word: "accommodate", wrong_count: 3, last_wrong_at: new Date(Date.now() - 2 * 864e5).toISOString(), meaning: "v. 容纳", box: 1, due_at: null, book_id: "cet4" },
  { word: "necessary", wrong_count: 1, last_wrong_at: new Date().toISOString(), meaning: "adj. 必要的", box: 0, due_at: null, book_id: "cet4" },
];

beforeEach(async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
  setLinkFlags(ON);
});
afterEach(async () => {
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

it("notebook row shows the count and links to the page", async () => {
  const mock = createFetchMock({ "GET /api/links/mistakes": () => json({ items: ITEMS, next: null, total: 12 }) });
  renderWithProviders(<Slot point="notebookViews" props={{}} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  const link = await screen.findByRole("link", { name: /易错词/ });
  expect(link).toHaveAttribute("href", "/links/mistakes");
  expect(link).toHaveTextContent("12");
});

it("lists mistakes, dismisses one and shows the empty state", async () => {
  let items = [...ITEMS];
  const mock = createFetchMock({
    "GET /api/links/mistakes": () => json({ items, next: null, total: items.length }),
    "POST /api/links/mistakes/dismiss": () => { items = items.slice(1); return json({ word: "accommodate" }); },
  });
  renderWithProviders(<MistakesPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  const first = await screen.findByTestId("mistake-accommodate");
  expect(first).toHaveTextContent("错 3 次");
  expect(first).toHaveTextContent("v. 容纳");
  expect(within(first).getByTestId("mistake-accommodate-vocab")).toBeInTheDocument(); // <WordActions> core button
  fireEvent.click(within(first).getByRole("button", { name: "移出:accommodate" }));
  await waitFor(() => expect(screen.queryByTestId("mistake-accommodate")).toBeNull());
  items = [];
  fireEvent.click(within(screen.getByTestId("mistake-necessary")).getByRole("button", { name: "移出:necessary" }));
  expect(await screen.findByText("还没有易错词。")).toBeInTheDocument();
});

const OFF: LinkFlags = { ...ON, links: { ...ON.links, mistakes: false } };
const api = (fetchImpl: typeof fetch) => new ApiClient({ getToken: () => "t", fetchImpl });

it("contributes nothing while the link is off", () => {
  setLinkFlags(OFF);
  const mock = createFetchMock({});
  renderWithProviders(<Slot point="notebookViews" props={{}} />, { api: api(mock.fetch) });
  expect(screen.queryByTestId("notebook-mistakes")).toBeNull();
  expect(mock.calls).toHaveLength(0);
  expect(routesFor(OFF).some((r) => r.path === "/links/mistakes")).toBe(false);
  expect(routesFor(ON).some((r) => r.path === "/links/mistakes")).toBe(true);
});

it("notebook row says 暂无 when empty or failing", async () => {
  const mock = createFetchMock({ "GET /api/links/mistakes": () => json({ error: "Link is off" }, 404) });
  renderWithProviders(<Slot point="notebookViews" props={{}} />, { api: api(mock.fetch) });
  await waitFor(() => expect(screen.getByTestId("notebook-mistakes")).toHaveTextContent("暂无"));
});

it("rolls a failed dismiss back and tells the user", async () => {
  const mock = createFetchMock({
    "GET /api/links/mistakes": () => json({ items: ITEMS, next: null, total: 2 }),
    "POST /api/links/mistakes/dismiss": () => json({ error: "Link is off" }, 404),
  });
  renderWithProviders(<MistakesPage />, { api: api(mock.fetch) });
  fireEvent.click(within(await screen.findByTestId("mistake-accommodate")).getByRole("button", { name: "移出:accommodate" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("移出失败,已恢复", { description: "这个联动已关闭" }));
  const rows = screen.getAllByTestId(/^mistake-[a-z]+$/).map((r) => r.dataset.testid);
  expect(rows).toEqual(["mistake-accommodate", "mistake-necessary"]);
  expect(JSON.parse(String(mock.calls.find((c) => c.method === "POST")!.body))).toEqual({ word: "accommodate" });
});

it("loads more pages, shows days ago, box dots and the spelling link", async () => {
  const page2: Raw = { word: "recommend", wrong_count: 1, last_wrong_at: ITEMS[1].last_wrong_at, meaning: "", box: null, due_at: null, book_id: "cet4" };
  const mock = createFetchMock({
    "GET /api/links/mistakes": (c) => json(c.url.searchParams.get("page") === "2"
      ? { items: [page2], next: null, total: 3 } : { items: ITEMS, next: 2, total: 3 }),
  });
  renderWithProviders(<MistakesPage />, { api: api(mock.fetch) });
  const first = await screen.findByTestId("mistake-accommodate");
  expect(first).toHaveTextContent("2天前");
  expect(within(first).getByRole("img", { name: "记忆盒 1" }).querySelectorAll(".bg-teal")).toHaveLength(2);
  expect(screen.getByTestId("mistake-necessary")).toHaveTextContent("今天");
  expect(screen.getByText("3 个")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "去拼写练习" })).toHaveAttribute("href", "/wordbook/spell");
  fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
  const last = await screen.findByTestId("mistake-recommend");
  expect(within(last).queryByRole("img")).toBeNull(); // not in the notebook: no box dots
  expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
});
