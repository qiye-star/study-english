import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { kvClear } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ChangelogPage } from "./changelog-page";
import { resetUnreadForTests, setSeenDelayForTests } from "./unread-store";

const item = (tag: string, zh: string, en = "") => ({ tag, zh, en });
const entry = (id: number, day: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, entry_date: day, version: null, title_zh: `标题${id}`, title_en: `Title ${id}`, published_at: "2026-10-14T00:00:00+00:00",
  is_new: false, items: [item("new", `新功能${id}`, `New ${id}`)], ...over,
});
const THREE = [
  entry(3, "2026-10-14", { is_new: true, version: "1.12", items: [item("new", "新3", "New 3"), item("improve", "改3", "Improve 3"), item("fix", "修3", "Fix 3")] }),
  entry(2, "2026-10-13", { is_new: true, items: [item("new", "新2a", "New 2a"), item("improve", "改2", "Improve 2"), item("improve", "改2b", "Improve 2b")] }),
  entry(1, "2026-09-28", { title_en: "", items: [item("library", "库1", "")] }),
];
const body = (entries: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> => ({ entries, next: null, unread: 2, latest_id: 3, ...over });
const SEEN_OK = { "POST /api/changelog/seen": () => json({ unread: 0, last_seen_id: 3 }) };

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  const view = renderWithProviders(<ChangelogPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice/changelog" });
  return { mock, ...view };
}
const seenCalls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname === "/api/changelog/seen");

beforeEach(async () => {
  localStorage.clear();
  await kvClear();
  resetUnreadForTests();
  setSeenDelayForTests(0);
});
afterEach(async () => {
  setSeenDelayForTests();
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
});

