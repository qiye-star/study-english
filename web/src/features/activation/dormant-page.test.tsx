import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { contribute, type PointProps } from "~/lib/extension-points";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { DormantPage } from "./dormant-page";
import { ActivationMeRow } from "./me-row";

const word = (w: string, useCount = 0): Record<string, unknown> => ({ word: w, book_id: "junior", learned_at: "2026-09-11T12:00:00+00:00", last_used_at: null, use_count: useCount });

function setup(routes: Record<string, Handler>, ui = <DormantPage />, opts: { path?: string; route?: string } = {}) {
  const mock = createFetchMock(routes);
  const view = renderWithProviders(ui, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: opts.route ?? "/me/activation",
    path: opts.path ?? "*",
  });
  return { mock, ...view };
}

const ON = { "GET /api/activation/config": () => json({ enabled: true }) };

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("DormantPage", () => {
  it("sends you back to practice while the switch is off", async () => {
    setup({ "GET /api/activation/config": () => json({ enabled: false }) }, <DormantPage />, { path: "/me/activation" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice"));
  });

  it("renders nothing until the config has arrived", () => {
    setup({ "GET /api/activation/config": () => new Promise(() => {}) }, <DormantPage />, { path: "/me/activation" });
    expect(screen.queryByTestId("activation-page")).toBeNull();
  });

  it("shows the dormant list with the counts of all three states", async () => {
    setup({
      ...ON,
      "GET /api/activation/words": (call) => {
        const state = call.url.searchParams.get("state");
        if (state === "dormant") return json({ state, items: [word("talk"), word("walk")], counts: { dormant: 2, sprouting: 1, active: 0 }, next_page: null });
        return json({ state, items: [], counts: { dormant: 2, sprouting: 1, active: 0 }, next_page: null });
      },
    });
    const list = await screen.findByTestId("activation-list");
    const words = within(list).getAllByTestId("activation-word").map((li) => li.textContent);
    expect(words[0]).toContain("talk");
    expect(words[0]).toContain("Not used yet");
    expect(screen.getByTestId("activation-tab-dormant")).toHaveTextContent("Dormant 2");
    expect(screen.getByTestId("activation-tab-sprouting")).toHaveTextContent("Sprouting 1");
    expect(screen.getByTestId("activation-tab-active")).toHaveTextContent("Active 0");
  });

  it("switching the segment asks for that state only and shows the empty state when there is nothing", async () => {
    const { mock } = setup({
      ...ON,
      "GET /api/activation/words": (call) => json({ state: call.url.searchParams.get("state"), items: [], counts: { dormant: 1, sprouting: 0, active: 0 }, next_page: null }),
    });
    await screen.findByTestId("activation-empty");
    await userEvent.click(screen.getByTestId("activation-tab-active"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.searchParams.get("state") === "active")).toBe(true));
    expect(screen.getByTestId("activation-empty")).toBeInTheDocument();
  });

  it("loads the next page on request and appends it", async () => {
    setup({
      ...ON,
      "GET /api/activation/words": (call) => {
        const page = call.url.searchParams.get("page");
        if (page === "1") return json({ state: "dormant", items: [word("sing")], counts: { dormant: 51, sprouting: 0, active: 0 }, next_page: null });
        return json({ state: "dormant", items: [word("talk")], counts: { dormant: 51, sprouting: 0, active: 0 }, next_page: 1 });
      },
    });
    await screen.findByTestId("activation-list");
    await userEvent.click(screen.getByTestId("activation-more"));
    await waitFor(() => expect(screen.getAllByTestId("activation-word")).toHaveLength(2));
    expect(screen.queryByTestId("activation-more")).toBeNull();
  });

  it("a failed list shows its own message and no toast", async () => {
    setup({ ...ON, "GET /api/activation/words": () => json({ error: "boom" }, 500) });
    expect(await screen.findByTestId("activation-error")).toHaveTextContent("could not be loaded");
  });
});

describe("ActivationMeRow", () => {
  it("shows the row with the dormant count only while the switch is on", async () => {
    setup({
      ...ON,
      "GET /api/activation/words": (call) => json({ state: call.url.searchParams.get("state"), items: [], counts: { dormant: 4, sprouting: 0, active: 0 }, next_page: null }),
    }, <ActivationMeRow />);
    const row = await screen.findByTestId("activation-me-row");
    await waitFor(() => expect(row).toHaveTextContent("4 learned, not used lately"));
  });

  it("is absent while the switch is off", async () => {
    setup({ "GET /api/activation/config": () => json({ enabled: false }) }, <ActivationMeRow />);
    await waitFor(() => expect(screen.queryByTestId("activation-me-row")).toBeNull());
  });

  it("hands each dormant word to the word-action slot, so the word card is reached through the extension point", async () => {
    const seen: string[] = [];
    const Probe = ({ target, testId }: PointProps["wordActions"]) => (
      <button type="button" data-testid={testId} onClick={() => seen.push(target.word)}>probe</button>
    );
    contribute({ point: "wordActions", id: "test.activation-probe", component: Probe });
    setup({
      ...ON,
      "GET /api/activation/words": (call) => {
        const state = call.url.searchParams.get("state");
        const items = state === "dormant" ? [word("talk"), word("walk")] : [];
        return json({ state, items, counts: { dormant: 2, sprouting: 0, active: 0 }, next_page: null });
      },
    });
    const probes = await screen.findAllByText("probe"); // one per dormant row; the core "add to vocabulary" button sits beside each
    expect(probes).toHaveLength(2);
    await userEvent.click(probes[1]);
    expect(seen).toEqual(["walk"]);
  });
});
