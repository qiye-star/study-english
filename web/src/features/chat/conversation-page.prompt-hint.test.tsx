import "fake-indexeddb/auto";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { contributePromptHint, PROMPT_HINT_MAX, PROMPT_HINT_TIMEOUT_MS } from "~/lib/extension-points";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { WithShadowSheet } from "~/features/practice/shadow/test-utils";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ConversationPage } from "./conversation-page";
import { COMPOSER_MODE_KEY } from "./composer-mode";

/**
 * 对话页的提示词补充(计划 L4 Task 16 的页面级用例):进入页面时取一次;取不到、失败或超时,系统提示词逐字不变;
 * 取到的段落接在 system 提示词后面,并截到 PROMPT_HINT_MAX。
 * 这个文件单独成文件,因为登记点是模块级的、登记后无法撤销。
 */

let hint: () => Promise<string | null> = async () => null;
const loader = vi.fn(() => hint());
contributePromptHint({ id: "test.page-prompt-hint", load: () => loader() });

const sse = (parts: string[]) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } }), {
    headers: { "Content-Type": "text/event-stream" },
  });
};
const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const DONE_EVENT = "data: [DONE]\n\n";
const CONFIG = { system_prompt: "SYS", model: "gpt-4o", temperature: 0.7, tts_model: "openai/tts-1", tts_voice: "alloy" };

function routes(): Record<string, Handler> {
  return {
    "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o-mini", "gpt-4o"] } }),
    "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
    "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy", "echo"] } } }),
    "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
    "GET /api/conversations/c1": () => json({ id: "c1", name: "Trip", config: CONFIG }),
    "GET /api/conversations/c1/messages": () => json({ messages: [{ id: "m0", conversation_id: "c1", role: "assistant", content: "Earlier **reply**" }] }),
    "POST /api/ai/chat/completions": () => sse([delta("OK"), DONE_EVENT]),
    "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
    "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Trip", config: CONFIG }),
    "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])),
    "GET /api/realtime/config": () => json({ enabled: false, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 }),
  };
}

function setup() {
  const mock = createFetchMock(routes());
  renderWithProviders(<WithShadowSheet><ConversationPage /></WithShadowSheet>, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: "/chat/c1",
    path: "/chat/:id",
  });
  return { mock };
}

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("enjoy-web");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** 发一条文字消息,返回这次聊天请求的 system 提示词。 */
async function sendAndReadSystem(mock: ReturnType<typeof createFetchMock>, text: string): Promise<string> {
  const toggle = await screen.findByTestId("chat-mode-toggle");
  if (toggle.getAttribute("data-mode") !== "text") {
    await waitFor(() => expect(toggle).toBeEnabled());
    await act(async () => { fireEvent.click(toggle); });
  }
  const before = mock.calls.filter((c) => c.url.pathname === "/api/ai/chat/completions").length;
  await userEvent.type(screen.getByTestId("chat-input"), text);
  await userEvent.click(screen.getByTestId("chat-send"));
  await waitFor(() => expect(mock.calls.filter((c) => c.url.pathname === "/api/ai/chat/completions").length).toBeGreaterThan(before));
  const last = mock.calls.filter((c) => c.url.pathname === "/api/ai/chat/completions").at(-1)!;
  return JSON.parse(last.body as string).messages[0].content as string;
}

beforeAll(() => {
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});

describe("conversation page: prompt hints (plan L4 Task 16, page level)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    hint = async () => null;
    await deleteDb();
    resetKvCacheForTests();
    resetServerAiConfigCache();
    localStorage.removeItem(COMPOSER_MODE_KEY);
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("appends the registered instruction after the system prompt, and asks the loader once per visit", async () => {
    hint = async () => "Use the word 'talk' when it fits.";
    const { mock } = setup();
    await screen.findByText("reply");
    expect(await sendAndReadSystem(mock, "Hi")).toBe("SYS\n\nUse the word 'talk' when it fits.");
    expect(await sendAndReadSystem(mock, "Again")).toBe("SYS\n\nUse the word 'talk' when it fits.");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keeps the prompt byte-for-byte when the loader fails", async () => {
    hint = () => Promise.reject(new Error("upstream down"));
    const { mock } = setup();
    await screen.findByText("reply");
    expect(await sendAndReadSystem(mock, "Hi")).toBe("SYS");
  });

  it("keeps the prompt byte-for-byte when the loader does not answer in time", async () => {
    hint = () => new Promise<string | null>(() => {});
    const { mock } = setup();
    await screen.findByText("reply");
    await act(async () => { await new Promise((r) => setTimeout(r, PROMPT_HINT_TIMEOUT_MS + 50)); });
    expect(await sendAndReadSystem(mock, "Hi")).toBe("SYS");
  });

  it("caps the appended instruction at the hint limit", async () => {
    hint = async () => "x".repeat(PROMPT_HINT_MAX + 50);
    const { mock } = setup();
    await screen.findByText("reply");
    const system = await sendAndReadSystem(mock, "Hi");
    expect(system).toBe(`SYS\n\n${"x".repeat(PROMPT_HINT_MAX)}`);
  });
});
