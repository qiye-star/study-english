import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import i18n from "~/i18n";
import { createFetchMock, json, type RecordedCall } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookReviewPage } from "./review-page";
import { CONFIG, ENROLLED_TODAY, PLAN, card } from "./test-fixtures";

vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play: vi.fn(), playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
}));

const TTS_ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

type Batch = { book_id: string; questions: unknown[]; cards: ReturnType<typeof card>[] };

const ONE_TYPED: Batch = {
  book_id: "cet4",
  questions: [{ key: "talk", qtype: "spell", prompt: { meaning: "v. 说话；谈话", us: "tɔk" }, options: null, length: 4 }],
  cards: [card("talk", { senses: [{ pos: "v", text: "说话；谈话" }] })],
};

const ONE_CHOICE: Batch = {
  book_id: "cet4",
  questions: [{ key: "accept", qtype: "meaning", prompt: { word: "accept", us: "əkˈsɛpt" }, options: ["vt. 接受；承认", "v. 停止"], length: null }],
  cards: [card("accept", { senses: [{ pos: "vt", text: "接受；承认" }] })],
};

const ANSWER_OK = (expected: string, option: string | null) => json({
  correct: true, outcome: "correct", grade: "good", expected, correct_option: option, diff: null,
  item: { box: 4, due_at: "x" }, applied: true,
});

function setup(batch: Batch) {
  const mock = createFetchMock({
    ...TTS_ROUTES,
    "GET /api/wordbook/config": () => json(CONFIG),
    "GET /api/wordbook/today": () => json({ ...ENROLLED_TODAY, plan: { ...PLAN, review_due: 1, review_left: 1 } }),
    "POST /api/wordbook/review/batch": () => json(batch),
    "POST /api/wordbook/answers": (call: RecordedCall) => {
      const body = JSON.parse(String(call.body)) as { typed?: string };
      return body.typed !== undefined ? ANSWER_OK("talk", null) : ANSWER_OK("accept", "vt. 接受；承认");
    },
  });
  renderWithProviders(<WordbookReviewPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/review" });
  return mock;
}

const answerBodies = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/wordbook/answers").map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);

beforeEach(() => {
  resetServerAiConfigCache();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("WordbookReviewPage · answer time for typed questions", () => {
  it("sends elapsed_ms with a typed (spell) answer", async () => {
    const user = userEvent.setup();
    const mock = setup(ONE_TYPED);
    await user.click(await screen.findByRole("button", { name: "开始复习 1" }));
    await user.type(await screen.findByRole("textbox"), "talk{Enter}");
    await screen.findByRole("button", { name: "继续" });
    const [body] = answerBodies(mock);
    expect(body).toMatchObject({ qtype: "spell", typed: "talk" });
    expect(typeof body.elapsed_ms).toBe("number");
    expect(body.elapsed_ms as number).toBeGreaterThanOrEqual(0);
    expect(body.elapsed_ms as number).toBeLessThanOrEqual(600_000);
  });

  it("keeps the choice answer body unchanged (no elapsed_ms)", async () => {
    const user = userEvent.setup();
    const mock = setup(ONE_CHOICE);
    await user.click(await screen.findByRole("button", { name: "开始复习 1" }));
    await user.click(await screen.findByRole("button", { name: /vt\. 接受；承认/ }));
    await screen.findByRole("button", { name: "继续" });
    const [body] = answerBodies(mock);
    expect(body).toMatchObject({ qtype: "meaning", choice: "vt. 接受；承认" });
    expect("elapsed_ms" in body).toBe(false);
  });
});
