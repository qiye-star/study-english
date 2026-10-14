import "fake-indexeddb/auto";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookReviewPage } from "./review-page";
import { CONFIG, ENROLLED_TODAY, PLAN, defsCard } from "./test-fixtures";

vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play: vi.fn(), playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
}));

const TTS = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};
const DICTATION_Q = { key: "accept", qtype: "dictation", prompt: {}, options: null as string[] | null, length: 6 };
const ACCEPT = defsCard("accept", { senses: [{ pos: "vt", text: "接受；承认" }], defs_en: [{ pos: "v", text: "agree to take something offered" }], phrases: [{ en: "accept defeat", zh: "认输" }] });

function setup({ tts = true, cards = [ACCEPT] }: { tts?: boolean; cards?: unknown[] } = {}) {
  const mock = createFetchMock({
    ...(tts ? TTS : {}),
    "GET /api/wordbook/config": () => json(CONFIG),
    "GET /api/wordbook/today": () => json({ ...ENROLLED_TODAY, plan: { ...PLAN, review_due: 1, review_left: 1 } }),
    "POST /api/wordbook/review/batch": () => json({ book_id: "cet4", questions: [DICTATION_Q], cards }),
    "POST /api/wordbook/answers": () => json({
      correct: false, outcome: "wrong", grade: "forgot", expected: "accept", correct_option: null, diff: null,
      item: { box: 1, due_at: "x" }, applied: true, rating: null, spot_check: false, check: null,
    }),
  });
  renderWithProviders(<WordbookReviewPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/review" });
}

async function typeAnswer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "开始复习 1" }));
  const box = within(await screen.findByTestId("typing-question")).getByRole("textbox");
  await user.type(box, "acept{Enter}");
}

beforeEach(() => {
  localStorage.clear();
  resetServerAiConfigCache();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("review page · after the answer (typed questions)", () => {
  it("dictation: shows the study panel after answering, Chinese hidden behind the chip", async () => {
    const user = userEvent.setup();
    setup();
    await typeAnswer(user);
    const wc = await screen.findByTestId("word-card");
    expect(wc).toHaveTextContent("accept");
    expect(wc).toHaveTextContent("agree to take something offered");
    expect(wc).not.toHaveTextContent("接受；承认");
    await user.click(within(wc).getByTestId("after-zh"));
    expect(wc).toHaveTextContent("接受；承认");
    // the result line stays the only status region
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(wc.closest("[role=status]")).toBeNull();
  });

  it("spell fallback (no TTS): shows the same panel after answering", async () => {
    const user = userEvent.setup();
    setup({ tts: false });
    await typeAnswer(user);
    const wc = await screen.findByTestId("word-card");
    expect(wc).toHaveTextContent("agree to take something offered");
    expect(within(wc).getByTestId("after-zh")).toBeTruthy();
  });

  it("renders nothing extra when the batch has no card for the word", async () => {
    const user = userEvent.setup();
    setup({ cards: [] });
    await typeAnswer(user);
    await screen.findByTestId("typing-expected");
    expect(screen.queryByTestId("word-card")).toBeNull();
  });
});
