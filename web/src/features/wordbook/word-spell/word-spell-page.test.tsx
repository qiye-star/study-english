import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookWordSpellPage } from "./word-spell-page";

const play = vi.fn();
let ttsModel = "tts-1";
vi.mock("~/api/server-config", () => ({
  loadServerAiConfig: () => Promise.resolve({ llmModels: [], defaultLlmModel: "", ttsModels: [ttsModel], voices: [], defaultTts: { model: ttsModel, voice: "alloy" } }),
  voicesFor: () => [{ value: "alloy" }],
}));
vi.mock("~/features/chat/use-tts-player", () => ({
  useTtsPlayer: () => ({ states: {}, play, playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
  ttsErrorMessage: () => "tts error",
}));

const WORDS = ["talk", "able", "stop", "carry", "child", "careful", "accept", "absorb", "abandon", "ability"];
const item = (word: string): Record<string, unknown> => ({
  book_id: "junior",
  card: { key: word, word, us: "", uk: "", senses: [{ pos: "v", text: "说话" }], phrases: [] as unknown[], examples: [] as unknown[], def_en: [] as unknown[] },
  question: { key: word, qtype: "spell", prompt: { meaning: "v. 说话", us: "" }, options: null as unknown, length: word.length },
});
const START = { set_id: "abc123abc123", book_id: "junior", items: WORDS.map(item) };
const ANSWER: Record<string, unknown> = { correct: true, outcome: "correct", grade: "know", expected: "x", correct_option: null as unknown, diff: null as unknown,
  item: null as unknown, applied: true, rating: null as unknown, spot_check: false, check: null as unknown };

const page = (routes: Record<string, Handler>) => {
  const mock = createFetchMock(routes);
  renderWithProviders(<WordbookWordSpellPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return mock;
};

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
  ttsModel = "tts-1";
  play.mockClear();
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  localStorage.removeItem("enjoy-web.wordbook.prefs");
  void i18n.changeLanguage("en");
});

const startRound = async () => {
  await screen.findByTestId("word-spell-start");
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "开始" }));
  await screen.findByTestId("word-spell-question");
};

describe("WordbookWordSpellPage (单词拼写)", () => {
  it("dictation: the first word is read once after Start, and the word is not on screen", async () => {
    page({ "POST /api/wordbook/word-spell/start": () => json(START) });
    await startRound();
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(play.mock.calls[0][1]).toBe("talk");
    expect(screen.queryByText("talk")).toBeNull();
  });

  it("dictation: Enter submits a free-mode dictation answer and then shows the result", async () => {
    const mock = page({
      "POST /api/wordbook/word-spell/start": () => json(START),
      "POST /api/wordbook/answers": () => json(ANSWER),
    });
    await startRound();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "talk" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(await screen.findByTestId("outcome-badge")).toHaveAttribute("data-outcome", "correct");
    const body = JSON.parse(String(mock.calls.find((c) => c.url.pathname === "/api/wordbook/answers")!.body));
    expect(body).toMatchObject({ book_id: "junior", key: "talk", mode: "free", qtype: "dictation", typed: "talk", hinted: false });
  });

  it("turns to meaning-to-word when read-aloud is not configured, and dictation is disabled", async () => {
    ttsModel = "";
    page({ "POST /api/wordbook/word-spell/start": () => json(START) });
    await screen.findByTestId("word-spell-start");
    await act(async () => {});
    expect(screen.getByTestId("word-spell-mode-dictation")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("word-spell-mode-meaning")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("朗读不可用,只能看中文拼英文")).toBeTruthy();
  });

  it("a full round of ten ends in the summary, without touching the review progress", async () => {
    const mock = page({
      "POST /api/wordbook/word-spell/start": () => json(START),
      "POST /api/wordbook/answers": () => json(ANSWER),
    });
    await startRound();
    for (let i = 0; i < WORDS.length; i += 1) {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: WORDS[i] } });
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      await screen.findByTestId("outcome-badge");
      fireEvent.click(screen.getByRole("button", { name: i + 1 === WORDS.length ? "看结果" : "下一个" }));
    }
    expect(await screen.findByText("本轮拼写完成")).toBeTruthy();
    expect(mock.calls.filter((c) => c.url.pathname === "/api/wordbook/answers")).toHaveLength(WORDS.length);
    expect(mock.calls.every((c) => !c.url.pathname.includes("review"))).toBe(true);
  });
});
