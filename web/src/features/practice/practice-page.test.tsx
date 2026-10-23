import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { contribute } from "~/lib/extension-points";
import { blurLayers, setLiquid } from "~/test/glass";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { PracticePage } from "./practice-page";

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  const view = renderWithProviders(<PracticePage />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: "/practice",
  });
  return { mock, unmount: view.unmount };
}

const assessCalls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname === "/api/speech/assessments");

describe("PracticePage hub", () => {
  beforeEach(() => localStorage.clear());

  it("shows the saved draft as a preview of the shadowing card", () => {
    localStorage.setItem("enjoy-web.practice.reference", JSON.stringify("Hello world"));
    setup({});
    expect(screen.getByTestId("practice-shadow-preview")).toHaveTextContent("Hello world");
  });

  it("shows a hint instead of a preview when there is no draft", () => {
    setup({});
    expect(screen.getByTestId("practice-shadow-preview")).toHaveTextContent("Read a sentence aloud");
  });

  it("opens the shadow page from the card and from the mic, without recording or uploading", async () => {
    const { mock } = setup({});
    await userEvent.click(screen.getByTestId("practice-shadow-mic"));
    expect(screen.getByTestId("location")).toHaveTextContent("/practice/shadow");
    expect(assessCalls(mock)).toHaveLength(0);
    expect(screen.getByTestId("practice-shadow-open")).toHaveAttribute("href", "/practice/shadow");
    expect(screen.getByTestId("practice-shadow-mic")).toHaveAttribute("href", "/practice/shadow");
  });

  it("shows the wordbook mini card when the wordbook is on", async () => {
    setup({
      "GET /api/wordbook/config": () => json({ enabled: true, ai_available: false, defaults: { daily_new: 20, review_cap: 100 }, books: [] }),
      "GET /api/wordbook/today": () => json({ enrollment: null, book: null, plan: null, progress: null, tomorrow_due: 0 }),
    });
    expect(await screen.findByTestId("wordbook-mini-card")).toHaveAttribute("href", "/wordbook");
  });

  it("has no wordbook mini card when the wordbook is off", async () => {
    const { mock } = setup({ "GET /api/wordbook/config": () => json({ enabled: false }) });
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/config")).toBe(true));
    expect(screen.queryByTestId("wordbook-mini-card")).toBeNull();
  });

  it("renders contributions of the practiceHeaderActions point left of the practice list link", () => {
    contribute({ point: "practiceHeaderActions", id: "test.header", component: () => <button type="button" data-testid="test-header">x</button> });
    setup({});
    const mine = screen.getByTestId("test-header");
    const list = screen.getByTestId("practice-list");
    expect(mine.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("links to the practice list and the history", () => {
    setup({});
    expect(screen.getByTestId("practice-list")).toHaveAttribute("href", "/practice/list");
    expect(screen.getByTestId("practice-history")).toHaveAttribute("href", "/practice/history");
  });

  it("no longer repeats the learning progress row (it lives in the Me page)", () => {
    setup({});
    expect(screen.queryByTestId("practice-progress")).toBeNull();
  });

  it("shows the changelog entry left of the practice list when something is published", async () => {
    setup({ "GET /api/changelog": () => json({ entries: [], next: null, unread: 2, latest_id: 5 }) });
    const entry = await screen.findByTestId("changelog-entry", {}, { timeout: 10_000 });
    expect(entry).toHaveAttribute("href", "/practice/changelog");
    expect(entry.compareDocumentPosition(screen.getByTestId("practice-list")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, 20_000);

  it("liquid: the unread dot is recoloured to cobalt by the header slot wrapper (red stays classic)", async () => {
    setup({ "GET /api/changelog": () => json({ entries: [], next: null, unread: 2, latest_id: 5 }) });
    const dot = await screen.findByTestId("changelog-dot", {}, { timeout: 10_000 });
    expect(dot.className).toContain("bg-red");
    expect(dot.closest("[data-testid=practice-header-slot]")!.className).toContain("liquid:[&_[data-testid=changelog-dot]]:bg-blue");
  });

  it("has no changelog entry when nothing is published", async () => {
    const { mock } = setup({ "GET /api/changelog": () => json({ entries: [], next: null, unread: 0, latest_id: null }) });
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/changelog")).toBe(true), { timeout: 10_000 });
    expect(screen.queryByTestId("changelog-entry")).toBeNull();
  }, 20_000);
});

describe("practice hub in the liquid skin (plan 2026-10-15-liquid-glass L4)", () => {
  afterEach(() => setLiquid(false));

  it("large title, shadowing card first, recent scores, no extra blur", async () => {
    setLiquid(true);
    setup({
      "GET /api/wordbook/config": () => json({ enabled: false }),
      "GET /api/rank/config": () => json({ enabled: false }),
      "GET /api/assessments": () => json({ assessments: [], next: null }),
    });
    expect(await screen.findByRole("heading", { level: 1, name: /练习|Practice/ })).toHaveClass("text-large");
    const card = screen.getByTestId("practice-shadow-card");
    expect(card.className).toContain("mat-surface-strong");
    expect(blurLayers(document.body).length).toBeLessThanOrEqual(2);
  });
});
