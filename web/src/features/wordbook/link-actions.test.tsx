import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { AdoptRow, CardRow, adoptWord, fetchLinkCard } from "./link-actions";
import type { Card } from "./wordbook-api";

vi.mock("~/features/chat/use-tts-player", () => ({ useTtsPlayer: () => ({ states: {}, play: vi.fn(), stop: vi.fn(), prime: vi.fn() }) }));

const card: Card = { key: "talk", word: "talk", us: "tɔk", uk: "", senses: [{ pos: "v", text: "说话" }], phrases: [], examples: [] };

it("shows the card in place and says when the word is not in any book", async () => {
  const mock = createFetchMock({
    "POST /api/links/wordbook/card": (c) => JSON.parse(String(c.body)).word === "talk"
      ? json({ book_id: "junior", card, item: null }) : json({ error: "Word not found" }, 404),
  });
  const client = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const view = renderWithProviders(<CardRow target={{ word: "talk", source: "manual" }} testId="x" variant="icon" close={() => {}} />, { api: client });
  fireEvent.click(screen.getByRole("button", { name: /查看词卡|View card/ }));
  expect(await screen.findByTestId("word-card")).toBeInTheDocument();
  view.unmount();
  renderWithProviders(<CardRow target={{ word: "zebra", source: "manual" }} testId="x" variant="icon" close={() => {}} />, { api: client });
  fireEvent.click(screen.getByRole("button", { name: /查看词卡|View card/ }));
  expect(await screen.findByText(/词书里没有这个词|not in any word book/)).toBeInTheDocument();
});

it("calls the two link endpoints with the word", async () => {
  const mock = createFetchMock({
    "POST /api/links/wordbook/adopt": () => json({ status: "known", book_id: "junior" }),
    "POST /api/links/wordbook/card": () => json({ book_id: "junior", card, item: { box: 0, due_at: "2026-10-11T00:00:00Z" } }),
  });
  const client = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  expect(await adoptWord(client, "talk")).toEqual({ status: "known", bookId: "junior" });
  expect((await fetchLinkCard(client, "a b")).item?.box).toBe(0);
  expect(JSON.parse(String(mock.calls[0].body))).toEqual({ word: "talk" });
  // the word travels in the body, never in the URL (it would land in the server's access log)
  expect(JSON.parse(String(mock.calls[1].body))).toEqual({ word: "a b" });
  expect(mock.calls[1].url.search).toBe("");
});

it("explains the daily adopt cap instead of a generic error", async () => {
  const { toast } = await import("sonner");
  const error = vi.spyOn(toast, "error");
  const mock = createFetchMock({ "POST /api/links/wordbook/adopt": () => json({ error: "Daily adopt limit reached" }, 429) });
  const client = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  renderWithProviders(<AdoptRow target={{ word: "talk", source: "manual" }} testId="x" variant="icon" close={() => {}} />, { api: client });
  fireEvent.click(screen.getByText(/加入词书学习|Study in word book/));
  await vi.waitFor(() => expect(error).toHaveBeenCalled());
  expect(String(error.mock.calls[0][0])).toMatch(/今天加入词书学习的词已达上限|You have added the most words for today/);
});
