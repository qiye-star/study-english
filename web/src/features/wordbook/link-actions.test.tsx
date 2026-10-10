import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { CardRow, adoptWord, fetchLinkCard } from "./link-actions";
import type { Card } from "./wordbook-api";

vi.mock("~/features/chat/use-tts-player", () => ({ useTtsPlayer: () => ({ states: {}, play: vi.fn(), stop: vi.fn(), prime: vi.fn() }) }));

const card: Card = { key: "talk", word: "talk", us: "tɔk", uk: "", senses: [{ pos: "v", text: "说话" }], phrases: [], examples: [] };

it("shows the card in place and says when the word is not in any book", async () => {
  const mock = createFetchMock({
    "GET /api/links/wordbook/card": (c) => c.url.searchParams.get("word") === "talk"
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
    "GET /api/links/wordbook/card": () => json({ book_id: "junior", card, item: { box: 0, due_at: "2026-10-11T00:00:00Z" } }),
  });
  const client = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  expect(await adoptWord(client, "talk")).toEqual({ status: "known", bookId: "junior" });
  expect((await fetchLinkCard(client, "a b")).item?.box).toBe(0);
  expect(JSON.parse(String(mock.calls[0].body))).toEqual({ word: "talk" });
  expect(mock.calls[1].url.searchParams.get("word")).toBe("a b");
});