describe("ChangelogPage", () => {
  it("shows a skeleton, then the log by month with the first card open and the rest collapsed", async () => {
    setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    expect(screen.getByTestId("changelog-loading")).toBeInTheDocument();
    const card3 = await screen.findByTestId("changelog-card-3");
    expect(screen.getAllByTestId("changelog-month").map((m) => m.textContent)).toEqual(["October 2026", "September 2026"]);
    for (const text of ["New 3", "Improve 3", "Fix 3"]) expect(within(card3).getByText(text)).toBeInTheDocument();
    expect(within(card3).getByText("v1.12")).toBeInTheDocument();
    expect(screen.getByTestId("changelog-more-3")).toHaveTextContent("Show less");
    const card2 = screen.getByTestId("changelog-card-2");
    expect(within(card2).getByText("Improve 2")).toBeInTheDocument();
    expect(within(card2).queryByText("Improve 2b")).toBeNull();
    expect(screen.getByTestId("changelog-more-2")).toHaveTextContent("Show all 3");
    await userEvent.click(screen.getByTestId("changelog-more-2"));
    expect(within(card2).getByText("Improve 2b")).toBeInTheDocument();
    expect(screen.queryByTestId("changelog-more-1")).toBeNull(); // one item: nothing to fold
    expect(within(screen.getByTestId("changelog-card-1")).getByText("标题1")).toBeInTheDocument(); // English blank -> Chinese
  });

  it("marks unread cards with a New badge that stays after the read position is reported", async () => {
    const { mock } = setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    await screen.findByTestId("changelog-card-3");
    expect(screen.getByTestId("changelog-new-3")).toHaveTextContent("New");
    expect(screen.getByTestId("changelog-new-2")).toBeInTheDocument();
    expect(screen.queryByTestId("changelog-new-1")).toBeNull();
    await waitFor(() => expect(seenCalls(mock)).toHaveLength(1));
    expect(JSON.parse(String(seenCalls(mock)[0].body))).toEqual({ upto_id: 3 });
    expect(screen.getByTestId("changelog-new-3")).toBeInTheDocument();
  });

  it("reports nothing when the page is left before the delay", async () => {
    setSeenDelayForTests(1000);
    const { mock, unmount } = setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    await screen.findByTestId("changelog-card-3");
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seenCalls(mock)).toHaveLength(0);
  });

  it("reads in Chinese in the Chinese UI", async () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
    await i18n.changeLanguage("zh-CN");
    setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    const card3 = await screen.findByTestId("changelog-card-3");
    expect(within(card3).getByText("标题3")).toBeInTheDocument();
    expect(within(card3).getByText("改3")).toBeInTheDocument();
    expect(screen.getAllByTestId("changelog-month").map((m) => m.textContent)).toEqual(["2026年10月", "2026年9月"]);
    expect(screen.getByTestId("changelog-new-3")).toHaveTextContent("新");
  });

  it("filters by type, hiding cards without a match", async () => {
    setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    await screen.findByTestId("changelog-card-3");
    const group = screen.getByRole("group", { name: "Filter by type" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "New", "Improved", "Fixed", "Library"]);
    await userEvent.click(within(group).getByRole("button", { name: "Fixed" }));
    const card3 = screen.getByTestId("changelog-card-3");
    expect(within(card3).getByText("Fix 3")).toBeInTheDocument();
    expect(within(card3).queryByText("New 3")).toBeNull();
    expect(screen.queryByTestId("changelog-card-2")).toBeNull();
    expect(screen.queryByTestId("changelog-card-1")).toBeNull();
    await userEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(screen.getByTestId("changelog-card-2")).toBeInTheDocument();
  });

  it("has no filter row when the log has one type only", async () => {
    setup({ "GET /api/changelog": () => json(body([entry(1, "2026-10-01")], { unread: 0, latest_id: 1 })) });
    await screen.findByTestId("changelog-card-1");
    expect(screen.queryByRole("group", { name: "Filter by type" })).toBeNull();
  });

  it("shows the empty state and reports nothing", async () => {
    const { mock } = setup({ "GET /api/changelog": () => json(body([], { unread: 0, latest_id: null })), ...SEEN_OK });
    expect(await screen.findByTestId("changelog-empty")).toHaveTextContent("No updates yet");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seenCalls(mock)).toHaveLength(0);
  });

  it("shows a failure with a retry that loads the log", async () => {
    let calls = 0;
    setup({ "GET /api/changelog": () => (++calls === 1 ? json({ error: "boom" }, 500) : json(body(THREE))), ...SEEN_OK });
    expect(await screen.findByTestId("changelog-error")).toHaveTextContent("Could not load the updates");
    await userEvent.click(screen.getByTestId("changelog-retry"));
    expect(await screen.findByTestId("changelog-card-3")).toBeInTheDocument();
    expect(screen.queryByTestId("changelog-error")).toBeNull();
  });

  it("falls back to the last saved first page when offline, without badges and without reporting", async () => {
    const first = setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    await screen.findByTestId("changelog-card-3");
    first.unmount();
    const second = setup({ "GET /api/changelog": () => json({ error: "down" }, 500), ...SEEN_OK });
    expect(await screen.findByTestId("changelog-offline")).toHaveTextContent("Offline: showing the updates saved last time");
    expect(await screen.findByTestId("changelog-card-3")).toBeInTheDocument();
    expect(screen.queryByTestId("changelog-new-3")).toBeNull();
    expect(screen.queryByTestId("changelog-load-more")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seenCalls(second.mock)).toHaveLength(0);
  });

  it("loads more with the cursor, appends without duplicates and ends with a note", async () => {
    const { mock } = setup({
      "GET /api/changelog": (call) => (call.url.searchParams.get("cursor") ? json(body([THREE[1], THREE[2]], { next: null })) : json(body([THREE[0]], { next: "2026-10-14.3" }))),
      ...SEEN_OK,
    });
    await screen.findByTestId("changelog-card-3");
    expect(screen.queryByTestId("changelog-card-2")).toBeNull();
    expect(screen.queryByTestId("changelog-end")).toBeNull();
    await userEvent.click(screen.getByTestId("changelog-load-more"));
    expect(await screen.findByTestId("changelog-card-2")).toBeInTheDocument();
    expect(screen.getByTestId("changelog-card-1")).toBeInTheDocument();
    expect(mock.calls.filter((c) => c.url.pathname === "/api/changelog")[1].url.searchParams.get("cursor")).toBe("2026-10-14.3");
    expect(screen.queryByTestId("changelog-load-more")).toBeNull();
    expect(screen.getByTestId("changelog-end")).toHaveTextContent("That is everything");
    expect(screen.getAllByTestId(/^changelog-card-/)).toHaveLength(3);
  });

  it("turns a failed load-more into a retry button", async () => {
    let more = 0;
    setup({
      "GET /api/changelog": (call) => {
        if (!call.url.searchParams.get("cursor")) return json(body([THREE[0]], { next: "c1" }));
        return ++more === 1 ? json({ error: "boom" }, 500) : json(body([THREE[1]], { next: null }));
      },
      ...SEEN_OK,
    });
    await screen.findByTestId("changelog-card-3");
    await userEvent.click(screen.getByTestId("changelog-load-more"));
    await waitFor(() => expect(screen.getByTestId("changelog-load-more")).toHaveTextContent("Could not load more. Tap to retry"));
    await userEvent.click(screen.getByTestId("changelog-load-more"));
    expect(await screen.findByTestId("changelog-card-2")).toBeInTheDocument();
  });
});
