import "fake-indexeddb/auto";
import { StrictMode } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { holdMic, pressKey } from "~/test/hold";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import type { RecordedCall } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ConversationPage, POST_CALL_FOLLOW_UP_MS, POST_CALL_SETTLE_MAX_MS } from "./conversation-page";
import { clearHintsMemory } from "./hints";
import { COMPOSER_MODE_KEY } from "./composer-mode";
import { sharedTtsCache } from "./tts";
import { sharedAutoplayAudio } from "./use-tts-player";
import { PLAYBACK_RATE_KEY, resetPlaybackRate } from "~/lib/playback-rate";
import { resetPageAudioContextForTests } from "~/audio/capture";
import { FakeAudioContext, FakeWorkletNode, asContext, fakeStream } from "~/test/fake-audio";
import { HANGUP_CLOSE_WAIT_MS, type RealtimeEnv } from "~/features/realtime/realtime-call";

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

const sse = (parts: string[]) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } }), {
    headers: { "Content-Type": "text/event-stream" },
  });
};
const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const DONE_EVENT = "data: [DONE]\n\n";
const CONFIG = { system_prompt: "SYS", model: "gpt-4o", temperature: 0.7, tts_model: "openai/tts-1", tts_voice: "alloy" };

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o-mini", "gpt-4o"] } }),
    "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
    "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy", "echo"] } } }),
    "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
    "GET /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: CONFIG }),
    "GET /api/conversations/c1/messages": () => json({ messages: [{ id: "m0", conversation_id: "c1", role: "assistant", content: "Earlier **reply**" }] }),
    "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])),
    "GET /api/realtime/config": () => json({ enabled: false, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 }),
    ...extra,
  };
}

let goTo: (path: string) => void = () => {};
function NavProbe(): null {
  goTo = useNavigate();
  return null;
}

function setup(r: Record<string, Handler>, recorderEnv?: ReturnType<typeof createFakeRecorderEnv>["env"], opts: { strict?: boolean; route?: string | { pathname: string; state?: unknown } } = {}) {
  const mock = createFetchMock(r);
  const page = <><ConversationPage recorderEnv={recorderEnv} /><NavProbe /></>;
  const view = renderWithProviders(opts.strict ? <StrictMode>{page}</StrictMode> : page, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: opts.route ?? "/chat/c1",
    path: "/chat/:id",
  });
  return { mock, view };
}

const ASSESSED = {
  pronunciation_score: 82, accuracy_score: 80, fluency_score: 85, completeness_score: 90, assessment_id: "a1",
  detail_result: { display: "", words: [{ word: "like", pronunciation_assessment: { accuracy_score: 40, error_type: "Mispronunciation" } }] },
};
/** Await the IndexedDB delete so the next test's kv cache never queues behind a pending delete. */
function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("enjoy-web");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}
/**
 * 仿微信的输入栏:文字输入框与"按住 说话"长条二选一,由左侧的切换按钮切换。
 * 切到指定模式(已在该模式时什么都不做;切换按钮可用时才点),返回该模式的主元素(chat-input 或 chat-mic)。
 */
async function composerMode(mode: "text" | "voice"): Promise<HTMLElement> {
  const toggle = await screen.findByTestId("chat-mode-toggle");
  if (toggle.getAttribute("data-mode") !== mode) {
    await waitFor(() => expect(toggle).toBeEnabled());
    await act(async () => { fireEvent.click(toggle); });
    expect(toggle).toHaveAttribute("data-mode", mode);
  }
  return screen.getByTestId(mode === "voice" ? "chat-mic" : "chat-input");
}
/**
 * 顶栏的双语、自动朗读、语速、复盘、对话设置收在"选项"弹出面板里(redesign v3:顶栏只放通话与调整两个图标)。
 * 面板没开就先点开;开关类点了不关面板,复盘/设置点了会关。返回该控件。
 */
async function headerOption(testId: string): Promise<HTMLElement> {
  if (!screen.queryByTestId(testId)) await userEvent.click(await screen.findByTestId("conversation-options"));
  return screen.getByTestId(testId);
}
const voiceMode = () => composerMode("voice");
const textMode = () => composerMode("text");
/** R29:按住麦克风 1 秒再松手(按住说话),替代"点一下开始、再点一下停止" */
async function recordAndSend() {
  await holdMic(await voiceMode(), { ms: 1000 });
}
/** R29:键盘后备(Space 一次)开始录音并等麦克风就绪,替代"点一下 chat-mic 开始" */
async function startRecording() {
  const mic = await voiceMode();
  await act(async () => { pressKey(mic); });
}
const callsTo = (mock: ReturnType<typeof createFetchMock>, method: string, path: string) =>
  mock.calls.filter((c) => c.method === method && c.url.pathname === path);
const bodyOf = (call: { body: BodyInit | null | undefined }) => JSON.parse(call.body as string);

const posted = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname.endsWith("/messages") && c.method === "POST");

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:tts"), revokeObjectURL: vi.fn() });
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});

describe("ConversationPage", () => {
  beforeEach(() => {
    resetServerAiConfigCache();
    localStorage.removeItem(COMPOSER_MODE_KEY); // 每个用例都从默认的文字模式开始
  });

  it("sends the stored level instruction with the next request", async () => {
    const { mock } = setup(routes({
      "GET /api/conversations/c1": () => json({ id: "c1", name: "Trip", config: { ...CONFIG, level: "A2" } }),
      "POST /api/ai/chat/completions": () => sse([delta("OK"), DONE_EVENT]),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
    }));
    await screen.findByText("reply");
    await userEvent.type(await textMode(), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(1));
    const system = bodyOf(callsTo(mock, "POST", "/api/ai/chat/completions")[0]).messages[0];
    expect(system.role).toBe("system");
    expect(system.content).toMatch(/^SYS\n\nLanguage level: the learner is at CEFR A2\./);
  });

  it("renders the badge and highlights of a loaded voice message with no extra request until details open", async () => {
    const { mock } = setup(routes({
      "GET /api/conversations/c1/messages": () => json({ messages: [{
        id: "m1", conversation_id: "c1", role: "user", content: "Nice to meet you", assessment_id: "a1",
        assessment: { scores: { pronunciationScore: 72.6, accuracyScore: 70, fluencyScore: 80, completenessScore: 90 }, words: [{ word: "meet", accuracyScore: 40, errorType: "Mispronunciation" }] },
      }] }),
      "GET /api/assessments/a1": () => new Promise<Response>(() => undefined),
    }));
    expect(await screen.findByTestId("badge-pronunciation")).toHaveTextContent("Pronunciation 73");
    expect(screen.getByTestId("voice-word-poor")).toHaveTextContent("meet");
    expect(mock.calls.filter((c) => c.url.pathname.startsWith("/api/assessments"))).toHaveLength(0);
    await userEvent.click(screen.getByTestId("badge-pronunciation"));
    expect(await screen.findByTestId("turn-detail")).toBeInTheDocument();
    expect(mock.calls.filter((c) => c.url.pathname === "/api/assessments/a1")).toHaveLength(1);
  });

  it("caps the composer at the server message limit", async () => {
    setup(routes({}));
    expect(await screen.findByTestId("chat-input")).toHaveAttribute("maxlength", "20000");
  });

  it("streams a reply, saves the pair and names the conversation", async () => {
    const { mock } = setup(routes({
      "POST /api/ai/chat/completions": () => sse([delta("Hello "), delta("there!"), "data: [DONE]\n\n"]),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1", role: "user", content: "Hi" }, { id: "m2", role: "assistant", content: "Hello there!" }] }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: CONFIG }),
    }));
    expect(await screen.findByText("reply")).toBeInTheDocument();
    await userEvent.type(await textMode(), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hello there!"));
    const chat = JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/ai/chat/completions")!.body as string);
    expect(chat).toMatchObject({ model: "gpt-4o", temperature: 0.7, stream: true });
    expect(chat.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "assistant", content: "Earlier **reply**" },
      { role: "user", content: "Hi" },
    ]);
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    const saved = JSON.parse(mock.calls.find((c) => c.url.pathname.endsWith("/messages") && c.method === "POST")!.body as string);
    expect(saved).toEqual({ messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello there!" }] });
    expect(JSON.parse(mock.calls.find((c) => c.method === "PATCH")!.body as string)).toEqual({ name: "Hi" });
    expect(screen.getAllByTestId("message-user").at(-1)!.querySelector("[data-lookup-context]")).not.toBeNull();
  });

  it("shows an error bubble without saving, and retries", async () => {
    let attempt = 0;
    const { mock } = setup(routes({
      "POST /api/ai/chat/completions": () => (++attempt === 1 ? sse(['data: {"error": "Upstream unavailable"}\n\n']) : sse([delta("OK"), "data: [DONE]\n\n"])),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: CONFIG }),
    }));
    await screen.findByText("reply");
    await userEvent.type(await textMode(), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByText("The AI service is unavailable. Please try again.")).toBeInTheDocument();
    expect(mock.calls.some((c) => c.url.pathname.endsWith("/messages") && c.method === "POST")).toBe(false);
    await userEvent.click(screen.getByTestId("message-retry"));
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("OK"));
    expect(screen.getAllByTestId("message-user")).toHaveLength(1);
    const chats = mock.calls.filter((c) => c.url.pathname === "/api/ai/chat/completions");
    expect(chats).toHaveLength(2);
    expect(chats[1].body).toEqual(chats[0].body);
    await waitFor(() => expect(posted(mock)).toHaveLength(1));
    expect(JSON.parse(posted(mock)[0].body as string).messages).toEqual([{ role: "user", content: "Hi" }, { role: "assistant", content: "OK" }]);
  });

  it("saves conversation settings", async () => {
    const { mock } = setup(routes({ "PATCH /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: { ...CONFIG, tts_voice: "echo" } }) }));
    await screen.findByText("reply");
    await userEvent.click(await headerOption("conversation-settings"));
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(2));
    await userEvent.click(screen.getByTestId("voice-option-echo"));
    expect(screen.getByTestId("settings-tts-voice")).toHaveAttribute("data-value", "echo");
    await userEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.method === "PATCH")!.body as string).config).toMatchObject({ tts_voice: "echo", system_prompt: "SYS" });
  });

  it("persists the grammar check and coach mode switches as snake_case config keys", async () => {
    const { mock } = setup(routes({ "PATCH /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: { ...CONFIG, grammar_check: false, coach_mode: true } }) }));
    await screen.findByText("reply");
    await userEvent.click(await headerOption("conversation-settings"));
    await userEvent.click(screen.getByTestId("settings-grammar-check"));
    await userEvent.click(screen.getByTestId("settings-coach-mode"));
    await userEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.method === "PATCH")!.body as string).config).toMatchObject({ grammar_check: false, coach_mode: true, system_prompt: "SYS" });
  });

  describe("settings sheet saves only what changed", () => {
    const patchBody = (mock: { calls: Array<{ method: string; body?: unknown }> }) =>
      JSON.parse(mock.calls.find((c) => c.method === "PATCH")!.body as string).config;

    it("writes auto_speak and level as snake_case keys on top of the stored config", async () => {
      const { mock } = setup(routes({ "PATCH /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: { ...CONFIG, level: "B1", auto_speak: false } }) }));
      await screen.findByText("reply");
      await userEvent.click(await headerOption("conversation-settings"));
      await userEvent.click(screen.getByTestId("settings-auto-speak"));
      await userEvent.selectOptions(screen.getByTestId("settings-level"), "B1");
      await userEvent.click(screen.getByTestId("settings-save"));
      await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
      expect(patchBody(mock)).toEqual({ ...CONFIG, auto_speak: false, level: "B1" });
    });

    it("before the AI config loads: stored keys + the changed key, no model/tts keys or empty strings", async () => {
      const never = () => new Promise<Response>(() => {});
      const { mock } = setup(routes({
        "GET /api/config/gpt_providers": never, "GET /api/config/default_gpt_preset": never,
        "GET /api/config/tts_providers_v2": never, "GET /api/config/default_tts_preset": never,
        "GET /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: { system_prompt: "SYS", temperature: 0.7 } }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: { system_prompt: "SYS", coach_mode: true } }),
      }));
      await screen.findByText("reply");
      await userEvent.click(await headerOption("conversation-settings"));
      await userEvent.click(screen.getByTestId("settings-coach-mode"));
      await userEvent.click(screen.getByTestId("settings-save"));
      await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
      const config = patchBody(mock);
      expect(config).toEqual({ system_prompt: "SYS", temperature: 0.7, coach_mode: true });
      for (const k of ["model", "tts_model", "tts_voice", "grammar_check"]) expect(k in config).toBe(false);
    });

    it("sends a changed model", async () => {
      const { mock } = setup(routes({ "PATCH /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: CONFIG }) }));
      await screen.findByText("reply");
      await userEvent.click(await headerOption("conversation-settings"));
      await waitFor(() => expect(screen.getByTestId("settings-model").querySelectorAll("option").length).toBeGreaterThan(2));
      await userEvent.selectOptions(screen.getByTestId("settings-model"), "gpt-4o-mini");
      await userEvent.click(screen.getByTestId("settings-save"));
      await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
      expect(patchBody(mock)).toEqual({ ...CONFIG, model: "gpt-4o-mini" });
    });

    it("does not write untouched grammar check / coach mode defaults", async () => {
      const { mock } = setup(routes({ "PATCH /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: CONFIG }) }));
      await screen.findByText("reply");
      await userEvent.click(await headerOption("conversation-settings"));
      await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(2));
      await userEvent.click(screen.getByTestId("voice-option-echo"));
      expect(screen.getByTestId("settings-tts-voice")).toHaveAttribute("data-value", "echo");
      await userEvent.click(screen.getByTestId("settings-save"));
      await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
      expect(Object.keys(patchBody(mock)).sort()).toEqual(["model", "system_prompt", "temperature", "tts_model", "tts_voice"]);
    });
  });

  it("discards a partially streamed reply on failure: error bubble replaces it, nothing is saved", async () => {
    const { mock } = setup(routes({
      "POST /api/ai/chat/completions": () => sse([delta("Half an ans"), 'data: {"error": "Upstream unavailable"}\n\n']),
    }));
    await screen.findByText("reply");
    await userEvent.type(await textMode(), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByText("The AI service is unavailable. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(/Half an ans/)).toBeNull();
    expect(posted(mock)).toHaveLength(0);
  });

  it("does not double-send on rapid submits", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { mock } = setup(routes({
      "POST /api/ai/chat/completions": async () => { await gate; return sse([delta("Done"), "data: [DONE]\n\n"]); },
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: CONFIG }),
    }));
    await screen.findByText("reply");
    await userEvent.type(await textMode(), "Hi");
    const form = screen.getByTestId("chat-input").closest("form")!;
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
    });
    release();
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Done"));
    expect(mock.calls.filter((c) => c.url.pathname === "/api/ai/chat/completions")).toHaveLength(1);
    expect(screen.getAllByTestId("message-user")).toHaveLength(1);
  });

  it("aborts the stream on unmount without saving", async () => {
    let aborted = false;
    const { mock, view } = setup(routes({
      "POST /api/ai/chat/completions": (req: any) => {
        req.signal?.addEventListener("abort", () => { aborted = true; });
        return new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "text/event-stream" } });
      },
    }));
    await screen.findByText("reply");
    await userEvent.type(await textMode(), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/ai/chat/completions")).toBe(true));
    view.unmount();
    await waitFor(() => expect(aborted).toBe(true));
    expect(posted(mock)).toHaveLength(0);
  });

  it("never renders reasoning content", async () => {
    setup(routes({
      "POST /api/ai/chat/completions": () => sse([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "SECRET THOUGHTS" } }] })}\n\n`,
        delta("Answer"), "data: [DONE]\n\n",
      ]),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: CONFIG }),
    }));
    await screen.findByText("reply");
    await userEvent.type(await textMode(), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Answer"));
    expect(screen.queryByText(/SECRET THOUGHTS/)).toBeNull();
  });

  it("drops a failed unsent turn when a new message is sent, keeping it out of history", async () => {
    let attempt = 0;
    const { mock } = setup(routes({
      "POST /api/ai/chat/completions": () => (++attempt === 1 ? sse(['data: {"error": "Upstream unavailable"}\n\n']) : sse([delta("Fine"), "data: [DONE]\n\n"])),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Next", config: CONFIG }),
    }));
    await screen.findByText("reply");
    await userEvent.type(await textMode(), "Failed one");
    await userEvent.click(screen.getByTestId("chat-send"));
    await screen.findByTestId("message-retry");
    await userEvent.type(await textMode(), "Next");
    await userEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Fine"));
    expect(screen.queryByText("Failed one")).toBeNull();
    expect(screen.queryByTestId("message-retry")).toBeNull();
    const second = JSON.parse(mock.calls.filter((c) => c.url.pathname === "/api/ai/chat/completions")[1].body as string);
    expect(second.messages.map((m: any) => m.content)).toEqual(["SYS", "Earlier **reply**", "Next"]);
    await waitFor(() => expect(posted(mock)).toHaveLength(1));
  });

  it("shows the generic empty-reply message for a 502 empty stream and does not save", async () => {
    const { mock } = setup(routes({ "POST /api/ai/chat/completions": () => sse(["data: [DONE]\n\n"]) }));
    await screen.findByText("reply");
    await userEvent.type(await textMode(), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByText("The AI returned an empty reply.")).toBeInTheDocument();
    expect(posted(mock)).toHaveLength(0);
  });

  it("keeps the settings sheet open when saving fails", async () => {
    const { mock } = setup(routes({ "PATCH /api/conversations/c1": () => json({ error: "boom" }, 500) }));
    await screen.findByText("reply");
    await userEvent.click(await headerOption("conversation-settings"));
    await userEvent.click(screen.getByTestId("settings-coach-mode")); // 有改动才会 PATCH
    await userEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    await waitFor(() => expect(screen.getByTestId("settings-save")).not.toBeDisabled());
    expect(screen.getByTestId("settings-save")).toBeInTheDocument();
  });

  it("offers read-aloud on finished assistant messages", async () => {
    setup(routes());
    await screen.findByText("reply");
    expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "idle");
  });

  describe("auto-scroll", () => {
    const layout = (el: HTMLElement, scrollTop: number) => {
      Object.defineProperty(el, "scrollHeight", { configurable: true, value: 1000 });
      Object.defineProperty(el, "clientHeight", { configurable: true, value: 400 });
      Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: scrollTop });
    };
    const streaming = () => {
      let push!: (s: string) => void;
      let close!: () => void;
      const enc = new TextEncoder();
      const res = new Response(new ReadableStream({ start(c) { push = (s) => c.enqueue(enc.encode(s)); close = () => c.close(); } }), {
        headers: { "Content-Type": "text/event-stream" },
      });
      return { res, push: (t: string) => push(delta(t)), close: () => { push("data: [DONE]\n\n"); close(); } };
    };

    it.each([
      ["a scrolled-up user is not pulled down while streaming", 100, false],
      ["a user at the bottom follows the stream", 590, true],
    ])("%s", async (_name, scrollTop, follows) => {
      const stream = streaming();
      setup(routes({
        "POST /api/ai/chat/completions": () => stream.res,
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: CONFIG }),
      }));
      await screen.findByText("reply");
      const list = screen.getByTestId("message-list");
      const scrollTo = vi.fn();
      list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
      layout(list, scrollTop);
      act(() => { list.dispatchEvent(new Event("scroll")); });
      await userEvent.type(await textMode(), "Hi");
      await userEvent.click(screen.getByTestId("chat-send"));
      // sending itself scrolls once (user just sent a message)
      await waitFor(() => expect(scrollTo).toHaveBeenCalled());
      scrollTo.mockClear();
      // user then scrolls to the position under test
      layout(list, scrollTop);
      act(() => { list.dispatchEvent(new Event("scroll")); });
      await act(async () => { stream.push("token one "); });
      await screen.findByText(/token one/);
      await act(async () => { stream.push("token two"); });
      await screen.findByText(/token two/);
      if (follows) expect(scrollTo).toHaveBeenCalled();
      else expect(scrollTo).not.toHaveBeenCalled();
      await act(async () => { stream.close(); });
    });
  });

  it("tells the user when a reply has nothing to read aloud, without calling the speech API", async () => {
    const spy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { mock } = setup(routes({
      "GET /api/conversations/c1/messages": () => json({ messages: [{ id: "m0", conversation_id: "c1", role: "assistant", content: "```js" + String.fromCharCode(10) + "x()" + String.fromCharCode(10) + "```" }] }),
    }));
    await userEvent.click(await screen.findByTestId("message-tts"));
    expect(spy).toHaveBeenCalledWith("There is nothing to read aloud in this reply.");
    expect(mock.calls.some((c) => c.url.pathname === "/api/ai/audio/speech")).toBe(false);
    spy.mockRestore();
  });

  describe("switching conversations", () => {
    const c2Routes = {
      "GET /api/conversations/c2": () => json({ id: "c2", name: "Other chat", config: CONFIG }),
      "GET /api/conversations/c2/messages": () => json({ messages: [{ id: "n0", conversation_id: "c2", role: "assistant", content: "Second chat hello" }] }),
    };

    it("does not apply a late rename of the previous conversation to the new one", async () => {
      let releasePatch!: () => void;
      const patchGate = new Promise<void>((r) => (releasePatch = r));
      const second = (() => {
        let close!: () => void;
        const res = new Response(new ReadableStream({ start(c) { close = () => c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
        return { res, close };
      })();
      let turn = 0;
      setup(routes({
        ...c2Routes,
        "POST /api/ai/chat/completions": () => (++turn === 1 ? sse([delta("Hello"), DONE_EVENT]) : second.res),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": async () => { await patchGate; return json({ id: "c1", name: "Renamed first", config: CONFIG }); },
      }));
      await screen.findByText("reply");
      await userEvent.type(await textMode(), "Hi");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hello"));
      await waitFor(() => expect(screen.getByTestId("chat-send")).toBeDisabled()); // input emptied; sending finished
      await userEvent.type(await textMode(), "Again");
      await userEvent.click(screen.getByTestId("chat-send")); // second turn overlaps the pending rename
      await waitFor(() => expect(turn).toBe(2));
      await act(async () => { goTo("/chat/c2"); });
      expect(await screen.findByText("Second chat hello")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Other chat");
      await act(async () => { releasePatch(); });
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Other chat");
    });

    it("stops read-aloud playback when the conversation changes", async () => {
      setup(routes({ ...c2Routes, "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) }));
      await userEvent.click(await screen.findByTestId("message-tts"));
      await waitFor(() => expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "playing"));
      vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
      await act(async () => { goTo("/chat/c2"); });
      await screen.findByText("Second chat hello");
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
      expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "idle");
    });

    it("scrolls a newly opened conversation to the bottom even if the previous one was scrolled up", async () => {
      setup(routes(c2Routes));
      await screen.findByText("reply");
      const list = screen.getByTestId("message-list");
      Object.defineProperty(list, "scrollHeight", { configurable: true, value: 1000 });
      Object.defineProperty(list, "clientHeight", { configurable: true, value: 400 });
      Object.defineProperty(list, "scrollTop", { configurable: true, writable: true, value: 100 });
      act(() => { list.dispatchEvent(new Event("scroll")); });
      const scrollTo = vi.fn();
      list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
      await act(async () => { goTo("/chat/c2"); });
      await screen.findByText("Second chat hello");
      expect(scrollTo).toHaveBeenCalledWith({ top: 1000 });
    });
  });

  describe("translation", () => {
    beforeEach(async () => {
      await deleteDb();
      resetKvCacheForTests();
      localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
    });
    afterEach(async () => {
      localStorage.clear();
      await i18n.changeLanguage("en");
    });
    const translateRoute = (calls: string[]) => (call: { body: BodyInit | null | undefined }) => {
      const body = JSON.parse(call.body as string);
      if (body.stream) return sse([delta("New reply"), DONE_EVENT]);
      calls.push(body.messages.at(-1).content);
      return json({ choices: [{ message: { content: "译文" } }] });
    };

    it("translates a reply on demand and toggles it without refetching", async () => {
      const calls: string[] = [];
      setup(routes({ "POST /api/ai/chat/completions": translateRoute(calls) }));
      await screen.findByText("reply");
      await userEvent.click(screen.getByTestId("message-translate"));
      await waitFor(() => expect(screen.getByTestId("message-translation")).toHaveAttribute("data-status", "done"));
      expect(screen.getByTestId("message-translation")).toHaveTextContent("译文");
      await userEvent.click(screen.getByTestId("message-translate"));
      expect(screen.queryByTestId("message-translation")).toBeNull();
      await userEvent.click(screen.getByTestId("message-translate"));
      expect(screen.getByTestId("message-translation")).toHaveTextContent("译文");
      expect(calls).toHaveLength(1);
    });

    it("hides translation when the app language is English", async () => {
      localStorage.clear();
      setup(routes());
      await screen.findByText("reply");
      expect(screen.queryByTestId("message-translate")).toBeNull();
      await headerOption("conversation-autospeak"); // 选项面板已打开:里面没有双语开关
      expect(screen.getByTestId("conversation-options-panel")).toBeInTheDocument();
      expect(screen.queryByTestId("conversation-bilingual")).toBeNull();
    });

    it("bilingual mode translates each new reply once when it finishes", async () => {
      const calls: string[] = [];
      setup(routes({
        "GET /api/conversations/c1": () => json({ id: "c1", name: "Chat", config: { ...CONFIG, bilingual: true } }),
        "POST /api/ai/chat/completions": translateRoute(calls),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
      }));
      await screen.findByText("reply");
      expect(await headerOption("conversation-bilingual")).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByTestId("message-translation")).toBeNull(); // 不补译旧消息
      await userEvent.type(await textMode(), "Hi");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getByTestId("message-translation")).toHaveAttribute("data-status", "done"));
      expect(screen.getAllByTestId("message-translation")).toHaveLength(1);
      expect(calls).toEqual([expect.stringContaining("New reply")]);
    });

    it("does not write defaults-filled keys when toggling before the server config loads, and ignores a double click", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const never = () => new Promise<Response>(() => {});
      const { mock } = setup(routes({
        "GET /api/config/gpt_providers": never, "GET /api/config/default_gpt_preset": never,
        "GET /api/config/tts_providers_v2": never, "GET /api/config/default_tts_preset": never,
        "GET /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: { system_prompt: "SYS" } }),
        "PATCH /api/conversations/c1": async () => { await gate; return json({ id: "c1", name: "New conversation", config: { system_prompt: "SYS", bilingual: true } }); },
      }));
      await screen.findByText("reply");
      const toggle = await headerOption("conversation-bilingual");
      await userEvent.click(toggle);
      await userEvent.click(toggle);
      expect(toggle).toBeDisabled();
      release();
      await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
      const patches = mock.calls.filter((c) => c.method === "PATCH");
      expect(patches).toHaveLength(1);
      const config = JSON.parse(patches[0].body as string).config;
      expect(config).toEqual({ system_prompt: "SYS", bilingual: true });
    });

    describe("scrolling with translations", () => {
      const layout = (el: HTMLElement, scrollTop: number) => {
        Object.defineProperty(el, "scrollHeight", { configurable: true, value: 1000 });
        Object.defineProperty(el, "clientHeight", { configurable: true, value: 400 });
        Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: scrollTop });
      };
      it.each([
        ["a scrolled-up user is not moved when a translation arrives", 100, false],
        ["a user at the bottom is followed when a translation arrives", 590, true],
      ])("%s", async (_name, scrollTop, follows) => {
        setup(routes({ "POST /api/ai/chat/completions": translateRoute([]) }));
        await screen.findByText("reply");
        const list = screen.getByTestId("message-list");
        const scrollTo = vi.fn();
        list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
        layout(list, scrollTop);
        act(() => { list.dispatchEvent(new Event("scroll")); });
        scrollTo.mockClear();
        await userEvent.click(screen.getByTestId("message-translate"));
        await waitFor(() => expect(screen.getByTestId("message-translation")).toHaveAttribute("data-status", "done"));
        if (follows) expect(scrollTo).toHaveBeenCalledWith({ top: 1000 });
        else expect(scrollTo).not.toHaveBeenCalled();
      });
    });

    it("the header switch saves the bilingual option", async () => {
      const { mock } = setup(routes({ "PATCH /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: { ...CONFIG, bilingual: true } }) }));
      await screen.findByText("reply");
      await userEvent.click(await headerOption("conversation-bilingual"));
      await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
      expect(JSON.parse(mock.calls.find((c) => c.method === "PATCH")!.body as string).config).toMatchObject({ bilingual: true, system_prompt: "SYS" });
      await waitFor(() => expect(screen.getByTestId("conversation-bilingual")).toHaveAttribute("aria-pressed", "true"));
    });
  });

  it("opens the practice panel for a reply", async () => {
    setup(routes());
    await screen.findByText("reply");
    await userEvent.click(screen.getByTestId("message-practice"));
    expect(await screen.findAllByTestId("practice-sentence")).toHaveLength(1);
    expect(screen.getByTestId("practice-sentence")).toHaveTextContent("Earlier reply");
  });

  describe("voice messages", () => {
    let spy: MockInstance;
    beforeEach(() => { spy = vi.spyOn(toast, "error").mockImplementation(() => ""); });
    afterEach(() => spy.mockRestore());
    const SAVE_OK = () => json({ messages: [{ id: "m1" }, { id: "m2" }] });
    const RENAME = () => json({ id: "c1", name: "x", config: CONFIG });
    const NOT_SAVED = "The reply was shown but could not be saved.";
    /** 语音轮次的完整路由;需要定制的接口通过 extra 覆盖 */
    const voiceRoutes = (extra: Record<string, Handler> = {}) => routes({
      "POST /api/ai/audio/transcriptions": () => json({ text: "I like apples" }),
      "POST /api/speech/assessments": () => json(ASSESSED),
      "POST /api/ai/chat/completions": () => sse([delta("Me too!"), DONE_EVENT]),
      "POST /api/conversations/c1/messages": SAVE_OK,
      "PATCH /api/conversations/c1": RENAME,
      ...extra,
    });
    const C2 = {
      "GET /api/conversations/c2": () => json({ id: "c2", name: "Other chat", config: CONFIG }),
      "GET /api/conversations/c2/messages": () => json({ messages: [{ id: "n0", conversation_id: "c2", role: "assistant", content: "Second chat hello" }] }),
    };
    const hang = (onAbort: () => void): Handler => (call) => new Promise<Response>((_resolve, reject) => {
      call.signal?.addEventListener("abort", () => { onAbort(); reject(new DOMException("Aborted", "AbortError")); });
    });
    const hangingStream = (onAbort: () => void): Handler => (call) => {
      call.signal?.addEventListener("abort", onAbort);
      return new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "text/event-stream" } });
    };
    const msgPosts = (mock: ReturnType<typeof createFetchMock>) => callsTo(mock, "POST", "/api/conversations/c1/messages");
    const deletes = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.method === "DELETE");
    const patchedMessages = (mock: ReturnType<typeof createFetchMock>) =>
      mock.calls.filter((c) => c.method === "PATCH" && c.url.pathname.startsWith("/api/messages/"));
    const lastToastAction = (spy: { mock: { calls: unknown[][] } }) =>
      (spy.mock.calls.at(-1)![1] as { action: { onClick(): void } }).action;
    const notSavedToasts = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => c[0] === NOT_SAVED);

    it("shows the transcript, streams the reply right away and patches a late assessment onto the saved message", async () => {
      const assessment = gate();
      const fake = createFakeRecorderEnv();
      const { mock } = setup(routes({
        "POST /api/ai/audio/transcriptions": () => json({ text: "I like apples" }),
        "POST /api/speech/assessments": async () => { await assessment.promise; return json(ASSESSED); },
        "POST /api/ai/chat/completions": () => sse([delta("Me too!"), DONE_EVENT]),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/messages/m1": () => json({ id: "m1" }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Fruit chat", config: CONFIG }),
      }), fake.env);
      await screen.findByText("reply");
      await recordAndSend();
      const bubble = await screen.findByTestId("message-user");
      expect(bubble).toHaveTextContent("I like apples");
      expect(bubble).toHaveAttribute("data-voice", "sent");
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Me too!"));
      const chat = JSON.parse(callsTo(mock, "POST", "/api/ai/chat/completions")[0].body as string);
      expect(chat.messages.at(-1)).toEqual({ role: "user", content: "I like apples" });
      expect((callsTo(mock, "POST", "/api/ai/audio/transcriptions")[0].body as FormData).has("language")).toBe(false);
      await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
      expect(JSON.parse(callsTo(mock, "POST", "/api/conversations/c1/messages")[0].body as string).messages[0])
        .toEqual({ role: "user", content: "I like apples" }); // 评测还没到:不带 assessment_id
      expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "pending");
      await act(async () => { assessment.release(); });
      await waitFor(() => expect(callsTo(mock, "PATCH", "/api/messages/m1")).toHaveLength(1));
      expect(JSON.parse(callsTo(mock, "PATCH", "/api/messages/m1")[0].body as string)).toEqual({ assessment_id: "a1" });
      expect(screen.getByTestId("badge-pronunciation")).toHaveTextContent("Pronunciation 82");
      expect(screen.getByTestId("voice-word-poor")).toHaveTextContent("like");
      const form = callsTo(mock, "POST", "/api/speech/assessments")[0].body as FormData;
      expect([form.get("reference"), form.get("save"), form.get("source")]).toEqual(["I like apples", "true", "chat"]);
    });

    it("saves an assessment that arrived before the reply finished together with the message", async () => {
      const reply = gate();
      const { mock } = setup(routes({
        "POST /api/ai/audio/transcriptions": () => json({ text: "I like apples" }),
        "POST /api/speech/assessments": () => json(ASSESSED),
        "POST /api/ai/chat/completions": async () => { await reply.promise; return sse([delta("Nice"), DONE_EVENT]); },
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
      await act(async () => { reply.release(); });
      await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
      expect(JSON.parse(callsTo(mock, "POST", "/api/conversations/c1/messages")[0].body as string).messages[0])
        .toEqual({ role: "user", content: "I like apples", assessment_id: "a1" });
      expect(mock.calls.some((c) => c.method === "PATCH" && c.url.pathname.startsWith("/api/messages/"))).toBe(false);
    });

    it("patches an assessment that arrives while the pair is being saved", async () => {
      const save = gate();
      const assessment = gate();
      const { mock } = setup(voiceRoutes({
        "POST /api/speech/assessments": async () => { await assessment.promise; return json(ASSESSED); },
        "POST /api/conversations/c1/messages": async () => { await save.promise; return SAVE_OK(); },
        "PATCH /api/messages/m1": () => json({ id: "m1" }),
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await waitFor(() => expect(msgPosts(mock)).toHaveLength(1));
      expect(bodyOf(msgPosts(mock)[0]).messages[0]).toEqual({ role: "user", content: "I like apples" });
      await act(async () => { assessment.release(); });
      await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
      expect(patchedMessages(mock)).toHaveLength(0); // 消息还没有 id:等保存完成再补写
      await act(async () => { save.release(); });
      await waitFor(() => expect(patchedMessages(mock)).toHaveLength(1));
      expect(bodyOf(patchedMessages(mock)[0])).toEqual({ assessment_id: "a1" });
    });

    it("cancel discards the recording without any request and releases the microphone", async () => {
      const fake = createFakeRecorderEnv();
      const { mock } = setup(routes(), fake.env);
      await screen.findByText("reply");
      // 懒加载的角色控件会在任意时刻请求一次 /api/agents/config:不计入
      const own = () => mock.calls.filter((c) => !c.url.pathname.startsWith("/api/agents/")).length;
      const before = own();
      await startRecording();
      expect(screen.getByTestId("voice-timer")).toHaveTextContent("00:00 / 01:00");
      expect(screen.queryByTestId("chat-input")).toBeNull(); // 录音时输入框让位给计时条
      await userEvent.click(screen.getByTestId("chat-mic-cancel"));
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle"));
      expect(fake.track.stop).toHaveBeenCalled();
      expect(own()).toBe(before);
      expect(screen.queryAllByTestId("message-user")).toHaveLength(0);
    });

    it("cancel during transcription aborts it, removes the draft bubble and sends nothing", async () => {
      let aborted = false;
      const { mock } = setup(voiceRoutes({ "POST /api/ai/audio/transcriptions": hang(() => { aborted = true; }) }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      expect(await screen.findByTestId("voice-transcribing")).toBeInTheDocument();
      expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "processing");
      // R19:转写中不能打字——语音模式下没有输入框和发送按钮,切回文字输入的按钮也禁用
      expect(screen.queryByTestId("chat-input")).toBeNull();
      expect(screen.queryByTestId("chat-send")).toBeNull();
      expect(screen.getByTestId("chat-mode-toggle")).toBeDisabled();
      await userEvent.click(screen.getByTestId("chat-mic-cancel"));
      await waitFor(() => expect(aborted).toBe(true));
      await waitFor(() => expect(screen.queryAllByTestId("message-user")).toHaveLength(0));
      expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
      expect(await textMode()).toBeEnabled();
      expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(0);
      expect(callsTo(mock, "POST", "/api/speech/assessments")).toHaveLength(0);
    });

    it("keeps a failed transcription as an unsaved draft that can be retried", async () => {
      let attempt = 0;
      const { mock } = setup(routes({
        "POST /api/ai/audio/transcriptions": () => (++attempt === 1 ? json({ error: "Whisper upstream is not configured" }, 503) : json({ text: "Second time" })),
        "POST /api/speech/assessments": () => json(ASSESSED),
        "POST /api/ai/chat/completions": () => sse([delta("OK"), DONE_EVENT]),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      expect(await screen.findByTestId("voice-error")).toHaveTextContent("Speech-to-text is not configured on the server.");
      expect(screen.queryByTestId("message-retry")).toBeNull(); // 只有回复失败才有"重试"
      expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(0);
      expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(0);
      await userEvent.click(screen.getByTestId("voice-retry-transcribe"));
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("OK"));
      expect(screen.getAllByTestId("message-user")).toHaveLength(1);
    });

    it("an empty transcript is a failed draft, not a message", async () => {
      const { mock } = setup(voiceRoutes({ "POST /api/ai/audio/transcriptions": () => json({ text: "  " }) }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      expect(await screen.findByTestId("voice-error")).toHaveTextContent("No speech was recognized.");
      expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(0);
      await userEvent.click(screen.getByTestId("voice-discard"));
      expect(screen.queryAllByTestId("message-user")).toHaveLength(0);
    });

    it("a typed message drops an unsent voice draft and keeps it out of history", async () => {
      const { mock } = setup(routes({
        "POST /api/ai/audio/transcriptions": () => json({ error: "Upstream unavailable" }, 502),
        "POST /api/ai/chat/completions": () => sse([delta("Fine"), DONE_EVENT]),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await screen.findByTestId("voice-error");
      await userEvent.type(await textMode(), "Typed instead");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Fine"));
      expect(screen.queryByTestId("voice-error")).toBeNull();
      expect(screen.getAllByTestId("message-user")).toHaveLength(1);
      const chat = JSON.parse(callsTo(mock, "POST", "/api/ai/chat/completions")[0].body as string);
      expect(chat.messages.map((m: { content: string }) => m.content)).toEqual(["SYS", "Earlier **reply**", "Typed instead"]);
    });

    it("a new recording replaces an unsent voice draft", async () => {
      let attempt = 0;
      setup(voiceRoutes({
        "POST /api/ai/audio/transcriptions": () => (++attempt === 1 ? json({ error: "Upstream unavailable" }, 502) : json({ text: "Second try" })),
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await screen.findByTestId("voice-error");
      await recordAndSend();
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Me too!"));
      expect(screen.getAllByTestId("message-user")).toHaveLength(1);
      expect(screen.getByTestId("message-user")).toHaveTextContent("Second try");
    });

    it("retrying a failed voice reply re-sends the transcript without re-uploading or re-assessing", async () => {
      let attempt = 0;
      const { mock } = setup(routes({
        "POST /api/ai/audio/transcriptions": () => json({ text: "I like apples" }),
        "POST /api/speech/assessments": () => json(ASSESSED),
        "POST /api/ai/chat/completions": () => (++attempt === 1 ? sse(['data: {"error": "Upstream unavailable"}\n\n']) : sse([delta("Again"), DONE_EVENT])),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await screen.findByTestId("message-retry");
      await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
      await userEvent.click(screen.getByTestId("message-retry"));
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Again"));
      const chats = callsTo(mock, "POST", "/api/ai/chat/completions");
      expect(chats).toHaveLength(2);
      expect(chats[1].body).toEqual(chats[0].body);
      expect(callsTo(mock, "POST", "/api/ai/audio/transcriptions")).toHaveLength(1);
      expect(callsTo(mock, "POST", "/api/speech/assessments")).toHaveLength(1);
      expect(screen.getAllByTestId("message-user")).toHaveLength(1);
      expect(screen.getByTestId("message-user")).toHaveAttribute("data-voice", "sent");
      await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
      expect(JSON.parse(callsTo(mock, "POST", "/api/conversations/c1/messages")[0].body as string).messages[0].assessment_id).toBe("a1");
    });

    it("deletes the chat assessment of a failed voice turn that the user abandons", async () => {
      let attempt = 0;
      const { mock } = setup(routes({
        "POST /api/ai/audio/transcriptions": () => json({ text: "I like apples" }),
        "POST /api/speech/assessments": () => json(ASSESSED),
        "POST /api/ai/chat/completions": () => (++attempt === 1 ? sse(['data: {"error": "Upstream unavailable"}\n\n']) : sse([delta("Fine"), DONE_EVENT])),
        "DELETE /api/assessments/a1": () => json({ id: "a1" }),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await screen.findByTestId("message-retry");
      await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
      await userEvent.type(await textMode(), "Something else");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(callsTo(mock, "DELETE", "/api/assessments/a1")).toHaveLength(1));
    });

    it("deletes an assessment that arrives after its failed turn was abandoned", async () => {
      const assessment = gate();
      let attempt = 0;
      const { mock } = setup(voiceRoutes({
        "POST /api/speech/assessments": async () => { await assessment.promise; return json(ASSESSED); },
        "POST /api/ai/chat/completions": () => (++attempt === 1 ? sse(['data: {"error": "Upstream unavailable"}\n\n']) : sse([delta("Fine"), DONE_EVENT])),
        "DELETE /api/assessments/a1": () => json({ id: "a1" }),
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await screen.findByTestId("message-retry");
      await userEvent.type(await textMode(), "Something else");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Fine"));
      expect(deletes(mock)).toHaveLength(0); // 评测还在路上
      await act(async () => { assessment.release(); });
      await waitFor(() => expect(callsTo(mock, "DELETE", "/api/assessments/a1")).toHaveLength(1));
      expect(patchedMessages(mock)).toHaveLength(0);
    });

    it("skips assessment for a non-English transcript but still replies", async () => {
      const { mock } = setup(routes({
        "POST /api/ai/audio/transcriptions": () => json({ text: "我想喝咖啡" }),
        "POST /api/ai/chat/completions": () => sse([delta("Coffee?"), DONE_EVENT]),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Coffee?"));
      expect(screen.getByTestId("badge-pronunciation")).toHaveTextContent("Not assessed (not English)");
      expect(callsTo(mock, "POST", "/api/speech/assessments")).toHaveLength(0);
    });

    it("skips assessment for a transcript that is too long but still replies and saves", async () => {
      const long = `${"word ".repeat(500)}end`;
      const { mock } = setup(voiceRoutes({ "POST /api/ai/audio/transcriptions": () => json({ text: long }) }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Me too!"));
      expect(screen.getByTestId("badge-pronunciation")).toHaveTextContent("Not assessed (too long)");
      expect(callsTo(mock, "POST", "/api/speech/assessments")).toHaveLength(0);
      await waitFor(() => expect(msgPosts(mock)).toHaveLength(1));
    });

    it("a failed assessment shows an error badge but the turn is still replied to and saved without it", async () => {
      const { mock } = setup(voiceRoutes({ "POST /api/speech/assessments": () => json({ error: "Pronunciation assessment is not configured" }, 503) }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "error"));
      await waitFor(() => expect(msgPosts(mock)).toHaveLength(1));
      expect(bodyOf(msgPosts(mock)[0]).messages[0]).toEqual({ role: "user", content: "I like apples" });
      expect(patchedMessages(mock)).toHaveLength(0);
    });

    it("disables typing while recording and the mic while a reply streams", async () => {
      const reply = gate();
      setup(routes({
        "POST /api/ai/chat/completions": async () => { await reply.promise; return sse([delta("Done"), DONE_EVENT]); },
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await userEvent.type(await textMode(), "Hi");
      await userEvent.click(screen.getByTestId("chat-send"));
      // 回复流式期间切不到"按住说话"(麦克风不可用)
      await waitFor(() => expect(screen.getByTestId("chat-mode-toggle")).toBeDisabled());
      await act(async () => { reply.release(); });
      await waitFor(() => expect(screen.getByTestId("chat-mode-toggle")).toBeEnabled());
      await startRecording();
      // 回复结束后麦克风可用;录音时不能打字:没有输入框与发送按钮,也切不回文字输入
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording"));
      expect(screen.queryByTestId("chat-input")).toBeNull();
      expect(screen.queryByTestId("chat-send")).toBeNull();
      expect(screen.getByTestId("chat-mode-toggle")).toBeDisabled();
    });

    it("disables the mic while a voice reply streams too", async () => {
      const reply = gate();
      setup(voiceRoutes({ "POST /api/ai/chat/completions": async () => { await reply.promise; return sse([delta("Done"), DONE_EVENT]); } }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await waitFor(() => expect(screen.getByTestId("message-user")).toHaveTextContent("I like apples"));
      expect(screen.getByTestId("chat-mic")).toBeDisabled();
      await act(async () => { reply.release(); });
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toBeEnabled());
    });

    describe("kept drafts (background / mic loss)", () => {
      // 下面两例用假录音环境自己的 document 触发"保留草稿";真机上页面切后台时 document 本身变为 hidden,
      // 按住说话(含键盘后备)的监听先注册,先丢弃这次录音(R11)。这条路径见
      // "hold to talk" 里的 "hiding the real page while recording …" 用例。
      it("sends a kept recording on request", async () => {
        const fake = createFakeRecorderEnv();
        const { mock } = setup(voiceRoutes(), fake.env);
        await screen.findByText("reply");
        await startRecording();
        await act(async () => { fake.setHidden(); });
        expect(await screen.findByTestId("voice-send-kept")).toBeInTheDocument();
        expect(screen.getByTestId("message-user")).toHaveAttribute("data-voice", "kept");
        expect(callsTo(mock, "POST", "/api/ai/audio/transcriptions")).toHaveLength(0);
        await userEvent.click(screen.getByTestId("voice-send-kept"));
        await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Me too!"));
        expect(screen.getAllByTestId("message-user")).toHaveLength(1);
        expect(screen.getByTestId("message-user")).toHaveAttribute("data-voice", "sent");
        expect(callsTo(mock, "POST", "/api/ai/audio/transcriptions")).toHaveLength(1);
      });

      it("discards a kept recording without any request", async () => {
        const fake = createFakeRecorderEnv();
        const { mock } = setup(voiceRoutes(), fake.env);
        await screen.findByText("reply");
        await startRecording();
        await act(async () => { fake.setHidden(); });
        await userEvent.click(await screen.findByTestId("voice-discard"));
        expect(screen.queryAllByTestId("message-user")).toHaveLength(0);
        expect(callsTo(mock, "POST", "/api/ai/audio/transcriptions")).toHaveLength(0);
      });
    });

    describe("saving", () => {
      it("a failed pair-save is retried with the same turn and keeps its assessment", async () => {
        let attempt = 0;
        const { mock } = setup(voiceRoutes({
          "POST /api/conversations/c1/messages": () => (++attempt === 1 ? json({ error: "boom" }, 500) : SAVE_OK()),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done");
        expect(deletes(mock)).toHaveLength(0);
        await act(async () => { lastToastAction(spy).onClick(); });
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(2));
        expect(bodyOf(msgPosts(mock)[0])).toEqual(bodyOf(msgPosts(mock)[1]));
        expect(bodyOf(msgPosts(mock)[1]).messages[0]).toEqual({ role: "user", content: "I like apples", assessment_id: "a1" });
        expect(callsTo(mock, "POST", "/api/speech/assessments")).toHaveLength(1);
        expect(deletes(mock)).toHaveLength(0);
        expect(patchedMessages(mock)).toHaveLength(0);
      });

      it("an assessment that arrives after a failed save is attached to the retry", async () => {
        const assessment = gate();
        let attempt = 0;
        const { mock } = setup(voiceRoutes({
          "POST /api/speech/assessments": async () => { await assessment.promise; return json(ASSESSED); },
          "POST /api/conversations/c1/messages": () => (++attempt === 1 ? json({ error: "boom" }, 500) : SAVE_OK()),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await act(async () => { assessment.release(); });
        await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
        await act(async () => { lastToastAction(spy).onClick(); });
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(2));
        expect(bodyOf(msgPosts(mock)[0]).messages[0]).toEqual({ role: "user", content: "I like apples" });
        expect(bodyOf(msgPosts(mock)[1]).messages[0]).toEqual({ role: "user", content: "I like apples", assessment_id: "a1" });
        expect(patchedMessages(mock)).toHaveLength(0);
        expect(deletes(mock)).toHaveLength(0);
      });

      it("the next turn first re-saves the unsaved earlier one so the server order matches the screen", async () => {
        let saves = 0;
        let replies = 0;
        const { mock } = setup(routes({
          "POST /api/ai/chat/completions": () => sse([delta(`Reply ${++replies}`), DONE_EVENT]),
          "POST /api/conversations/c1/messages": () => (++saves === 1 ? json({ error: "boom" }, 500) : SAVE_OK()),
          "PATCH /api/conversations/c1": RENAME,
        }));
        await screen.findByText("reply");
        await userEvent.type(await textMode(), "One");
        await userEvent.click(screen.getByTestId("chat-send"));
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await userEvent.type(await textMode(), "Two");
        await userEvent.click(screen.getByTestId("chat-send"));
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(3));
        expect(msgPosts(mock).map((c) => bodyOf(c).messages[0].content)).toEqual(["One", "One", "Two"]);
      });

      it("a definite 4xx rejection does not block the following turns and cleans up its assessment", async () => {
        let saves = 0;
        const { mock } = setup(voiceRoutes({
          "POST /api/conversations/c1/messages": () => (++saves === 1 ? json({ error: "Invalid message" }, 400) : SAVE_OK()),
          "DELETE /api/assessments/a1": () => json({ id: "a1" }),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await waitFor(() => expect(callsTo(mock, "DELETE", "/api/assessments/a1")).toHaveLength(1));
        await userEvent.type(await textMode(), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(2));
        expect(bodyOf(msgPosts(mock)[1]).messages[0]).toEqual({ role: "user", content: "Typed" });
      });

      describe("409 on a retried save (the first one succeeded but its response was lost)", () => {
        const stored = (assessmentId: string | null) => json({ messages: [
          { id: "m0", conversation_id: "c1", role: "assistant", content: "Earlier **reply**" },
          ...(assessmentId ? [
            { id: "s1", conversation_id: "c1", role: "user", content: "I like apples", assessment_id: assessmentId },
            { id: "s2", conversation_id: "c1", role: "assistant", content: "Me too!" },
          ] : []),
        ] });

        it("reloads the messages and adopts the stored pair without deleting its assessment", async () => {
          let attempt = 0;
          let loads = 0;
          const { mock } = setup(voiceRoutes({
            "POST /api/conversations/c1/messages": () => (++attempt === 1 ? json({ error: "Too many requests, please try again later" }, 429)
              : attempt === 2 ? json({ error: "Assessment already linked to another message" }, 409) : SAVE_OK()),
            "GET /api/conversations/c1/messages": () => stored(++loads === 1 ? null : "a1"),
          }), createFakeRecorderEnv().env);
          await screen.findByText("reply");
          await recordAndSend();
          await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
          await act(async () => { lastToastAction(spy).onClick(); });
          await waitFor(() => expect(loads).toBe(2));
          // 下一轮排在队列后面:它的保存出现时,前一对的认领必然已经完成(确定性地证明没有重复保存)
          await userEvent.type(await textMode(), "Next");
          await userEvent.click(screen.getByTestId("chat-send"));
          await waitFor(() => expect(msgPosts(mock)).toHaveLength(3));
          expect(msgPosts(mock).map((c) => bodyOf(c).messages[0].content)).toEqual(["I like apples", "I like apples", "Next"]);
          expect(deletes(mock)).toHaveLength(0);
          expect(patchedMessages(mock)).toHaveLength(0);
          expect(notSavedToasts(spy)).toHaveLength(1); // 认领成功不再报错
          expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done");
        });

        it("saves again without the assessment when the reload shows nothing was stored, and never deletes it", async () => {
          let attempt = 0;
          const { mock } = setup(voiceRoutes({
            "POST /api/conversations/c1/messages": () => (++attempt === 1 ? json({ error: "Too many requests, please try again later" }, 429)
              : attempt === 2 ? json({ error: "Assessment already linked to another message" }, 409) : SAVE_OK()),
            "GET /api/conversations/c1/messages": () => stored(null),
          }), createFakeRecorderEnv().env);
          await screen.findByText("reply");
          await recordAndSend();
          await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
          await act(async () => { lastToastAction(spy).onClick(); });
          await waitFor(() => expect(msgPosts(mock)).toHaveLength(3));
          expect(bodyOf(msgPosts(mock)[2]).messages[0]).toEqual({ role: "user", content: "I like apples" });
          expect(deletes(mock)).toHaveLength(0);
          expect(patchedMessages(mock)).toHaveLength(0);
        });
      });
    });

    describe("lost responses (the server may have saved the pair)", () => {
      const M0 = { id: "m0", conversation_id: "c1", role: "assistant", content: "Earlier **reply**" };
      const pair = (user: string, reply: string, ids = ["s1", "s2"]) => [
        { id: ids[0], conversation_id: "c1", role: "user", content: user },
        { id: ids[1], conversation_id: "c1", role: "assistant", content: reply },
      ];
      const lose = () => { throw new TypeError("Failed to fetch"); };
      const sendTyped = async (text: string) => {
        await userEvent.type(await textMode(), text);
        await userEvent.click(screen.getByTestId("chat-send"));
      };

      it("a typed pair whose save response was lost is adopted on retry and never posted twice", async () => {
        let attempt = 0;
        let committed = false;
        const { mock } = setup(routes({
          "POST /api/ai/chat/completions": () => sse([delta("Reply"), DONE_EVENT]),
          "POST /api/conversations/c1/messages": () => { if (++attempt === 1) { committed = true; return lose(); } return SAVE_OK(); },
          "GET /api/conversations/c1/messages": () => json({ messages: [M0, ...(committed ? pair("Typed", "Reply") : [])] }),
          "PATCH /api/conversations/c1": RENAME,
        }));
        await screen.findByText("reply");
        await sendTyped("Typed");
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await act(async () => { lastToastAction(spy).onClick(); });
        await sendTyped("Next"); // 排在队列后面:它保存时,前一对的认领必然已经完成
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(2));
        expect(msgPosts(mock).map((c) => bodyOf(c).messages[0].content)).toEqual(["Typed", "Next"]);
        expect(notSavedToasts(spy)).toHaveLength(1);
      });

      it("a voice pair adopted after a lost response still gets its late assessment patched, once", async () => {
        const assessment = gate();
        let attempt = 0;
        let committed = false;
        const { mock } = setup(voiceRoutes({
          "POST /api/speech/assessments": async () => { await assessment.promise; return json(ASSESSED); },
          "POST /api/conversations/c1/messages": () => { if (++attempt === 1) { committed = true; return lose(); } return SAVE_OK(); },
          "GET /api/conversations/c1/messages": () => json({ messages: [M0, ...(committed ? pair("I like apples", "Me too!") : [])] }),
          "PATCH /api/messages/s1": () => json({ id: "s1" }),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await act(async () => { lastToastAction(spy).onClick(); });
        await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2));
        await act(async () => { assessment.release(); });
        await waitFor(() => expect(callsTo(mock, "PATCH", "/api/messages/s1")).toHaveLength(1));
        expect(bodyOf(callsTo(mock, "PATCH", "/api/messages/s1")[0])).toEqual({ assessment_id: "a1" });
        expect(msgPosts(mock)).toHaveLength(1);
        expect(deletes(mock)).toHaveLength(0);
      });

      it("leaving with a queued voice save whose last failure was ambiguous never deletes its assessment", async () => {
        const { mock, view } = setup(voiceRoutes({
          "POST /api/speech/assessments": () => json(ASSESSED),
          "POST /api/conversations/c1/messages": () => lose(),
          "DELETE /api/assessments/a1": () => json({ id: "a1" }),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
        view.unmount();
        await new Promise((r) => setTimeout(r, 50));
        expect(deletes(mock)).toHaveLength(0);
      });

      it("an ambiguous failure where nothing was stored reloads first and then posts", async () => {
        let attempt = 0;
        const { mock } = setup(routes({
          "POST /api/ai/chat/completions": () => sse([delta("Reply"), DONE_EVENT]),
          "POST /api/conversations/c1/messages": () => (++attempt === 1 ? lose() : SAVE_OK()),
          "PATCH /api/conversations/c1": RENAME,
        }));
        await screen.findByText("reply");
        await userEvent.type(await textMode(), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        const before = callsTo(mock, "GET", "/api/conversations/c1/messages").length;
        await act(async () => { lastToastAction(spy).onClick(); });
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(2));
        expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(before + 1);
        expect(bodyOf(msgPosts(mock)[1]).messages[0].content).toBe("Typed");
      });

      it("a failed reload during the ambiguity check never posts blindly, keeps the entry ambiguous and Retry can try again", async () => {
        let attempt = 0;
        let reloads = 0;
        const { mock } = setup(routes({
          "POST /api/ai/chat/completions": () => sse([delta("Reply"), DONE_EVENT]),
          "POST /api/conversations/c1/messages": () => (++attempt === 1 ? lose() : SAVE_OK()),
          "GET /api/conversations/c1/messages": () => (++reloads === 2 ? json({ error: "Network error" }, 500) : json({ messages: [M0] })),
          "PATCH /api/conversations/c1": RENAME,
        }));
        await screen.findByText("reply");
        await sendTyped("Typed");
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await act(async () => { lastToastAction(spy).onClick(); }); // reload fails (2nd GET)
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(2));
        expect(msgPosts(mock)).toHaveLength(1); // no blind POST
        await act(async () => { lastToastAction(spy).onClick(); }); // reload works now, nothing stored
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(2));
        expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(3);
        expect(bodyOf(msgPosts(mock)[1]).messages[0].content).toBe("Typed");
      });

      it("a late save of the previous conversation does not overwrite the new conversation's known tail", async () => {
        const slowSave = gate();
        let c2Attempt = 0;
        let c2Committed = false;
        let slowSaveDone = false;
        const N0 = { id: "n0", conversation_id: "c2", role: "assistant", content: "Second chat hello" };
        const { mock } = setup(routes({
          "GET /api/conversations/c2": () => json({ id: "c2", name: "Other chat", config: CONFIG }),
          "GET /api/conversations/c2/messages": () => json({ messages: [N0, ...(c2Committed ? [
            { id: "x1", conversation_id: "c2", role: "user", content: "Next" },
            { id: "x2", conversation_id: "c2", role: "assistant", content: "Reply" }] : [])] }),
          "POST /api/ai/chat/completions": () => sse([delta("Reply"), DONE_EVENT]),
          "POST /api/conversations/c1/messages": async () => { await slowSave.promise; slowSaveDone = true; return json({ messages: [{ id: "s1" }, { id: "s2" }] }); },
          "POST /api/conversations/c2/messages": () => { if (++c2Attempt === 1) { c2Committed = true; return lose(); } return json({ messages: [{ id: "y1" }, { id: "y2" }] }); },
          "PATCH /api/conversations/c1": RENAME,
          "PATCH /api/conversations/c2": () => json({ id: "c2", name: "x", config: CONFIG }),
        }));
        await screen.findByText("reply");
        await sendTyped("Typed"); // c1's save is held open
        await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
        await act(async () => { goTo("/chat/c2"); });
        await screen.findByText("Second chat hello");
        await act(async () => { slowSave.release(); }); // the stale save resolves inside the new conversation
        await waitFor(() => expect(slowSaveDone).toBe(true));
        await act(async () => { await Promise.resolve(); });
        await sendTyped("Next");
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await act(async () => { lastToastAction(spy).onClick(); });
        await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c2/messages")).toHaveLength(2));
        await act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); }); // let the claim finish
        expect(callsTo(mock, "POST", "/api/conversations/c2/messages")).toHaveLength(1); // adopted, never posted twice
      });

      it("a definite rejection is not treated as ambiguous: no reload before the retry", async () => {
        let attempt = 0;
        const { mock } = setup(routes({
          "POST /api/ai/chat/completions": () => sse([delta("Reply"), DONE_EVENT]),
          "POST /api/conversations/c1/messages": () => (++attempt === 1 ? json({ error: "Too many requests, please try again later" }, 429) : SAVE_OK()),
          "PATCH /api/conversations/c1": RENAME,
        }));
        await screen.findByText("reply");
        await userEvent.type(await textMode(), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        const before = callsTo(mock, "GET", "/api/conversations/c1/messages").length;
        await act(async () => { lastToastAction(spy).onClick(); });
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(2));
        expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(before);
      });

      it("keeps the order: an adopted earlier pair is followed by the next turn's own save", async () => {
        let attempt = 0;
        let committed = false;
        let replies = 0;
        const { mock } = setup(routes({
          "POST /api/ai/chat/completions": () => sse([delta(`Reply ${++replies}`), DONE_EVENT]),
          "POST /api/conversations/c1/messages": () => { if (++attempt === 1) { committed = true; return lose(); } return SAVE_OK(); },
          "GET /api/conversations/c1/messages": () => json({ messages: [M0, ...(committed ? pair("One", "Reply 1") : [])] }),
          "PATCH /api/conversations/c1": RENAME,
        }));
        await screen.findByText("reply");
        await sendTyped("One");
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await sendTyped("Two");
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(2));
        expect(msgPosts(mock).map((c) => bodyOf(c).messages[0].content)).toEqual(["One", "Two"]);
      });

      it("does not mistake an older identical pair for the lost one", async () => {
        let attempt = 0;
        const { mock } = setup(routes({
          "POST /api/ai/chat/completions": () => sse([delta("Hello"), DONE_EVENT]),
          "POST /api/conversations/c1/messages": () => {
            attempt += 1;
            return attempt === 1 ? SAVE_OK() : attempt === 2 ? lose() : json({ messages: [{ id: "m3" }, { id: "m4" }] });
          },
          // 服务端只有第一对(m1/m2)——与第二对文字完全相同,但它早已知道是已保存的
          "GET /api/conversations/c1/messages": () => json({ messages: [M0, ...pair("Hi", "Hello", ["m1", "m2"])] }),
          "PATCH /api/conversations/c1": RENAME,
        }));
        await screen.findByText("reply");
        await sendTyped("Hi");
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(1));
        await sendTyped("Hi");
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await act(async () => { lastToastAction(spy).onClick(); });
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(3));
      });
    });

    describe("save failures that cannot be fixed by retrying", () => {
      it("a message-limit 429 drops each pair with the translated reason and never blocks later turns", async () => {
        const { mock } = setup(voiceRoutes({
          "POST /api/conversations/c1/messages": () => json({ error: "Message limit reached" }, 429),
          "DELETE /api/assessments/a1": () => json({ id: "a1" }),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(spy).toHaveBeenCalledWith("This conversation is full. Start a new one."));
        await waitFor(() => expect(callsTo(mock, "DELETE", "/api/assessments/a1")).toHaveLength(1));
        expect(notSavedToasts(spy)).toHaveLength(0);
        await userEvent.type(await textMode(), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await waitFor(() => expect(spy.mock.calls.filter((c) => c[0] === "This conversation is full. Start a new one.")).toHaveLength(2));
        expect(msgPosts(mock)).toHaveLength(2); // 第一对没有被重发,队列没有堆积
        expect(bodyOf(msgPosts(mock)[1]).messages[0]).toEqual({ role: "user", content: "Typed" });
        expect(spy.mock.calls.every((c) => c[1] === undefined)).toBe(true); // 不再提供重试按钮
      });

      it("a 404 Assessment not found saves the pair again without the assessment instead of dropping it", async () => {
        const reply = gate();
        let attempt = 0;
        const { mock } = setup(voiceRoutes({
          "POST /api/ai/chat/completions": async () => { await reply.promise; return sse([delta("Me too!"), DONE_EVENT]); },
          "POST /api/conversations/c1/messages": () => (++attempt === 1 ? json({ error: "Assessment not found" }, 404) : SAVE_OK()),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
        await act(async () => { reply.release(); });
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(2));
        expect(bodyOf(msgPosts(mock)[0]).messages[0].assessment_id).toBe("a1");
        expect(bodyOf(msgPosts(mock)[1]).messages[0]).toEqual({ role: "user", content: "I like apples" });
        expect(deletes(mock)).toHaveLength(0);
        expect(patchedMessages(mock)).toHaveLength(0);
        expect(spy).not.toHaveBeenCalled();
      });
    });

    describe("save retry feedback and naming", () => {
      it("the toast Retry reports again when it fails again", async () => {
        const { mock } = setup(routes({
          "POST /api/ai/chat/completions": () => sse([delta("Reply"), DONE_EVENT]),
          "POST /api/conversations/c1/messages": () => json({ error: "boom" }, 500),
        }));
        await screen.findByText("reply");
        await userEvent.type(await textMode(), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await act(async () => { lastToastAction(spy).onClick(); });
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(2));
        expect(msgPosts(mock)).toHaveLength(2);
        expect(lastToastAction(spy)).toBeDefined(); // 新的提示仍可再次重试
      });

      it("names the conversation from the first pair that gets saved, even when that happens on retry", async () => {
        let attempt = 0;
        const { mock } = setup(routes({
          "POST /api/ai/chat/completions": () => sse([delta("Reply"), DONE_EVENT]),
          "POST /api/conversations/c1/messages": () => (++attempt === 1 ? json({ error: "boom" }, 500) : SAVE_OK()),
          "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Typed", config: CONFIG }),
        }));
        await screen.findByText("reply");
        await userEvent.type(await textMode(), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        expect(callsTo(mock, "PATCH", "/api/conversations/c1")).toHaveLength(0);
        await act(async () => { lastToastAction(spy).onClick(); });
        await waitFor(() => expect(callsTo(mock, "PATCH", "/api/conversations/c1")).toHaveLength(1));
        expect(bodyOf(callsTo(mock, "PATCH", "/api/conversations/c1")[0])).toEqual({ name: "Typed" });
        await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Typed"));
      });
    });

    describe("a voice message must not be lost to a reply retry", () => {
      const failingThenGated = () => {
        const second = gate();
        let attempt = 0;
        const handlers = voiceRoutes({
          "POST /api/ai/chat/completions": async () => {
            if (++attempt === 1) return sse(['data: {"error": "Upstream unavailable"}\n\n']);
            if (attempt === 2) { await second.promise; return sse([delta("Retried"), DONE_EVENT]); }
            return sse([delta("Voice reply"), DONE_EVENT]);
          },
        });
        return { second, handlers };
      };

      it("hides the reply Retry while a recording is in progress and brings it back after cancel", async () => {
        const { handlers } = failingThenGated();
        setup(handlers, createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await userEvent.type(await textMode(), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await screen.findByTestId("message-retry");
        await startRecording();
        expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording");
        expect(screen.queryByTestId("message-retry")).toBeNull();
        await userEvent.click(screen.getByTestId("chat-mic-cancel"));
        expect(await screen.findByTestId("message-retry")).toBeInTheDocument();
      });

      it("keeps a transcript that arrives while a retry streams as a draft the user can send or discard", async () => {
        const { second, handlers } = failingThenGated();
        const { mock } = setup(handlers, createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await userEvent.type(await textMode(), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await screen.findByTestId("message-retry");
        // 同一帧里点了录音和重试:两个点击都发生在重新渲染之前
        await voiceMode();
        act(() => {
          pressKey(screen.getByTestId("chat-mic"));
          fireEvent.click(screen.getByTestId("message-retry"));
        });
        await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording"));
        pressKey(screen.getByTestId("chat-mic")); // 停止并发送
        const held = await screen.findByTestId("voice-send-kept");
        expect(screen.getAllByTestId("message-user").at(-1)).toHaveAttribute("data-voice", "kept");
        expect(screen.getAllByTestId("message-user").at(-1)).toHaveTextContent("A reply was still in progress, so this recording was not sent yet.");
        expect(screen.queryByTestId("voice-transcribing")).toBeNull();
        expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(2); // 转写没有被悄悄吞掉也没有抢发
        await userEvent.click(held); // 回复还没结束:不会抢发
        expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(2);
        await act(async () => { second.release(); });
        await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Retried"));
        await userEvent.click(await screen.findByTestId("voice-send-kept"));
        await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Voice reply"));
        const chats = callsTo(mock, "POST", "/api/ai/chat/completions");
        expect(bodyOf(chats[2]).messages.at(-1)).toEqual({ role: "user", content: "I like apples" });
        expect(callsTo(mock, "POST", "/api/ai/audio/transcriptions")).toHaveLength(1);
        expect(screen.getAllByTestId("message-user").at(-1)).toHaveAttribute("data-voice", "sent");
      });

      it("sending a held transcript after the retry failed again drops the failed pair (no two consecutive user messages)", async () => {
        const second = gate();
        let attempt = 0;
        const { mock } = setup(voiceRoutes({
          "POST /api/ai/chat/completions": async () => {
            if (++attempt === 1) return sse(['data: {"error": "Upstream unavailable"}\n\n']);
            if (attempt === 2) { await second.promise; return sse(['data: {"error": "Upstream unavailable"}\n\n']); }
            return sse([delta("Voice reply"), DONE_EVENT]);
          },
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await userEvent.type(await textMode(), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await screen.findByTestId("message-retry");
        await voiceMode();
        act(() => {
          pressKey(screen.getByTestId("chat-mic"));
          fireEvent.click(screen.getByTestId("message-retry"));
        });
        await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording"));
        pressKey(screen.getByTestId("chat-mic"));
        await screen.findByTestId("voice-send-kept"); // held while the retry streams
        await act(async () => { second.release(); });
        await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveAttribute("data-status", "error"));
        await userEvent.click(await screen.findByTestId("voice-send-kept"));
        await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Voice reply"));
        const chats = callsTo(mock, "POST", "/api/ai/chat/completions");
        const sentMessages = bodyOf(chats[2]).messages as Array<{ role: string; content: string }>;
        expect(sentMessages.map((m) => m.role)).toEqual(["system", "assistant", "user"]);
        expect(sentMessages.at(-1)!.content).toBe("I like apples");
        expect(screen.getAllByTestId("message-user")).toHaveLength(1); // the failed "Typed" pair is gone from the screen
        expect(screen.queryByText("Typed")).toBeNull();
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(1));
        expect(bodyOf(msgPosts(mock)[0]).messages[0].content).toBe("I like apples");
      });

      it("a held transcript is dropped together with the failed pair when the user types a new message", async () => {
        const second = gate();
        let attempt = 0;
        const { mock } = setup(voiceRoutes({
          "POST /api/ai/chat/completions": async () => {
            if (++attempt === 1) return sse(['data: {"error": "Upstream unavailable"}\n\n']);
            if (attempt === 2) { await second.promise; return sse(['data: {"error": "Upstream unavailable"}\n\n']); }
            return sse([delta("Fresh"), DONE_EVENT]);
          },
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await userEvent.type(await textMode(), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await screen.findByTestId("message-retry");
        await voiceMode();
        act(() => {
          pressKey(screen.getByTestId("chat-mic"));
          fireEvent.click(screen.getByTestId("message-retry"));
        });
        await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording"));
        pressKey(screen.getByTestId("chat-mic"));
        await screen.findByTestId("voice-send-kept");
        await act(async () => { second.release(); });
        await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveAttribute("data-status", "error"));
        await userEvent.type(await textMode(), "Brand new");
        await userEvent.click(screen.getByTestId("chat-send"));
        await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Fresh"));
        const sentMessages = bodyOf(callsTo(mock, "POST", "/api/ai/chat/completions")[2]).messages as Array<{ role: string; content: string }>;
        expect(sentMessages.map((m) => m.role)).toEqual(["system", "assistant", "user"]);
        expect(sentMessages.at(-1)!.content).toBe("Brand new");
        expect(screen.getAllByTestId("message-user")).toHaveLength(1);
        expect(screen.queryByTestId("voice-send-kept")).toBeNull();
      });

      it("a held transcript can be discarded", async () => {
        const { second, handlers } = failingThenGated();
        setup(handlers, createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await userEvent.type(await textMode(), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await screen.findByTestId("message-retry");
        await voiceMode();
        act(() => {
          pressKey(screen.getByTestId("chat-mic"));
          fireEvent.click(screen.getByTestId("message-retry"));
        });
        await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording"));
        pressKey(screen.getByTestId("chat-mic"));
        await userEvent.click(await screen.findByTestId("voice-discard"));
        expect(screen.getAllByTestId("message-user")).toHaveLength(1);
        await act(async () => { second.release(); });
        await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Retried"));
        expect(screen.queryByTestId("voice-send-kept")).toBeNull();
      });
    });

    it("starting a recording takes the audio focus: read-aloud stops and the focus is released afterwards", async () => {
      const fake = createFakeRecorderEnv();
      setup(routes({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) }), fake.env);
      await userEvent.click(await screen.findByTestId("message-tts"));
      await waitFor(() => expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "playing"));
      await startRecording();
      await waitFor(() => expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "idle"));
      expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording");
      await userEvent.click(screen.getByTestId("chat-mic-cancel"));
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle"));
      // 焦点已释放:再次朗读正常
      await userEvent.click(screen.getByTestId("message-tts"));
      await waitFor(() => expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "playing"));
    });

    it("read-aloud cannot start while a recording is active and works again afterwards", async () => {
      const fake = createFakeRecorderEnv();
      const { mock } = setup(routes({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) }), fake.env);
      await screen.findByTestId("message-tts");
      await startRecording();
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording"));
      expect(screen.getByTestId("message-tts")).toBeDisabled();
      await userEvent.click(screen.getByTestId("message-tts"));
      expect(callsTo(mock, "POST", "/api/ai/audio/speech")).toHaveLength(0);
      expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "idle");
      await userEvent.click(screen.getByTestId("chat-mic-cancel"));
      await waitFor(() => expect(screen.getByTestId("message-tts")).toBeEnabled());
    });

    describe("leaving the page", () => {
      it("releases the microphone when the page unmounts mid-recording", async () => {
        const fake = createFakeRecorderEnv();
        const { view } = setup(routes(), fake.env);
        await screen.findByText("reply");
        await startRecording();
        view.unmount();
        await Promise.resolve();
        await Promise.resolve();
        expect(fake.track.stop).toHaveBeenCalled();
      });

      it("aborts the transcription on unmount and starts nothing else", async () => {
        let aborted = false;
        const { mock, view } = setup(voiceRoutes({ "POST /api/ai/audio/transcriptions": hang(() => { aborted = true; }) }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await screen.findByTestId("voice-transcribing");
        view.unmount();
        await waitFor(() => expect(aborted).toBe(true));
        await act(async () => {});
        expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(0);
        expect(callsTo(mock, "POST", "/api/speech/assessments")).toHaveLength(0);
        expect(msgPosts(mock)).toHaveLength(0);
      });

      it("aborts the reply and deletes the already-arrived assessment when unmounting mid-stream", async () => {
        let aborted = false;
        const { mock, view } = setup(voiceRoutes({
          "POST /api/ai/chat/completions": hangingStream(() => { aborted = true; }),
          "DELETE /api/assessments/a1": () => json({ id: "a1" }),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
        view.unmount();
        await waitFor(() => expect(aborted).toBe(true));
        await waitFor(() => expect(callsTo(mock, "DELETE", "/api/assessments/a1")).toHaveLength(1));
        expect(msgPosts(mock)).toHaveLength(0);
      });

      it("deletes an assessment that is still in flight when the page unmounts, once it arrives", async () => {
        const assessment = gate();
        const { mock, view } = setup(voiceRoutes({
          "POST /api/speech/assessments": async () => { await assessment.promise; return json(ASSESSED); },
          "POST /api/ai/chat/completions": hangingStream(() => undefined),
          "DELETE /api/assessments/a1": () => json({ id: "a1" }),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(callsTo(mock, "POST", "/api/speech/assessments")).toHaveLength(1));
        view.unmount();
        expect(deletes(mock)).toHaveLength(0);
        await act(async () => { assessment.release(); });
        await waitFor(() => expect(callsTo(mock, "DELETE", "/api/assessments/a1")).toHaveLength(1));
      });

      it("still links a late result when the page unmounts while the pair is being saved", async () => {
        const save = gate();
        const assessment = gate();
        const { mock, view } = setup(voiceRoutes({
          "POST /api/speech/assessments": async () => { await assessment.promise; return json(ASSESSED); },
          "POST /api/conversations/c1/messages": async () => { await save.promise; return SAVE_OK(); },
          "PATCH /api/messages/m1": () => json({ id: "m1" }),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(1));
        view.unmount();
        await act(async () => { save.release(); });
        await act(async () => { assessment.release(); });
        await waitFor(() => expect(patchedMessages(mock)).toHaveLength(1));
        expect(bodyOf(patchedMessages(mock)[0])).toEqual({ assessment_id: "a1" });
        expect(deletes(mock)).toHaveLength(0);
      });

      it("does not keep retrying a failed save after unmount, and cleans up the assessment", async () => {
        const save = gate();
        const { mock, view } = setup(voiceRoutes({
          "POST /api/conversations/c1/messages": async () => { await save.promise; return json({ error: "boom" }, 500); },
          "DELETE /api/assessments/a1": () => json({ id: "a1" }),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(1));
        await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
        view.unmount();
        await act(async () => { save.release(); });
        await waitFor(() => expect(callsTo(mock, "DELETE", "/api/assessments/a1")).toHaveLength(1));
        expect(msgPosts(mock)).toHaveLength(1);
      });

      it("switching conversation mid-recording releases the mic and shows no draft in the new one", async () => {
        const fake = createFakeRecorderEnv();
        const { mock } = setup(routes(C2), fake.env);
        await screen.findByText("reply");
        await startRecording();
        await act(async () => { goTo("/chat/c2"); });
        await screen.findByText("Second chat hello");
        expect(fake.track.stop).toHaveBeenCalled();
        expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
        expect(screen.queryByTestId("voice-recording")).toBeNull();
        expect(await textMode()).toBeEnabled();
        expect(screen.queryAllByTestId("message-user")).toHaveLength(0);
        expect(callsTo(mock, "POST", "/api/ai/audio/transcriptions")).toHaveLength(0);
      });

      it("switching conversation mid-transcription aborts it and drops the draft", async () => {
        let aborted = false;
        const { mock } = setup(voiceRoutes({ ...C2, "POST /api/ai/audio/transcriptions": hang(() => { aborted = true; }) }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await screen.findByTestId("voice-transcribing");
        await act(async () => { goTo("/chat/c2"); });
        await screen.findByText("Second chat hello");
        await waitFor(() => expect(aborted).toBe(true));
        expect(screen.queryAllByTestId("message-user")).toHaveLength(0);
        expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
        expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(0);
      });

      it("switching conversation mid-reply deletes the open assessment and never saves into the new one", async () => {
        const { mock } = setup(voiceRoutes({
          ...C2,
          "POST /api/ai/chat/completions": hangingStream(() => undefined),
          "DELETE /api/assessments/a1": () => json({ id: "a1" }),
        }), createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
        await act(async () => { goTo("/chat/c2"); });
        await screen.findByText("Second chat hello");
        await waitFor(() => expect(callsTo(mock, "DELETE", "/api/assessments/a1")).toHaveLength(1));
        expect(screen.queryAllByTestId("message-user")).toHaveLength(0);
        expect(mock.calls.some((c) => c.method === "POST" && c.url.pathname.endsWith("/messages"))).toBe(false);
      });
    });

    describe("StrictMode", () => {
      it("runs a voice turn exactly once and saves it with its assessment", async () => {
        const { mock } = setup(voiceRoutes(), createFakeRecorderEnv().env, { strict: true });
        await screen.findByText("reply");
        await recordAndSend();
        await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Me too!"));
        await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(1));
        expect(callsTo(mock, "POST", "/api/ai/audio/transcriptions")).toHaveLength(1);
        expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(1);
        expect(callsTo(mock, "POST", "/api/speech/assessments")).toHaveLength(1);
        expect(bodyOf(msgPosts(mock)[0]).messages[0]).toEqual({ role: "user", content: "I like apples", assessment_id: "a1" });
        expect(deletes(mock)).toHaveLength(0);
        expect(screen.getAllByTestId("message-user")).toHaveLength(1);
      });

      it("releases the microphone on unmount mid-recording", async () => {
        const fake = createFakeRecorderEnv();
        const { view } = setup(routes(), fake.env, { strict: true });
        await screen.findByText("reply");
        await startRecording();
        view.unmount();
        await Promise.resolve();
        await Promise.resolve();
        expect(fake.track.stop).toHaveBeenCalled();
      });
    });

    it("shows saved voice messages after reload with their score and poor words", async () => {
      setup(routes({
        "GET /api/conversations/c1/messages": () => json({ messages: [
          { id: "m1", conversation_id: "c1", role: "user", content: "I like apples", assessment_id: "a1",
            assessment: { id: "a1", scores: { pronunciation_score: 64, accuracy_score: 60, fluency_score: 70, completeness_score: 90 },
              words: [{ word: "like", accuracy_score: 40, error_type: "Mispronunciation" }] }, grammar: null },
          { id: "m2", conversation_id: "c1", role: "assistant", content: "Me too", assessment_id: null, assessment: null, grammar: null },
        ] }),
      }));
      expect(await screen.findByTestId("badge-pronunciation")).toHaveTextContent("Pronunciation 64");
      expect(screen.getByTestId("message-user")).toHaveAttribute("data-voice", "sent");
      expect(screen.getByTestId("voice-word-poor")).toHaveTextContent("like");
    });
  });

  describe("grammar", () => {
    const WRONG = { has_errors: true, corrected: "She doesn't like coffee.", errors: [{ original: "don't", corrected: "doesn't", category: "agreement", explanation: "主语是第三人称单数" }] };
    const RIGHT = { has_errors: false, corrected: "She doesn't like coffee.", errors: [] as never[] };
    const chatRoutes = (grammar: Handler, extra: Record<string, Handler> = {}) => routes({
      "POST /api/ai/grammar": grammar,
      "POST /api/ai/chat/completions": () => sse([delta("I see."), DONE_EVENT]),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      "PATCH /api/messages/m1": () => json({ id: "m1" }),
      ...extra,
    });
    beforeEach(async () => { await deleteDb(); resetKvCacheForTests(); localStorage.clear(); });

    it("flags errors in a typed message, shows details and offers the corrected sentence", async () => {
      const { mock } = setup(chatRoutes(() => json(WRONG), { "POST /api/practice-items": () => json({ id: "p1", text: "x", source: "grammar", created_at: "t" }) }));
      await screen.findByText("reply");
      await userEvent.type(await textMode(), "She don't like coffee.");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveTextContent("Grammar: 1 to fix"));
      expect(JSON.parse(callsTo(mock, "POST", "/api/ai/grammar")[0].body as string)).toEqual({ text: "She don't like coffee.", context: "Earlier **reply**" });
      await userEvent.click(screen.getByTestId("badge-grammar"));
      expect(await screen.findByTestId("grammar-issue")).toHaveTextContent("don't");
      expect(screen.getByTestId("grammar-issue")).toHaveTextContent("doesn't");
      expect(screen.getByTestId("grammar-issue")).toHaveTextContent("Agreement");
      expect(screen.getByTestId("grammar-corrected")).toHaveTextContent("She doesn't like coffee.");
      await userEvent.click(screen.getByTestId("grammar-save"));
      await waitFor(() => expect(callsTo(mock, "POST", "/api/practice-items")).toHaveLength(1));
      expect(JSON.parse(callsTo(mock, "POST", "/api/practice-items")[0].body as string)).toEqual({ text: "She doesn't like coffee.", source: "grammar" });
      await userEvent.click(screen.getByTestId("grammar-practice"));
      expect(screen.getByTestId("location")).toHaveTextContent("/practice");
    });

    it("shows a clean badge for a correct message and persists the result", async () => {
      const { mock } = setup(chatRoutes(() => json(RIGHT)));
      await screen.findByText("reply");
      await userEvent.type(await textMode(), "She doesn't like coffee.");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveAttribute("data-errors", "0"));
      await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
      const saved = JSON.parse(callsTo(mock, "POST", "/api/conversations/c1/messages")[0].body as string).messages[0];
      const patched = callsTo(mock, "PATCH", "/api/messages/m1").map((c) => JSON.parse(c.body as string));
      expect([saved.grammar, ...patched.map((p) => p.grammar)].filter(Boolean)).toEqual([RIGHT]);
    });

    it("the error badge's retry button re-requests the check", async () => {
      let attempt = 0;
      const { mock } = setup(chatRoutes(() => (++attempt === 1 ? json({ error: "Upstream unavailable" }, 502) : json(WRONG))));
      await screen.findByText("reply");
      await userEvent.type(await textMode(), "She don't like coffee.");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveAttribute("data-status", "error"));
      expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(1);
      await userEvent.click(screen.getByTestId("badge-grammar"));
      await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveAttribute("data-status", "done"));
      expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(2);
      expect(screen.getByTestId("badge-grammar")).toHaveTextContent("Grammar: 1 to fix");
    });

    it("a late grammar result does not pull a scrolled-up user to the bottom", async () => {
      const late = gate();
      setup(chatRoutes(async () => { await late.promise; return json(WRONG); }));
      await screen.findByText("reply");
      const list = screen.getByTestId("message-list");
      const scrollTo = vi.fn();
      list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
      const layout = (scrollTop: number) => {
        Object.defineProperty(list, "scrollHeight", { configurable: true, value: 1000 });
        Object.defineProperty(list, "clientHeight", { configurable: true, value: 400 });
        Object.defineProperty(list, "scrollTop", { configurable: true, writable: true, value: scrollTop });
        act(() => { list.dispatchEvent(new Event("scroll")); });
      };
      await userEvent.type(await textMode(), "She don't like coffee.");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("I see."));
      layout(100); // the user scrolled up
      scrollTo.mockClear();
      await act(async () => { late.release(); });
      await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveAttribute("data-status", "done"));
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it("gives a voice message a grammar badge too", async () => {
      const { mock } = setup(routes({
        "POST /api/ai/audio/transcriptions": () => json({ text: "She don't like coffee." }),
        "POST /api/speech/assessments": () => json(ASSESSED),
        "POST /api/ai/grammar": () => json(WRONG),
        "POST /api/ai/chat/completions": () => sse([delta("I see."), DONE_EVENT]),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
        "PATCH /api/messages/m1": () => json({ id: "m1" }),
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveTextContent("Grammar: 1 to fix"));
      expect(screen.getByTestId("badge-pronunciation")).toBeInTheDocument();
      expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(1);
    });

    it("renders no (empty) footer under a user message that has neither result", async () => {
      setup(chatRoutes(() => json(RIGHT)));
      await screen.findByText("reply");
      await userEvent.type(await textMode(), "Hi there");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("I see."));
      expect(screen.getAllByTestId("message-user")).toHaveLength(1);
      expect(screen.queryByTestId("message-footer")).toBeNull();
    });

    it("does not check short messages or when the switch is off", async () => {
      const { mock } = setup(chatRoutes(() => json(RIGHT), {
        "GET /api/conversations/c1": () => json({ id: "c1", name: "Chat", config: { ...CONFIG, grammar_check: false } }),
      }));
      await screen.findByText("reply");
      await userEvent.type(await textMode(), "She doesn't like coffee at all.");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("I see."));
      expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(0);
      expect(screen.queryByTestId("badge-grammar")).toBeNull();
    });

    it("skips messages with fewer than three English words", async () => {
      const { mock } = setup(chatRoutes(() => json(RIGHT)));
      await screen.findByText("reply");
      await userEvent.type(await textMode(), "Hi there");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("I see."));
      expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(0);
    });

    it("shows saved grammar results after reload", async () => {
      setup(routes({
        "GET /api/conversations/c1/messages": () => json({ messages: [
          { id: "m1", conversation_id: "c1", role: "user", content: "She don't like coffee.", assessment_id: null, assessment: null, grammar: WRONG },
        ] }),
      }));
      expect(await screen.findByTestId("badge-grammar")).toHaveTextContent("Grammar: 1 to fix");
    });
  });

  describe("coach mode", () => {
    const history = { messages: [
      { id: "m1", conversation_id: "c1", role: "user", content: "I sink so", assessment_id: "a1",
        assessment: { id: "a1", scores: { pronunciation_score: 61, accuracy_score: 60, fluency_score: 70, completeness_score: 90 },
          words: [{ word: "sink", accuracy_score: 30, error_type: "Mispronunciation" }] }, grammar: null as null },
      { id: "m2", conversation_id: "c1", role: "assistant", content: "Why?", assessment_id: null, assessment: null, grammar: null },
    ] };
    const run = async (coachMode: boolean) => {
      const { mock } = setup(routes({
        "GET /api/conversations/c1": () => json({ id: "c1", name: "Chat", config: { ...CONFIG, coach_mode: coachMode, grammar_check: false } }),
        "GET /api/conversations/c1/messages": () => json(history),
        "POST /api/ai/chat/completions": () => sse([delta("OK"), DONE_EVENT]),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m3" }, { id: "m4" }] }),
      }));
      await screen.findByText("Why?");
      await userEvent.type(await textMode(), "Because it is late");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(1));
      return JSON.parse(callsTo(mock, "POST", "/api/ai/chat/completions")[0].body as string).messages[0].content as string;
    };

    it("tells the AI about the previous message's mispronounced words", async () => {
      const system = await run(true);
      expect(system.startsWith("SYS\n\n")).toBe(true);
      expect(system).toContain("sink");
    });

    it("adds nothing when coach mode is off", async () => {
      expect(await run(false)).toBe("SYS");
    });
  });

  describe("coach mode on retry (results that arrived since the failed attempt)", () => {
    const WRONG = { has_errors: true, corrected: "She doesn't like coffee here.", errors: [{ original: "don't", corrected: "doesn't", category: "agreement", explanation: "x" }] };
    const RIGHT = { has_errors: false, corrected: "ok", errors: [] as never[] };
    const TYPED = "She don't like coffee here";
    const PREVIOUS = { messages: [
      { id: "m1", conversation_id: "c1", role: "user", content: "I sink so", assessment_id: "a0",
        assessment: { id: "a0", scores: { pronunciation_score: 61, accuracy_score: 60, fluency_score: 70, completeness_score: 90 },
          words: [{ word: "sink", accuracy_score: 30, error_type: "Mispronunciation" }] }, grammar: null as null },
      { id: "m2", conversation_id: "c1", role: "assistant", content: "Why?", assessment_id: null, assessment: null, grammar: null as null },
    ] };
    const NEVER: Handler = () => new Promise<Response>(() => undefined);
    beforeEach(async () => { await deleteDb(); resetKvCacheForTests(); localStorage.clear(); });

    /** 第一次回复在 gate 放行后失败;返回两次聊天请求的系统提示词 */
    const failThenRetry = async (opts: {
      coach: boolean; grammar: Handler; history?: unknown; arrived?: "grammar-badge" | "voice-badge"; voice?: boolean;
    }) => {
      const gateFirst = gate();
      let attempt = 0;
      const { mock } = setup(routes({
        "GET /api/conversations/c1": () => json({ id: "c1", name: "Chat", config: { ...CONFIG, coach_mode: opts.coach } }),
        ...(opts.history ? { "GET /api/conversations/c1/messages": () => json(opts.history) } : {}),
        "POST /api/ai/audio/transcriptions": () => json({ text: "I like apples" }),
        "POST /api/speech/assessments": () => json(ASSESSED),
        "POST /api/ai/grammar": opts.grammar,
        "POST /api/ai/chat/completions": async () => {
          if (++attempt > 1) return sse([delta("OK"), DONE_EVENT]);
          await gateFirst.promise;
          return sse(['data: {"error": "Upstream unavailable"}\n\n']);
        },
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m3" }, { id: "m4" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      }), opts.voice ? createFakeRecorderEnv().env : undefined);
      await screen.findByText(opts.history ? "Why?" : "reply");
      if (opts.voice) await recordAndSend();
      else {
        await userEvent.type(await textMode(), TYPED);
        await userEvent.click(screen.getByTestId("chat-send"));
      }
      await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(1));
      if (opts.arrived === "grammar-badge") await screen.findByTestId("badge-grammar");
      if (opts.arrived === "voice-badge") await waitFor(() => expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done"));
      await act(async () => { gateFirst.release(); });
      await userEvent.click(await screen.findByTestId("message-retry"));
      await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(2));
      return callsTo(mock, "POST", "/api/ai/chat/completions").map((c) => bodyOf(c).messages[0].content as string);
    };

    it("(a) uses the retried message's own grammar result that arrived after the failed attempt", async () => {
      const [first, second] = await failThenRetry({ coach: true, grammar: () => json(WRONG), arrived: "grammar-badge" });
      expect(first).toBe("SYS");
      expect(second.startsWith("SYS\n\n")).toBe(true);
      expect(second).toContain(`"${TYPED}"`);
      expect(second).toContain('"don\'t" → "doesn\'t"');
      expect(second).not.toContain("sink");
    });

    it("(a2) prefers the retried message's results over the previous message's", async () => {
      const [, second] = await failThenRetry({ coach: true, grammar: () => json(WRONG), arrived: "grammar-badge", history: PREVIOUS });
      expect(second).toContain('"don\'t" → "doesn\'t"');
      expect(second).toContain(`"${TYPED}"`);
      expect(second).not.toContain("sink");
    });

    it("(d) a retried voice turn includes its assessment words that arrived after the failed attempt", async () => {
      const [first, second] = await failThenRetry({ coach: true, grammar: () => json(RIGHT), arrived: "voice-badge", voice: true });
      expect(first).toBe("SYS");
      expect(second).toContain('"I like apples"');
      expect(second).toContain("like");
      expect(second).toContain("82/100");
    });

    it("(b) adds nothing while no result has arrived, on the first attempt and on retry", async () => {
      expect(await failThenRetry({ coach: true, grammar: NEVER })).toEqual(["SYS", "SYS"]);
    });

    it("(b2) adds nothing when the previous message has no results either", async () => {
      const plain = { messages: PREVIOUS.messages.map((m) => ({ ...m, assessment: null as null, assessment_id: null as null })) };
      expect(await failThenRetry({ coach: true, grammar: NEVER, history: plain })).toEqual(["SYS", "SYS"]);
    });

    it("(c) ignores the retried message's pending results and uses the previous message's arrived ones", async () => {
      const [, second] = await failThenRetry({ coach: true, grammar: NEVER, history: PREVIOUS });
      expect(second).toContain("sink");
      expect(second).toContain('"I sink so"');
      expect(second).not.toContain("coffee");
    });

    it("(e) adds nothing when coach mode is off even though results arrived", async () => {
      expect(await failThenRetry({ coach: false, grammar: () => json(WRONG), arrived: "grammar-badge", history: PREVIOUS })).toEqual(["SYS", "SYS"]);
    });
  });

  describe("auto-read (R4–R6)", () => {
    let toastSpy: MockInstance;
    beforeEach(() => {
      sharedTtsCache.clear();
      toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    });
    afterEach(() => {
      toastSpy.mockRestore();
      vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => Promise.resolve());
      resetPlaybackRate();
    });
    const saved = () => json({ messages: [{ id: "m1" }, { id: "m2" }] });
    /** 服务端语义:GET 返回已存配置;PATCH 带 config 时整体替换,只改名时保留已存配置 */
    const replyRoutes = (text: string, extra: Record<string, Handler> = {}, stored: Record<string, unknown> = CONFIG) => {
      let config = stored;
      return routes({
        "GET /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config }),
        "POST /api/ai/chat/completions": () => sse([delta(text), DONE_EVENT]),
        "POST /api/conversations/c1/messages": saved,
        "PATCH /api/conversations/c1": (call) => {
          const body = bodyOf(call);
          if (body.config) config = body.config;
          return json({ id: "c1", name: body.name ?? "Hi", config });
        },
        ...extra,
      });
    };
    const configPatches = (mock: ReturnType<typeof createFetchMock>) =>
      mock.calls.filter((c) => c.method === "PATCH" && c.url.pathname === "/api/conversations/c1" && "config" in bodyOf(c));
    const speechCalls = (mock: ReturnType<typeof createFetchMock>) => callsTo(mock, "POST", "/api/ai/audio/speech");
    async function say(text: string) {
      await userEvent.type(await textMode(), text);
      await userEvent.click(screen.getByTestId("chat-send"));
    }
    const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

    it("reads a new reply when it finishes, after unlocking the shared player inside the tap", async () => {
      const play = vi.mocked(HTMLMediaElement.prototype.play);
      let playsBeforeReply = -1;
      const { mock } = setup(replyRoutes("Auto one.", {
        "POST /api/ai/chat/completions": () => { playsBeforeReply = play.mock.calls.length; return sse([delta("Auto one."), DONE_EVENT]); },
      }));
      await screen.findByText("reply");
      play.mockClear();
      await say("Hi");
      await waitFor(() => expect(speechCalls(mock)).toHaveLength(1));
      expect(playsBeforeReply).toBeGreaterThanOrEqual(1); // primeAudioElement 在点击里、回复请求之前
      expect(bodyOf(speechCalls(mock)[0])).toEqual({ input: "Auto one.", model: "openai/tts-1", voice: "alloy" });
      await waitFor(() => expect(screen.getAllByTestId("message-tts").at(-1)).toHaveAttribute("data-state", "playing"));
      expect(screen.getAllByTestId("message-tts")[0]).toHaveAttribute("data-state", "idle");
      expect(await headerOption("conversation-autospeak")).toHaveAttribute("aria-pressed", "true"); // 旧会话没有该键:默认开
    });

    it("never reads loaded history", async () => {
      const { mock } = setup(routes());
      await screen.findByText("reply");
      await settle();
      expect(speechCalls(mock)).toHaveLength(0);
    });

    it("does not read when the stored switch is off, an error reply, or a hidden page", async () => {
      const off = setup(replyRoutes("Off.", {}, { ...CONFIG, auto_speak: false }));
      await screen.findByText("reply");
      expect(await headerOption("conversation-autospeak")).toHaveAttribute("aria-pressed", "false");
      await say("Hi");
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Off."));
      await settle();
      expect(speechCalls(off.mock)).toHaveLength(0);
      off.view.unmount();

      const failed = setup(routes({ "POST /api/ai/chat/completions": () => json({ error: "Upstream unavailable" }, 502) }));
      await screen.findByText("reply");
      await say("Hi");
      await screen.findByTestId("message-retry");
      await settle();
      expect(speechCalls(failed.mock)).toHaveLength(0);
      failed.view.unmount();

      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      const background = setup(replyRoutes("Hidden."));
      await screen.findByText("reply");
      await say("Hi");
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hidden."));
      await settle();
      expect(speechCalls(background.mock)).toHaveLength(0);
      hidden.mockRestore();
    });

    it("stays silent for a reply with nothing to read", async () => {
      const { mock } = setup(replyRoutes("```js\nx()\n```"));
      await screen.findByText("reply");
      await say("Code please");
      await waitFor(() => expect(posted(mock)).toHaveLength(1));
      await settle();
      expect(speechCalls(mock)).toHaveLength(0);
      expect(toastSpy).not.toHaveBeenCalled();
    });

    it("a new send stops the previous reading; only the newest reply is read", async () => {
      let n = 0;
      const signals: AbortSignal[] = [];
      const { mock } = setup(routes({
        "POST /api/ai/chat/completions": () => sse([delta(`Reply ${++n}.`), DONE_EVENT]),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: `u${n}` }, { id: `a${n}` }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: CONFIG }),
        "POST /api/ai/audio/speech": (call) => {
          signals.push(call.signal!);
          return signals.length === 1
            ? new Promise<Response>((_, reject) => call.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
            : new Response(new Uint8Array([1]));
        },
      }));
      await screen.findByText("reply");
      await say("One");
      await waitFor(() => expect(signals).toHaveLength(1));
      await say("Two");
      await waitFor(() => expect(signals).toHaveLength(2));
      expect(signals[0].aborted).toBe(true);
      expect(bodyOf(speechCalls(mock)[1]).input).toBe("Reply 2.");
      expect(toastSpy).not.toHaveBeenCalled(); // 被打断不算失败
    });

    it("starting a recording stops the auto-read", async () => {
      const fake = createFakeRecorderEnv();
      setup(replyRoutes("Mic stops me."), fake.env);
      await screen.findByText("reply");
      await say("Hi");
      await waitFor(() => expect(screen.getAllByTestId("message-tts").at(-1)).toHaveAttribute("data-state", "playing"));
      await startRecording();
      await waitFor(() => expect(screen.getAllByTestId("message-tts").at(-1)).toHaveAttribute("data-state", "idle"));
      await userEvent.click(screen.getByTestId("chat-mic-cancel"));
    });

    it("switching conversations aborts a pending auto-read and reads nothing in the new one", async () => {
      let signal: AbortSignal | undefined;
      const { mock } = setup(replyRoutes("Leaving.", {
        "POST /api/ai/audio/speech": (call) => { signal = call.signal!; return new Promise<Response>((_, reject) => call.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))); },
        "GET /api/conversations/c2": () => json({ id: "c2", name: "Other chat", config: CONFIG }),
        "GET /api/conversations/c2/messages": () => json({ messages: [{ id: "n0", conversation_id: "c2", role: "assistant", content: "Second chat hello" }] }),
      }));
      await screen.findByText("reply");
      await say("Hi");
      await waitFor(() => expect(signal).toBeDefined());
      act(() => goTo("/chat/c2"));
      await screen.findByText("Second chat hello");
      expect(signal!.aborted).toBe(true);
      await settle();
      expect(speechCalls(mock)).toHaveLength(1);
      expect(toastSpy).not.toHaveBeenCalled();
    });

    it("a blocked autoplay shows a one-time tap-to-read hint; the tap plays it", async () => {
      let block = true;
      vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() =>
        block ? Promise.reject(new DOMException("blocked", "NotAllowedError")) : Promise.resolve());
      let n = 0;
      const { mock } = setup(replyRoutes("x", { "POST /api/ai/chat/completions": () => sse([delta(`Blocked ${++n}.`), DONE_EVENT]) }));
      await screen.findByText("reply");
      await say("Hi");
      expect(await screen.findByTestId("autospeak-blocked")).toBeInTheDocument();
      expect(toastSpy).not.toHaveBeenCalled();
      block = false;
      await userEvent.click(screen.getByTestId("autospeak-tap"));
      await waitFor(() => expect(screen.getAllByTestId("message-tts").at(-1)).toHaveAttribute("data-state", "playing"));
      expect(screen.queryByTestId("autospeak-blocked")).toBeNull();
      block = true;
      await say("Again");
      await waitFor(() => expect(speechCalls(mock).length).toBeGreaterThanOrEqual(2));
      await settle();
      expect(screen.queryByTestId("autospeak-blocked")).toBeNull(); // 只提示一次
      expect(toastSpy).not.toHaveBeenCalled();
    });

    it("reports a synthesis failure at most once", async () => {
      let n = 0;
      setup(replyRoutes("x", {
        "POST /api/ai/chat/completions": () => sse([delta(`Fail ${++n}.`), DONE_EVENT]),
        "POST /api/ai/audio/speech": () => json({ error: "Upstream unavailable" }, 502),
      }));
      await screen.findByText("reply");
      await say("One");
      await waitFor(() => expect(toastSpy).toHaveBeenCalledWith("The AI service is unavailable. Please try again."));
      await say("Two");
      await waitFor(() => expect(screen.getAllByTestId("message-tts").at(-1)).toHaveAttribute("data-state", "error"));
      expect(toastSpy).toHaveBeenCalledTimes(1);
    });

    it("the header switch saves stored config + auto_speak and stops the current reading", async () => {
      const { mock } = setup(replyRoutes("Stop me."));
      await screen.findByText("reply");
      await say("Hi");
      await waitFor(() => expect(screen.getAllByTestId("message-tts").at(-1)).toHaveAttribute("data-state", "playing"));
      await userEvent.click(await headerOption("conversation-autospeak"));
      await waitFor(() => expect(screen.getByTestId("conversation-autospeak")).toHaveAttribute("aria-pressed", "false"));
      expect(screen.getAllByTestId("message-tts").at(-1)).toHaveAttribute("data-state", "idle");
      expect(configPatches(mock)).toHaveLength(1);
      expect(bodyOf(configPatches(mock)[0]).config).toEqual({ ...CONFIG, auto_speak: false });
    });

    it("turning auto-read off takes effect at once: a reply finishing before the save returns is not read", async () => {
      const reply = gate();
      const save = gate();
      const { mock } = setup(replyRoutes("Too late.", {
        "POST /api/ai/chat/completions": async () => { await reply.promise; return sse([delta("Too late."), DONE_EVENT]); },
        "PATCH /api/conversations/c1": async (call) => {
          const body = bodyOf(call);
          if (!body.config) return json({ id: "c1", name: body.name ?? "Hi", config: CONFIG });
          await save.promise;
          return json({ id: "c1", name: "Hi", config: body.config });
        },
      }));
      await screen.findByText("reply");
      await say("Hi");
      await userEvent.click(await headerOption("conversation-autospeak"));
      await act(async () => { reply.release(); });
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Too late."));
      await settle();
      expect(speechCalls(mock)).toHaveLength(0);
      await act(async () => { save.release(); });
      await waitFor(() => expect(screen.getByTestId("conversation-autospeak")).toHaveAttribute("aria-pressed", "false"));
      await settle();
      expect(speechCalls(mock)).toHaveLength(0);
    });

    it("a failed save of the switch reverts it, and replies are read again", async () => {
      const { mock } = setup(replyRoutes("Back on.", {
        "PATCH /api/conversations/c1": (call) => (bodyOf(call).config ? json({ error: "boom" }, 500) : json({ id: "c1", name: "Hi", config: CONFIG })),
      }));
      await screen.findByText("reply");
      await userEvent.click(await headerOption("conversation-autospeak"));
      await waitFor(() => expect(configPatches(mock)).toHaveLength(1));
      await waitFor(() => expect(screen.getByTestId("conversation-autospeak")).toHaveAttribute("aria-pressed", "true"));
      await say("Hi");
      await waitFor(() => expect(speechCalls(mock)).toHaveLength(1));
    });

    it("a reply to a voice message is read once", async () => {
      const fake = createFakeRecorderEnv();
      const { mock } = setup(replyRoutes("Voice reply.", {
        "POST /api/ai/audio/transcriptions": () => json({ text: "I like apples" }),
        "POST /api/speech/assessments": () => json(ASSESSED),
      }), fake.env);
      await screen.findByText("reply");
      await recordAndSend();
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Voice reply."));
      await waitFor(() => expect(speechCalls(mock)).toHaveLength(1));
      await settle();
      expect(speechCalls(mock)).toHaveLength(1);
      expect(bodyOf(speechCalls(mock)[0]).input).toBe("Voice reply.");
    });

    it("the speed button cycles and applies to the shared player at once", async () => {
      setup(routes());
      await screen.findByText("reply");
      expect(await headerOption("conversation-speed")).toHaveTextContent("1×");
      await userEvent.click(await headerOption("conversation-speed"));
      expect(await headerOption("conversation-speed")).toHaveTextContent("1.25×");
      expect(localStorage.getItem(PLAYBACK_RATE_KEY)).toBe("1.25");
      await userEvent.click(screen.getByTestId("message-tts"));
      await waitFor(() => expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "playing"));
      expect(sharedAutoplayAudio().playbackRate).toBe(1.25);
      await userEvent.click(await headerOption("conversation-speed"));
      expect(sharedAutoplayAudio().playbackRate).toBe(0.75);
    });

    it("retrying a failed reply (a tap) reads the retried reply", async () => {
      let fail = true;
      const { mock } = setup(replyRoutes("x", {
        "POST /api/ai/chat/completions": () => (fail ? json({ error: "Upstream unavailable" }, 502) : sse([delta("Retried."), DONE_EVENT])),
      }));
      await screen.findByText("reply");
      await say("Hi");
      await screen.findByTestId("message-retry");
      fail = false;
      await userEvent.click(screen.getByTestId("message-retry"));
      await waitFor(() => expect(speechCalls(mock)).toHaveLength(1));
      expect(bodyOf(speechCalls(mock)[0]).input).toBe("Retried.");
    });

    it("reads exactly once under StrictMode", async () => {
      const { mock } = setup(replyRoutes("Strict."), undefined, { strict: true });
      await screen.findByText("reply");
      await say("Hi");
      await waitFor(() => expect(speechCalls(mock)).toHaveLength(1));
      await settle();
      expect(speechCalls(mock)).toHaveLength(1);
    });
  });

  describe("scenarios (R9–R10)", () => {
    beforeEach(() => sharedTtsCache.clear());
    const CAFE = { ...CONFIG, scenario: { id: "cafe" }, level: "B1" };
    const OPENING = { "GET /api/conversations/c1/messages": () => json({ messages: [{ id: "m0", conversation_id: "c1", role: "assistant", content: "Hi there, welcome in!" }] }) };
    const speech = (mock: ReturnType<typeof createFetchMock>) => callsTo(mock, "POST", "/api/ai/audio/speech");

    it("shows the scenario and level, and replies in character", async () => {
      const { mock } = setup(routes({
        "GET /api/conversations/c1": () => json({ id: "c1", name: "Ordering coffee", config: CAFE }),
        "POST /api/ai/chat/completions": () => sse([delta("Sure!"), DONE_EVENT]),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
      }));
      expect(await screen.findByTestId("conversation-scenario")).toHaveTextContent("Ordering coffee");
      expect(screen.getByTestId("conversation-level")).toHaveTextContent("B1");
      await userEvent.type(await textMode(), "A latte, please.");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(1));
      const system = bodyOf(callsTo(mock, "POST", "/api/ai/chat/completions")[0]).messages[0].content as string;
      expect(system).toMatch(/^You are a friendly barista/);
      expect(system).toMatch(/CEFR B1/);
      expect(system).not.toMatch(/^SYS/);
    });

    it("reads the opening line once when arriving from the scenario panel, and clears the state", async () => {
      const { mock } = setup(routes({ "GET /api/conversations/c1": () => json({ id: "c1", name: "Ordering coffee", config: CAFE }), ...OPENING }),
        undefined, { route: { pathname: "/chat/c1", state: { speakOpening: "m0" } } });
      await waitFor(() => expect(speech(mock)).toHaveLength(1));
      expect(bodyOf(speech(mock)[0]).input).toBe("Hi there, welcome in!");
      await waitFor(() => expect(screen.getByTestId("location")).toHaveAttribute("data-state", "null"));
      await act(() => new Promise((r) => setTimeout(r, 30)));
      expect(speech(mock)).toHaveLength(1);
    });

    it("reads it once under StrictMode too", async () => {
      const { mock } = setup(routes({ "GET /api/conversations/c1": () => json({ id: "c1", name: "Ordering coffee", config: CAFE }), ...OPENING }),
        undefined, { strict: true, route: { pathname: "/chat/c1", state: { speakOpening: "m0" } } });
      await waitFor(() => expect(speech(mock)).toHaveLength(1));
      await act(() => new Promise((r) => setTimeout(r, 30)));
      expect(speech(mock)).toHaveLength(1);
    });

    it("does not read the opening when auto-read is off, the id does not match, or there is no state", async () => {
      const off = setup(routes({ "GET /api/conversations/c1": () => json({ id: "c1", name: "x", config: { ...CAFE, auto_speak: false } }), ...OPENING }),
        undefined, { route: { pathname: "/chat/c1", state: { speakOpening: "m0" } } });
      await screen.findByText("Hi there, welcome in!");
      await act(() => new Promise((r) => setTimeout(r, 30)));
      expect(speech(off.mock)).toHaveLength(0);
      off.view.unmount();
      const other = setup(routes({ "GET /api/conversations/c1": () => json({ id: "c1", name: "x", config: CAFE }), ...OPENING }),
        undefined, { route: { pathname: "/chat/c1", state: { speakOpening: "zzz" } } });
      await screen.findByText("Hi there, welcome in!");
      await act(() => new Promise((r) => setTimeout(r, 30)));
      expect(speech(other.mock)).toHaveLength(0);
    });

    it("waits for the server voice defaults before reading the opening", async () => {
      let releaseTts!: () => void;
      const gate = new Promise<void>((r) => (releaseTts = r));
      const { mock } = setup(routes({
        "GET /api/conversations/c1": () => json({ id: "c1", name: "x", config: { scenario: { id: "cafe" }, level: "auto" } }), // R2:新会话不存模型/音色
        "GET /api/config/default_tts_preset": async () => { await gate; return json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }); },
        ...OPENING,
      }), undefined, { route: { pathname: "/chat/c1", state: { speakOpening: "m0" } } });
      await screen.findByText("Hi there, welcome in!");
      expect(speech(mock)).toHaveLength(0);
      releaseTts();
      await waitFor(() => expect(speech(mock)).toHaveLength(1));
      expect(bodyOf(speech(mock)[0])).toMatchObject({ model: "openai/tts-1", voice: "alloy" });
    });

    it("labels a custom scenario by its first words and ignores a garbage stored scenario", async () => {
      const custom = setup(routes({ "GET /api/conversations/c1": () => json({ id: "c1", name: "x",
        config: { ...CONFIG, scenario: { id: "custom", custom: "Returning a broken phone to a shop" } } }) }));
      expect(await screen.findByTestId("conversation-scenario")).toHaveTextContent("Custom: Returning a broken phone");
      expect(screen.queryByTestId("conversation-level")).not.toBeInTheDocument();
      custom.view.unmount();
      setup(routes({ "GET /api/conversations/c1": () => json({ id: "c1", name: "x", config: { ...CONFIG, scenario: { id: 42, custom: ["x"] } } }) }));
      await screen.findByText("reply");
      expect(screen.queryByTestId("conversation-scenario")).not.toBeInTheDocument();
    });
  });

  describe('"not sure what to say" hints (R12)', () => {
    const REPLIES = { replies: [{ text: "I'd like a latte.", zh: "我想要一杯拿铁。" }, { text: "What do you recommend?", zh: "你推荐什么?" }, { text: "Just water, thanks.", zh: "白水就好。" }] };
    const completion = (content: unknown) => json({ choices: [{ message: { content: JSON.stringify(content) } }] });
    /** 同一个接口:流式 = 对话回复,非流式 = 提示 */
    const ai = (hints: () => Response | Promise<Response>): Handler => (call) =>
      (bodyOf(call).stream ? sse([delta("OK"), DONE_EVENT]) : hints());
    const hintCalls = (mock: ReturnType<typeof createFetchMock>) =>
      callsTo(mock, "POST", "/api/ai/chat/completions").filter((c) => !bodyOf(c).stream);
    beforeEach(async () => {
      resetKvCacheForTests();
      await deleteDb();
      clearHintsMemory();
    });

    it("offers three replies for the last reply; filling one closes the panel; the second open is cached", async () => {
      const { mock } = setup(routes({ "POST /api/ai/chat/completions": ai(() => completion(REPLIES)) }));
      await screen.findByText("reply");
      await userEvent.click(screen.getByTestId("chat-hints"));
      await waitFor(() => expect(screen.getByTestId("hints-result")).toHaveAttribute("data-status", "done"));
      expect(screen.getAllByTestId("hint-item")).toHaveLength(3);
      expect(screen.getAllByTestId("hint-item")[0]).toHaveTextContent("我想要一杯拿铁。");
      const request = bodyOf(hintCalls(mock)[0]);
      expect(request.response_format).toEqual({ type: "json_object" });
      expect(JSON.parse(request.messages[1].content).conversation).toEqual([{ speaker: "partner", text: "Earlier **reply**" }]);
      await userEvent.click(screen.getAllByTestId("hint-fill")[1]);
      expect(screen.getByTestId("chat-input")).toHaveValue("What do you recommend?");
      await waitFor(() => expect(screen.queryByTestId("hints-sheet")).toBeNull());
      await userEvent.click(screen.getByTestId("chat-hints"));
      await waitFor(() => expect(screen.getAllByTestId("hint-item")).toHaveLength(3));
      expect(hintCalls(mock)).toHaveLength(1);
    });

    it("shows a retryable error for malformed output and does not cache it", async () => {
      let bad = true;
      const { mock } = setup(routes({ "POST /api/ai/chat/completions": ai(() => completion(bad ? { replies: REPLIES.replies.slice(0, 2) } : REPLIES)) }));
      await screen.findByText("reply");
      await userEvent.click(screen.getByTestId("chat-hints"));
      await waitFor(() => expect(screen.getByTestId("hints-result")).toHaveAttribute("data-status", "error"));
      expect(screen.getByTestId("hints-result")).toHaveTextContent("The suggestions could not be read. Try again.");
      bad = false;
      await userEvent.click(screen.getByTestId("hints-retry"));
      await waitFor(() => expect(screen.getAllByTestId("hint-item")).toHaveLength(3));
      expect(hintCalls(mock)).toHaveLength(2);
    });

    it("is disabled while recording and while a reply streams", async () => {
      const fake = createFakeRecorderEnv();
      let finish!: () => void;
      const streaming: Handler = (call) => (bodyOf(call).stream
        ? new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(delta("…"))); finish = () => { c.enqueue(new TextEncoder().encode(DONE_EVENT)); c.close(); }; } }), { headers: { "Content-Type": "text/event-stream" } })
        : completion(REPLIES));
      setup(routes({ "POST /api/ai/chat/completions": streaming, "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }) }), fake.env);
      await screen.findByText("reply");
      await startRecording();
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording"));
      expect(screen.getByTestId("chat-hints")).toBeDisabled();
      await userEvent.click(screen.getByTestId("chat-mic-cancel"));
      await waitFor(() => expect(screen.getByTestId("chat-hints")).toBeEnabled());
      await userEvent.type(await textMode(), "Hi");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getByTestId("chat-hints")).toBeDisabled());
      act(() => finish());
      await waitFor(() => expect(screen.getByTestId("chat-hints")).toBeEnabled());
    });

    it("uses the conversation level in the prompt and the cache key", async () => {
      const { mock } = setup(routes({
        "GET /api/conversations/c1": () => json({ id: "c1", name: "x", config: { ...CONFIG, level: "A2" } }),
        "POST /api/ai/chat/completions": ai(() => completion(REPLIES)),
      }));
      await screen.findByText("reply");
      await userEvent.click(screen.getByTestId("chat-hints"));
      await waitFor(() => expect(hintCalls(mock)).toHaveLength(1));
      expect(bodyOf(hintCalls(mock)[0]).messages[0].content).toMatch(/CEFR A2 level: write the three replies/);
    });

    it("sends only the bounded id of a custom scenario, never its text", async () => {
      const { mock } = setup(routes({
        "GET /api/conversations/c1": () => json({ id: "c1", name: "x", config: { ...CONFIG, scenario: { id: "custom", custom: "Secret plan at the bank" } } }),
        "POST /api/ai/chat/completions": ai(() => completion(REPLIES)),
      }));
      await screen.findByText("reply");
      await userEvent.click(screen.getByTestId("chat-hints"));
      await waitFor(() => expect(hintCalls(mock)).toHaveLength(1));
      const body = bodyOf(hintCalls(mock)[0]);
      expect(JSON.parse(body.messages[1].content).scenario).toBe("custom");
      expect(JSON.stringify(body)).not.toContain("Secret plan");
    });

    it("switching conversations aborts the request and closes the panel", async () => {
      let signal: AbortSignal | undefined;
      setup(routes({
        "POST /api/ai/chat/completions": (call) => { signal = call.signal!; return new Promise<Response>((_, reject) => call.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))); },
        "GET /api/conversations/c2": () => json({ id: "c2", name: "Other chat", config: CONFIG }),
        "GET /api/conversations/c2/messages": () => json({ messages: [] }),
      }));
      await screen.findByText("reply");
      await userEvent.click(screen.getByTestId("chat-hints"));
      await waitFor(() => expect(signal).toBeDefined());
      act(() => goTo("/chat/c2"));
      await waitFor(() => expect(screen.queryByTestId("hints-sheet")).toBeNull());
      expect(signal!.aborted).toBe(true);
    });

    it("reads a hint aloud, saves it, and opens it for practice", async () => {
      const { mock } = setup(routes({
        "POST /api/ai/chat/completions": ai(() => completion(REPLIES)),
        "POST /api/practice-items": () => json({ id: "p1", text: "I'd like a latte.", source: "chat", created_at: "2026-10-05T00:00:00+00:00" }),
      }));
      await screen.findByText("reply");
      await userEvent.click(screen.getByTestId("chat-hints"));
      await waitFor(() => expect(screen.getAllByTestId("hint-item")).toHaveLength(3));
      await userEvent.click(screen.getAllByTestId("hint-speak")[0]);
      await waitFor(() => expect(bodyOf(callsTo(mock, "POST", "/api/ai/audio/speech")[0]).input).toBe("I'd like a latte."));
      await userEvent.click(screen.getAllByTestId("hint-save")[0]);
      await waitFor(() => expect(bodyOf(callsTo(mock, "POST", "/api/practice-items")[0])).toEqual({ text: "I'd like a latte.", source: "chat" }));
      await userEvent.click(screen.getAllByTestId("hint-practice")[2]);
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice"));
    });
  });

  describe("recap (R13)", () => {
    const LOADED = { messages: [
      { id: "m0", conversation_id: "c1", role: "assistant", content: "Welcome!" },
      { id: "m1", conversation_id: "c1", role: "user", content: "Nice to meet you", assessment_id: "a1",
        assessment: { scores: { pronunciation_score: 72.6, accuracy_score: 70, fluency_score: 80, completeness_score: 90 }, words: [{ word: "meet", accuracy_score: 40, error_type: "Mispronunciation" }] } },
      { id: "m2", conversation_id: "c1", role: "assistant", content: "You too!" },
      { id: "m3", conversation_id: "c1", role: "user", content: "Yesterday I go home.",
        grammar: { has_errors: true, corrected: "Yesterday I went home.", errors: [{ original: "go", corrected: "went", category: "tense", explanation: "past" }] } },
    ] };
    const RECAP = { summary_zh: "你们互相问候并聊了昨天。", new_expressions: [{ text: "head home", zh: "回家" }], suggestions_zh: ["注意过去时。"] };
    const completion = () => json({ choices: [{ message: { content: JSON.stringify(RECAP) } }] });
    const aiCalls = (mock: ReturnType<typeof createFetchMock>) => callsTo(mock, "POST", "/api/ai/chat/completions");

    it("shows the facts from loaded messages without calling the AI, and never generates on its own", async () => {
      const { mock } = setup(routes({ "GET /api/conversations/c1/messages": () => json(LOADED) }));
      await screen.findByText("You too!");
      await userEvent.click(await headerOption("conversation-recap"));
      expect(await screen.findByTestId("recap-facts")).toBeInTheDocument();
      expect(screen.getByTestId("recap-user-messages")).toHaveTextContent("2");
      expect(screen.getByTestId("recap-avg-score")).toHaveTextContent("73");
      expect(screen.getByTestId("recap-grammar-category")).toHaveTextContent("1");
      expect(screen.getByTestId("recap-grammar-item")).toHaveTextContent("Yesterday I went home.");
      expect(screen.getByTestId("recap-poor-word")).toHaveTextContent("meet");
      expect(screen.getByTestId("recap-generate")).toBeEnabled();
      expect(aiCalls(mock)).toHaveLength(0);
    });

    it("generates once and stores the result on top of the stored config", async () => {
      const { mock } = setup(routes({
        "GET /api/conversations/c1/messages": () => json(LOADED),
        "POST /api/ai/chat/completions": completion,
        "PATCH /api/conversations/c1": (call) => json({ id: "c1", name: "New conversation", config: bodyOf(call).config }),
      }));
      await screen.findByText("You too!");
      await userEvent.click(await headerOption("conversation-recap"));
      await userEvent.click(await screen.findByTestId("recap-generate"));
      await waitFor(() => expect(screen.getByTestId("recap-summary")).toHaveAttribute("data-status", "done"));
      expect(screen.getByTestId("recap-summary")).toHaveTextContent(RECAP.summary_zh);
      expect(screen.getByTestId("recap-expression")).toHaveTextContent("head home");
      expect(aiCalls(mock)).toHaveLength(1);
      await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
      const config = bodyOf(mock.calls.find((c) => c.method === "PATCH")!).config;
      expect(config).toEqual({
        ...CONFIG,
        recap: { generated_at: expect.any(String), message_count: 4, level: "auto", summary_zh: RECAP.summary_zh, new_expressions: RECAP.new_expressions, suggestions_zh: RECAP.suggestions_zh },
      });
    });

    it("shows a stored recap without calling the AI, flagged stale when there are more messages now", async () => {
      const stored = { generated_at: "2026-10-05T10:00:00.000Z", message_count: 2, level: "auto", summary_zh: "旧的复盘", new_expressions: [] as unknown[], suggestions_zh: [] as string[] };
      const { mock } = setup(routes({
        "GET /api/conversations/c1": () => json({ id: "c1", name: "x", config: { ...CONFIG, recap: stored } }),
        "GET /api/conversations/c1/messages": () => json(LOADED),
      }));
      await screen.findByText("You too!");
      await userEvent.click(await headerOption("conversation-recap"));
      expect(await screen.findByTestId("recap-summary")).toHaveTextContent("旧的复盘");
      expect(screen.getByTestId("recap-stale")).toBeInTheDocument();
      expect(screen.getByTestId("recap-regenerate")).toBeEnabled();
      expect(aiCalls(mock)).toHaveLength(0);
    });

    it("adds a new expression and a poorly pronounced word to the vocabulary book", async () => {
      const { mock } = setup(routes({
        "GET /api/conversations/c1/messages": () => json(LOADED),
        "POST /api/ai/chat/completions": completion,
        "PATCH /api/conversations/c1": (call) => json({ id: "c1", name: "x", config: bodyOf(call).config }),
        "POST /api/vocabulary": () => json({ id: "v1" }),
      }));
      await screen.findByText("You too!");
      await userEvent.click(await headerOption("conversation-recap"));
      await userEvent.click(await screen.findByTestId("recap-poor-word-vocab"));
      await userEvent.click(screen.getByTestId("recap-generate"));
      await userEvent.click(await screen.findByTestId("recap-expression-vocab"));
      await waitFor(() => expect(callsTo(mock, "POST", "/api/vocabulary")).toHaveLength(2));
      expect(callsTo(mock, "POST", "/api/vocabulary").map(bodyOf)).toEqual([
        { word: "meet", source: "recap" },
        { word: "head home", meaning: "回家", source: "recap" },
      ]);
    });

    it("a malformed answer shows a retryable error", async () => {
      let bad = true;
      setup(routes({
        "GET /api/conversations/c1/messages": () => json(LOADED),
        "POST /api/ai/chat/completions": () => (bad ? json({ choices: [{ message: { content: "{}" } }] }) : completion()),
        "PATCH /api/conversations/c1": (call) => json({ id: "c1", name: "x", config: bodyOf(call).config }),
      }));
      await screen.findByText("You too!");
      await userEvent.click(await headerOption("conversation-recap"));
      await userEvent.click(await screen.findByTestId("recap-generate"));
      expect(await screen.findByTestId("recap-error")).toHaveTextContent("The recap could not be read. Try again.");
      bad = false;
      await userEvent.click(screen.getByTestId("recap-retry"));
      await waitFor(() => expect(screen.getByTestId("recap-summary")).toHaveAttribute("data-status", "done"));
    });

    it("keeps the recap on screen when saving the config fails", async () => {
      const spy = vi.spyOn(toast, "error").mockImplementation(() => "");
      setup(routes({
        "GET /api/conversations/c1/messages": () => json(LOADED),
        "POST /api/ai/chat/completions": completion,
        "PATCH /api/conversations/c1": () => json({ error: "Config is too large" }, 400),
      }));
      await screen.findByText("You too!");
      await userEvent.click(await headerOption("conversation-recap"));
      await userEvent.click(await screen.findByTestId("recap-generate"));
      expect(await screen.findByTestId("recap-not-saved")).toBeInTheDocument();
      expect(screen.getByTestId("recap-summary")).toHaveTextContent(RECAP.summary_zh);
      expect(spy).toHaveBeenCalledWith("These settings are too large to save.");
      spy.mockRestore();
    });

    it("saves a corrected sentence to the practice list as a grammar item", async () => {
      const { mock } = setup(routes({
        "GET /api/conversations/c1/messages": () => json(LOADED),
        "POST /api/practice-items": () => json({ id: "p1", text: "Yesterday I went home.", source: "grammar", created_at: "2026-10-05T00:00:00+00:00" }),
      }));
      await screen.findByText("You too!");
      await userEvent.click(await headerOption("conversation-recap"));
      await userEvent.click(await screen.findByTestId("recap-grammar-save"));
      await waitFor(() => expect(bodyOf(callsTo(mock, "POST", "/api/practice-items")[0])).toEqual({ text: "Yesterday I went home.", source: "grammar" }));
      await userEvent.click(screen.getByTestId("recap-poor-word-practice"));
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice"));
    });

    it("with no user messages shows the empty state and cannot generate", async () => {
      const { mock } = setup(routes({}));
      await screen.findByText("reply");
      await userEvent.click(await headerOption("conversation-recap"));
      expect(await screen.findByTestId("recap-empty")).toBeInTheDocument();
      expect(screen.getByTestId("recap-generate")).toBeDisabled();
      expect(aiCalls(mock)).toHaveLength(0);
    });

    it("does not crash on a stored grammar result without an errors list", async () => {
      setup(routes({ "GET /api/conversations/c1/messages": () => json({ messages: [
        { id: "m1", conversation_id: "c1", role: "user", content: "Hello there", grammar: { has_errors: true, corrected: "Hello there.", errors: "broken" } },
      ] }) }));
      await screen.findByText("Hello there");
      await userEvent.click(await headerOption("conversation-recap"));
      expect(await screen.findByTestId("recap-user-messages")).toHaveTextContent("1");
      expect(screen.queryByTestId("recap-grammar-item")).toBeNull();
    });

    it("reads a corrected sentence and a new expression aloud with the page player", async () => {
      const { mock } = setup(routes({
        "GET /api/conversations/c1/messages": () => json(LOADED),
        "POST /api/ai/chat/completions": completion,
        "PATCH /api/conversations/c1": (call) => json({ id: "c1", name: "x", config: bodyOf(call).config }),
      }));
      await screen.findByText("You too!");
      await userEvent.click(await headerOption("conversation-recap"));
      await userEvent.click(await screen.findByTestId("recap-grammar-speak"));
      await waitFor(() => expect(bodyOf(callsTo(mock, "POST", "/api/ai/audio/speech")[0]).input).toBe("Yesterday I went home."));
      await userEvent.click(screen.getByTestId("recap-generate"));
      await userEvent.click(await screen.findByTestId("recap-expression-speak"));
      await waitFor(() => expect(bodyOf(callsTo(mock, "POST", "/api/ai/audio/speech")[1]).input).toBe("head home"));
    });

    it("switching conversations aborts the generation and never saves it", async () => {
      let signal: AbortSignal | undefined;
      const { mock } = setup(routes({
        "GET /api/conversations/c1/messages": () => json(LOADED),
        "POST /api/ai/chat/completions": (call) => { signal = call.signal!; return new Promise<Response>((_, reject) => call.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))); },
        "GET /api/conversations/c2": () => json({ id: "c2", name: "Other chat", config: CONFIG }),
        "GET /api/conversations/c2/messages": () => json({ messages: [] }),
      }));
      await screen.findByText("You too!");
      await userEvent.click(await headerOption("conversation-recap"));
      await userEvent.click(await screen.findByTestId("recap-generate"));
      await waitFor(() => expect(signal).toBeDefined());
      act(() => goTo("/chat/c2"));
      await waitFor(() => expect(screen.queryByTestId("recap-sheet")).toBeNull());
      expect(signal!.aborted).toBe(true);
      expect(mock.calls.some((c) => c.method === "PATCH")).toBe(false);
    });
  });

  describe("config writes (one serialized chain, merged onto the latest config)", () => {
    beforeEach(async () => {
      await deleteDb();
      resetKvCacheForTests();
      localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
    });
    afterEach(async () => {
      localStorage.clear();
      await i18n.changeLanguage("en");
    });
    const RECAP = { summary_zh: "复盘", new_expressions: [{ text: "head home", zh: "回家" }], suggestions_zh: ["注意过去时。"] };
    const LOADED = { messages: [
      { id: "m0", conversation_id: "c1", role: "assistant", content: "Welcome!" },
      { id: "m1", conversation_id: "c1", role: "user", content: "Nice to meet you" },
      { id: "m2", conversation_id: "c1", role: "assistant", content: "You too!" },
    ] };
    /** 服务端语义:带 config 的 PATCH 整体替换;第一次 config PATCH 可以被 gate 卡住或失败 */
    const server = (first: { wait?: Promise<void>; fail?: boolean } = {}, extra: Record<string, Handler> = {}) => {
      let config: Record<string, unknown> = CONFIG;
      let n = 0;
      const r = routes({
        "GET /api/conversations/c1": () => json({ id: "c1", name: "Chat", config }),
        "PATCH /api/conversations/c1": async (call) => {
          const body = bodyOf(call);
          if (body.config && n++ === 0) {
            if (first.wait) await first.wait;
            if (first.fail) return json({ error: "boom" }, 500);
          }
          if (body.config) config = body.config;
          return json({ id: "c1", name: body.name ?? "Chat", config });
        },
        ...extra,
      });
      return { r, stored: () => config };
    };
    const configPatches = (mock: ReturnType<typeof createFetchMock>) =>
      mock.calls.filter((c) => c.method === "PATCH" && c.url.pathname === "/api/conversations/c1" && "config" in bodyOf(c));
    const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

    it("auto-read off then bilingual on within the first round trip: the second write keeps autoSpeak off", async () => {
      const first = gate();
      const s = server({ wait: first.promise });
      const { mock } = setup(s.r);
      await screen.findByText("reply");
      await userEvent.click(await headerOption("conversation-autospeak"));
      await userEvent.click(await headerOption("conversation-bilingual"));
      await settle();
      expect(configPatches(mock)).toHaveLength(1); // 第二次写入排队,等第一次返回
      await act(async () => { first.release(); });
      await waitFor(() => expect(configPatches(mock)).toHaveLength(2));
      expect(bodyOf(configPatches(mock)[0]).config).toEqual({ ...CONFIG, auto_speak: false });
      expect(bodyOf(configPatches(mock)[1]).config).toEqual({ ...CONFIG, auto_speak: false, bilingual: true });
      await waitFor(() => expect(screen.getByTestId("conversation-bilingual")).toHaveAttribute("aria-pressed", "true"));
      await settle();
      expect(await headerOption("conversation-autospeak")).toHaveAttribute("aria-pressed", "false");
      expect(s.stored()).toEqual({ ...CONFIG, auto_speak: false, bilingual: true });
    });

    it("a recap saved while a toggle is in flight keeps the toggle, and the toggle does not erase the recap", async () => {
      const first = gate();
      const s = server({ wait: first.promise }, {
        "GET /api/conversations/c1/messages": () => json(LOADED),
        "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: JSON.stringify(RECAP) } }] }),
      });
      const { mock } = setup(s.r);
      await screen.findByText("You too!");
      await userEvent.click(await headerOption("conversation-autospeak"));
      await userEvent.click(await headerOption("conversation-recap"));
      await userEvent.click(await screen.findByTestId("recap-generate"));
      await waitFor(() => expect(screen.getByTestId("recap-summary")).toHaveTextContent("复盘"));
      await settle();
      expect(configPatches(mock)).toHaveLength(1);
      await act(async () => { first.release(); });
      await waitFor(() => expect(configPatches(mock)).toHaveLength(2));
      await settle();
      const final = s.stored();
      expect(final.auto_speak).toBe(false);
      expect(final.recap).toMatchObject({ summary_zh: "复盘" });
      // 复盘保存之后再切换双语:复盘仍在。双语开关在顶栏选项面板里,先关掉模态的复盘面板再打开选项
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByTestId("recap-sheet")).toBeNull());
      fireEvent.click(await headerOption("conversation-bilingual"));
      await waitFor(() => expect(configPatches(mock)).toHaveLength(3));
      await settle();
      expect(s.stored()).toMatchObject({ auto_speak: false, bilingual: true, recap: { summary_zh: "复盘" } });
    });

    it("a failed write reverts its optimistic switch and does not block or leak into the next write", async () => {
      const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
      const first = gate();
      const s = server({ wait: first.promise, fail: true });
      const { mock } = setup(s.r);
      await screen.findByText("reply");
      await userEvent.click(await headerOption("conversation-autospeak"));
      expect(await headerOption("conversation-autospeak")).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(await headerOption("conversation-bilingual"));
      await act(async () => { first.release(); });
      await waitFor(() => expect(configPatches(mock)).toHaveLength(2));
      expect(bodyOf(configPatches(mock)[1]).config).toEqual({ ...CONFIG, bilingual: true });
      await waitFor(() => expect(screen.getByTestId("conversation-bilingual")).toHaveAttribute("aria-pressed", "true"));
      expect(await headerOption("conversation-autospeak")).toHaveAttribute("aria-pressed", "true");
      expect(toastSpy).toHaveBeenCalledTimes(1);
      toastSpy.mockRestore();
    });

    it("the settings button stays disabled until the conversation is loaded", async () => {
      const loaded = gate();
      setup(routes({ "GET /api/conversations/c1": async () => { await loaded.promise; return json({ id: "c1", name: "Chat", config: CONFIG }); } }));
      expect(await headerOption("conversation-settings")).toBeDisabled();
      await act(async () => { loaded.release(); });
      await waitFor(() => expect(screen.getByTestId("conversation-settings")).toBeEnabled());
    });

    it("never offers settings (and never PATCHes) when loading the conversation failed", async () => {
      const { mock } = setup(routes({ "GET /api/conversations/c1": () => json({ error: "boom" }, 500) }));
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(await headerOption("conversation-settings")).toBeDisabled();
      expect(mock.calls.some((c) => c.method === "PATCH")).toBe(false);
    });

    it("saving the settings sheet with nothing changed sends no PATCH and closes the sheet", async () => {
      const { mock } = setup(server().r);
      await screen.findByText("reply");
      await userEvent.click(await headerOption("conversation-settings"));
      await userEvent.click(await screen.findByTestId("settings-save"));
      await waitFor(() => expect(screen.queryByTestId("settings-save")).toBeNull());
      await settle();
      expect(mock.calls.some((c) => c.method === "PATCH")).toBe(false);
    });
  });

  describe("pipelined auto-read (plan 2026-10-07 R8)", () => {
    let toastSpy: MockInstance;
    beforeEach(() => {
      sharedTtsCache.clear();
      toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    });
    afterEach(() => {
      toastSpy.mockRestore();
      vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => Promise.resolve());
    });
    const REPLY = "Great choice. What size would you like? We have small and large.";
    const SENTENCES = ["Great choice.", "What size would you like?", "We have small and large."];
    const speechInputs = (calls: RecordedCall[]) =>
      calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/ai/audio/speech").map((c) => JSON.parse(String(c.body)).input as string);
    const speechSignals = (calls: RecordedCall[]) =>
      calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/ai/audio/speech").map((c) => c.signal!);
    /** 一直挂起、只在中止时失败的合成请求:用来断言"被停下" */
    const pendingSpeech: Handler = (call) =>
      new Promise<Response>((_, reject) => call.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    /** 由测试逐段推送的流式回复 */
    function liveReply() {
      const enc = new TextEncoder();
      let ctl!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start(c) { ctl = c; } });
      const push = (part: string) => act(async () => {
        try { ctl.enqueue(enc.encode(part)); } catch { /* 页面已取消读取 */ }
        await new Promise((r) => setTimeout(r, 10));
      });
      return {
        handler: (() => new Response(body, { headers: { "Content-Type": "text/event-stream" } })) as Handler,
        push,
        delta: (text: string) => push(delta(text)),
        done: () => push(DONE_EVENT),
        fail: () => push('data: {"error": "Upstream unavailable"}\n\n'),
      };
    }
    const replyRoutes = (extra: Record<string, Handler> = {}) => routes({
      "POST /api/ai/chat/completions": () => sse([delta("Great choice. "), delta("What size would you like? "), delta("We have small and large."), DONE_EVENT]),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
      "PATCH /api/conversations/c1": (call) => json({ id: "c1", name: "Hi", config: bodyOf(call).config ?? CONFIG }),
      ...extra,
    });
    async function say(text: string) {
      await userEvent.type(await textMode(), text);
      await userEvent.click(screen.getByTestId("chat-send"));
    }
    const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
    const lastTts = () => screen.getAllByTestId("message-tts").at(-1)!;
    const lastBot = () => screen.getAllByTestId("message-assistant").at(-1)!;

    it("requests speech per sentence and the sentences join to the reply", async () => {
      const { mock } = setup(replyRoutes());
      await screen.findByText("reply");
      await say("A latte please");
      await waitFor(() => expect(speechInputs(mock.calls)).toEqual(SENTENCES));
      expect(speechInputs(mock.calls).join(" ")).toBe(REPLY);
      await settle();
      expect(speechInputs(mock.calls)).toEqual(SENTENCES); // 完成时不再整条合成一次
    });

    it("starts reading the first sentence while the reply is still streaming", async () => {
      const live = liveReply();
      const { mock } = setup(replyRoutes({ "POST /api/ai/chat/completions": live.handler }));
      const play = vi.mocked(HTMLMediaElement.prototype.play);
      await screen.findByText("reply");
      play.mockClear();
      await say("A latte please");
      await live.delta("Great choice. What");
      await waitFor(() => expect(speechInputs(mock.calls)).toEqual(["Great choice."]));
      // 第一句已在共享播放器上出声,而回复还在流式进行(气泡还没有操作按钮、发送仍禁用)
      await waitFor(() => expect(play.mock.contexts.some((el) => (el as HTMLAudioElement).src === "blob:tts")).toBe(true));
      expect(lastBot()).toHaveTextContent("Great choice. What");
      expect(screen.getByTestId("chat-send")).toBeDisabled();
      await live.delta(" size would you like? We have small and large.");
      await live.done();
      await waitFor(() => expect(speechInputs(mock.calls)).toEqual(SENTENCES));
      await waitFor(() => expect(lastBot()).toHaveTextContent(REPLY));
      expect(toastSpy).not.toHaveBeenCalled();
    });

    it("a stream error mid-reply stops the open sentence queue at once", async () => {
      const live = liveReply();
      const { mock } = setup(replyRoutes({ "POST /api/ai/chat/completions": live.handler, "POST /api/ai/audio/speech": pendingSpeech }));
      await screen.findByText("reply");
      await say("A latte please");
      await live.delta("Great choice. What size");
      await waitFor(() => expect(speechInputs(mock.calls)).toEqual(["Great choice."]));
      await live.fail();
      await screen.findByTestId("message-retry");
      expect(speechSignals(mock.calls)[0].aborted).toBe(true);
      expect(lastTts()).not.toHaveAttribute("data-state", "loading");
      expect(lastTts()).not.toHaveAttribute("data-state", "playing");
      await settle();
      expect(speechInputs(mock.calls)).toEqual(["Great choice."]);
      expect(toastSpy).not.toHaveBeenCalled(); // 被中止的朗读不算失败
    });

    it("retrying after a mid-reply error reads the retried reply from its first sentence (fresh key)", async () => {
      let attempt = 0;
      const { mock } = setup(replyRoutes({
        "POST /api/ai/chat/completions": () => (++attempt === 1
          ? sse([delta("Old one. Old"), 'data: {"error": "Upstream unavailable"}\n\n'])
          : sse([delta("New one. "), delta("New two."), DONE_EVENT])),
      }));
      await screen.findByText("reply");
      await say("A latte please");
      await screen.findByTestId("message-retry");
      expect(speechInputs(mock.calls)).toEqual(["Old one."]);
      await userEvent.click(screen.getByTestId("message-retry"));
      await waitFor(() => expect(speechInputs(mock.calls)).toEqual(["Old one.", "New one.", "New two."]));
      await waitFor(() => expect(lastTts()).toHaveAttribute("data-state", "playing"));
    });

    it("switching conversations mid-reply stops the queue and reads nothing more", async () => {
      const live = liveReply();
      const { mock } = setup(replyRoutes({
        "POST /api/ai/chat/completions": live.handler,
        "POST /api/ai/audio/speech": pendingSpeech,
        "GET /api/conversations/c2": () => json({ id: "c2", name: "Other chat", config: CONFIG }),
        "GET /api/conversations/c2/messages": () => json({ messages: [{ id: "n0", conversation_id: "c2", role: "assistant", content: "Second chat hello" }] }),
      }));
      await screen.findByText("reply");
      await say("A latte please");
      await live.delta("Great choice. What size");
      await waitFor(() => expect(speechInputs(mock.calls)).toHaveLength(1));
      act(() => goTo("/chat/c2"));
      await screen.findByText("Second chat hello");
      expect(speechSignals(mock.calls)[0].aborted).toBe(true);
      await live.delta(" would you like? We have small and large.");
      await live.done();
      await settle();
      expect(speechInputs(mock.calls)).toEqual(["Great choice."]);
      expect(toastSpy).not.toHaveBeenCalled();
    });

    it("leaving the page mid-reply stops the queue and reads nothing more", async () => {
      const live = liveReply();
      const { mock, view } = setup(replyRoutes({ "POST /api/ai/chat/completions": live.handler, "POST /api/ai/audio/speech": pendingSpeech }));
      await screen.findByText("reply");
      await say("A latte please");
      await live.delta("Great choice. What size");
      await waitFor(() => expect(speechInputs(mock.calls)).toHaveLength(1));
      view.unmount();
      expect(speechSignals(mock.calls)[0].aborted).toBe(true);
      await live.delta(" would you like? We have small and large.");
      await live.done();
      await settle();
      expect(speechInputs(mock.calls)).toEqual(["Great choice."]);
    });

    it("turning auto-read off mid-reply stops the queue; later sentences are not requested", async () => {
      const live = liveReply();
      const { mock } = setup(replyRoutes({ "POST /api/ai/chat/completions": live.handler, "POST /api/ai/audio/speech": pendingSpeech }));
      await screen.findByText("reply");
      await say("A latte please");
      await live.delta("Great choice. What size");
      await waitFor(() => expect(speechInputs(mock.calls)).toHaveLength(1));
      await userEvent.click(await headerOption("conversation-autospeak"));
      expect(speechSignals(mock.calls)[0].aborted).toBe(true);
      await live.delta(" would you like? We have small and large.");
      await live.done();
      await waitFor(() => expect(lastBot()).toHaveTextContent(REPLY));
      await settle();
      expect(speechInputs(mock.calls)).toEqual(["Great choice."]);
      expect(lastTts()).toHaveAttribute("data-state", "idle");
    });

    it("a new send while a pipelined reply is still reading stops it; the new reply is read per sentence", async () => {
      let n = 0;
      const { mock } = setup(replyRoutes({
        "POST /api/ai/chat/completions": () => (++n === 1 ? sse([delta(REPLY), DONE_EVENT]) : sse([delta("Small it is. "), delta("Anything else?"), DONE_EVENT])),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: `u${n}` }, { id: `a${n}` }] }),
        "POST /api/ai/audio/speech": (call) => (n === 1 ? pendingSpeech(call) : new Response(new Uint8Array([1]))),
      }));
      await screen.findByText("reply");
      await say("A latte please");
      await waitFor(() => expect(speechInputs(mock.calls)).toEqual(SENTENCES));
      await waitFor(() => expect(screen.getByTestId("chat-send")).toBeDisabled()); // 输入框已清空
      await say("Small");
      await waitFor(() => expect(speechInputs(mock.calls)).toEqual([...SENTENCES, "Small it is.", "Anything else?"]));
      expect(speechSignals(mock.calls).slice(0, 3).every((s) => s.aborted)).toBe(true);
      expect(toastSpy).not.toHaveBeenCalled();
    });

    it("starting a recording stops a pipelined reading", async () => {
      const fake = createFakeRecorderEnv();
      const { mock } = setup(replyRoutes({
        "POST /api/ai/audio/speech": (call) => (speechInputs(mock.calls).length === 1 ? new Response(new Uint8Array([1])) : pendingSpeech(call)),
      }), fake.env);
      await screen.findByText("reply");
      await say("A latte please");
      await waitFor(() => expect(speechInputs(mock.calls)).toEqual(SENTENCES));
      await waitFor(() => expect(lastTts()).toHaveAttribute("data-state", "playing"));
      await startRecording();
      await waitFor(() => expect(lastTts()).toHaveAttribute("data-state", "idle"));
      expect(speechSignals(mock.calls).slice(1).every((s) => s.aborted)).toBe(true);
      await userEvent.click(screen.getByTestId("chat-mic-cancel"));
    });

    it("a blocked autoplay on the first sentence offers tap-to-read, which reads the whole reply", async () => {
      let block = true;
      vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() =>
        block ? Promise.reject(new DOMException("blocked", "NotAllowedError")) : Promise.resolve());
      const { mock } = setup(replyRoutes());
      await screen.findByText("reply");
      await say("A latte please");
      expect(await screen.findByTestId("autospeak-blocked")).toBeInTheDocument();
      await waitFor(() => expect(lastBot()).toHaveTextContent(REPLY));
      await settle();
      const before = speechInputs(mock.calls).length;
      block = false;
      await userEvent.click(screen.getByTestId("autospeak-tap"));
      await waitFor(() => expect(speechInputs(mock.calls).slice(before)).toEqual([REPLY]));
      await waitFor(() => expect(lastTts()).toHaveAttribute("data-state", "playing"));
      expect(toastSpy).not.toHaveBeenCalled();
    });

    it("reads each sentence exactly once under StrictMode", async () => {
      const { mock } = setup(replyRoutes(), undefined, { strict: true });
      await screen.findByText("reply");
      await say("A latte please");
      await waitFor(() => expect(speechInputs(mock.calls)).toEqual(SENTENCES));
      await settle();
      expect(speechInputs(mock.calls)).toEqual(SENTENCES);
    });
  });

  describe("hold to talk (plan 2026-10-07 R11)", () => {
    const innerWidth = window.innerWidth;
    afterEach(() => { window.innerWidth = innerWidth; });
    const holdRoutes = (extra: Record<string, Handler> = {}) => routes({
      "POST /api/ai/audio/transcriptions": () => json({ text: "I like apples" }),
      "POST /api/speech/assessments": () => json(ASSESSED),
      "POST /api/ai/chat/completions": () => sse([delta("Me too!"), DONE_EVENT]),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      ...extra,
    });
    const hit = (mock: ReturnType<typeof createFetchMock>, path: string) => mock.calls.some((c) => c.url.pathname === path);
    const input = () => screen.getByTestId("chat-input") as HTMLTextAreaElement;

    it("hold and release sends a voice message", async () => {
      const { mock } = setup(holdRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await holdMic(await voiceMode(), { ms: 1500 });
      await waitFor(() => expect(hit(mock, "/api/ai/audio/transcriptions")).toBe(true));
      await waitFor(() => expect(hit(mock, "/api/ai/chat/completions")).toBe(true));
      expect(await screen.findByTestId("message-user")).toHaveTextContent("I like apples");
    });

    it("the mic button is labelled 'Hold to talk' and keeps the recording test ids while held", async () => {
      setup(holdRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      const mic = await voiceMode();
      expect(mic).toHaveAccessibleName(/hold to talk/i);
      expect(mic).toHaveAttribute("data-hold-to-talk");
      fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
      await waitFor(() => expect(mic).toHaveAttribute("data-hold", "recording"));
      expect(mic).toHaveAttribute("data-state", "recording");
      expect(screen.getByTestId("voice-recording")).toBeInTheDocument();
      expect(screen.getByTestId("voice-timer")).toHaveTextContent("00:00 / 01:00");
      expect(screen.getByTestId("chat-mic-cancel")).toBeInTheDocument();
      fireEvent.pointerCancel(mic, { pointerId: 1 });
      await waitFor(() => expect(mic).toHaveAttribute("data-state", "idle"));
    });

    it("slide up and release on 'to text' fills the composer without sending, and focuses it", async () => {
      window.innerWidth = 400;
      const { mock } = setup(holdRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await holdMic(await voiceMode(), { dy: -150, x: 350 });
      await waitFor(() => expect(input().value).toBe("I like apples"));
      await waitFor(() => expect(input()).toHaveFocus());
      expect(hit(mock, "/api/ai/chat/completions")).toBe(false);
      expect(hit(mock, "/api/speech/assessments")).toBe(false);
      expect(mock.calls.some((c) => c.method === "POST" && c.url.pathname.endsWith("/messages"))).toBe(false);
      expect(screen.queryAllByTestId("message-user")).toHaveLength(0); // 没有草稿气泡留下
      expect(screen.getByTestId("chat-send")).toBeEnabled();
    });

    it("'to text' appends to what is already typed, separated by one space", async () => {
      window.innerWidth = 400;
      setup(holdRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await userEvent.type(input(), "Well,  ");
      await holdMic(await voiceMode(), { dy: -150, x: 350 });
      await waitFor(() => expect(input().value).toBe("Well, I like apples"));
    });

    it("slide up and release on 'cancel' discards without uploading and releases the microphone", async () => {
      window.innerWidth = 400;
      const fake = createFakeRecorderEnv();
      const { mock } = setup(holdRoutes(), fake.env);
      await screen.findByText("reply");
      await holdMic(await voiceMode(), { dy: -150, x: 40 });
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle"));
      expect(fake.track.stop).toHaveBeenCalled();
      expect(screen.getByTestId("hold-hint")).toHaveTextContent("Recording cancelled");
      await act(async () => {});
      expect(hit(mock, "/api/ai/audio/transcriptions")).toBe(false);
      expect(screen.queryAllByTestId("message-user")).toHaveLength(0);
    });

    it("a short tap shows the hint, records nothing and releases the microphone", async () => {
      const fake = createFakeRecorderEnv();
      const { mock } = setup(holdRoutes(), fake.env);
      await screen.findByText("reply");
      await holdMic(await voiceMode(), { ms: 100 });
      const hint = await screen.findByTestId("hold-hint");
      expect(hint).toHaveTextContent(/hold to talk|按住说话/i);
      expect(hint).toHaveAttribute("role", "status");
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle"));
      expect(fake.track.stop).toHaveBeenCalled();
      await act(async () => {});
      expect(hit(mock, "/api/ai/audio/transcriptions")).toBe(false);
      expect(screen.queryAllByTestId("message-user")).toHaveLength(0);
    });

    // 假时钟(随真实时间推进,麦克风与 waitFor 照常工作);提示条的 2 s 由 advanceTimersByTime 一次跳过,不真等。
    // 断言留足余量(≥ 900 ms),真实时间的漂移不会影响结果。
    const fakeHintTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    afterEach(() => { vi.useRealTimers(); });

    it("hiding the real page while recording (keyboard fallback included) discards the take instead of keeping a draft", async () => {
      const fake = createFakeRecorderEnv();
      const { mock } = setup(holdRoutes(), fake.env);
      await screen.findByText("reply");
      await startRecording();
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording"));
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      try {
        await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      } finally {
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      }
      expect(await screen.findByTestId("hold-hint")).toHaveTextContent("Recording cancelled");
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle"));
      expect(fake.track.stop).toHaveBeenCalled();
      expect(screen.queryByTestId("voice-send-kept")).toBeNull();
      expect(screen.queryAllByTestId("message-user")).toHaveLength(0);
      await act(async () => {});
      expect(hit(mock, "/api/ai/audio/transcriptions")).toBe(false);
    });

    it("the hint goes away after 2 seconds", async () => {
      fakeHintTimers();
      setup(holdRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await holdMic(await voiceMode(), { ms: 100 });
      expect(await screen.findByTestId("hold-hint")).toHaveTextContent("Hold to talk");
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(screen.getByTestId("hold-hint")).toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(1100); });
      expect(screen.queryByTestId("hold-hint")).toBeNull();
    });

    it("the same hint shown again restarts its 2 seconds", async () => {
      fakeHintTimers();
      setup(holdRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await holdMic(await voiceMode(), { ms: 100 });
      expect(await screen.findByTestId("hold-hint")).toHaveTextContent("Hold to talk");
      await act(async () => { vi.advanceTimersByTime(1500); });
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle"));
      await holdMic(await voiceMode(), { ms: 100 }); // 同样的"太短"提示
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle"));
      await act(async () => { vi.advanceTimersByTime(1000); });
      // 第一条的计时器(此时已过 2.5 s)不能把第二条提前收走
      expect(screen.getByTestId("hold-hint")).toHaveTextContent("Hold to talk");
      await act(async () => { vi.advanceTimersByTime(1100); });
      expect(screen.queryByTestId("hold-hint")).toBeNull();
    });

    it("releasing while the permission prompt is open says the mic is ready and releases the late microphone", async () => {
      let grant!: () => void;
      const fake = createFakeRecorderEnv();
      const stream = await fake.env.getUserMedia({ audio: true });
      const env = { ...fake.env, getUserMedia: () => new Promise<MediaStream>((r) => { grant = () => r(stream); }) };
      const { mock } = setup(holdRoutes(), env);
      await screen.findByText("reply");
      const mic = await voiceMode();
      let t = 10_000;
      const now = vi.spyOn(performance, "now").mockImplementation(() => t);
      try {
        fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
        expect(mic).toHaveAttribute("data-state", "starting");
        t += 800;
        fireEvent.pointerUp(mic, { pointerId: 1, clientX: 200, clientY: 700 });
      } finally {
        now.mockRestore();
      }
      expect(await screen.findByTestId("hold-hint")).toHaveTextContent("Microphone is ready – hold to talk");
      await act(async () => { grant(); });
      await waitFor(() => expect(fake.track.stop).toHaveBeenCalled());
      expect(mic).toHaveAttribute("data-state", "idle");
      expect(hit(mock, "/api/ai/audio/transcriptions")).toBe(false);
    });

    it("keyboard fallback: Space starts and Space again sends", async () => {
      const { mock } = setup(holdRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      const mic = await voiceMode();
      pressKey(mic, " ");
      await waitFor(() => expect(mic).toHaveAttribute("data-state", "recording"));
      expect(mic).toHaveAccessibleName(/press Space to send/i);
      pressKey(mic, " ");
      await waitFor(() => expect(hit(mock, "/api/ai/audio/transcriptions")).toBe(true));
      await waitFor(() => expect(hit(mock, "/api/ai/chat/completions")).toBe(true));
    });

    it("keyboard fallback: Enter starts and Escape cancels without uploading", async () => {
      const fake = createFakeRecorderEnv();
      const { mock } = setup(holdRoutes(), fake.env);
      await screen.findByText("reply");
      const mic = await voiceMode();
      pressKey(mic, "Enter");
      await waitFor(() => expect(mic).toHaveAttribute("data-state", "recording"));
      pressKey(mic, "Escape");
      await waitFor(() => expect(mic).toHaveAttribute("data-state", "idle"));
      expect(fake.track.stop).toHaveBeenCalled();
      expect(screen.getByTestId("hold-hint")).toHaveTextContent("Recording cancelled");
      await act(async () => {});
      expect(hit(mock, "/api/ai/audio/transcriptions")).toBe(false);
    });

    it("the mic stays disabled while a reply streams: a press starts nothing", async () => {
      const reply = gate();
      const fake = createFakeRecorderEnv();
      setup(holdRoutes({ "POST /api/ai/chat/completions": async () => { await reply.promise; return sse([delta("Done"), DONE_EVENT]); } }), fake.env);
      await screen.findByText("reply");
      // 文字模式下发出的回复期间切不到长条,所以用一条语音触发回复(长条留在原地)
      const mic = await voiceMode();
      await holdMic(mic, { ms: 1000 });
      await waitFor(() => expect(screen.getByTestId("message-user")).toHaveTextContent("I like apples"));
      await waitFor(() => expect(mic).toBeDisabled());
      const recorders = fake.recorders.length;
      fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
      pressKey(mic, " ");
      expect(mic).toHaveAttribute("data-state", "idle");
      expect(mic).toHaveAttribute("data-hold", "idle");
      expect(fake.recorders).toHaveLength(recorders);
      await act(async () => { reply.release(); });
      await waitFor(() => expect(mic).toBeEnabled());
    });

    it("a hold started while read-aloud plays stops it, and the release unlocks playback for the reply", async () => {
      const fake = createFakeRecorderEnv();
      const play = vi.mocked(HTMLMediaElement.prototype.play);
      setup(holdRoutes(), fake.env);
      await userEvent.click(await screen.findByTestId("message-tts"));
      await waitFor(() => expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "playing"));
      const mic = await voiceMode();
      fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
      await waitFor(() => expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "idle"));
      await waitFor(() => expect(mic).toHaveAttribute("data-hold", "recording"));
      fireEvent.pointerCancel(mic, { pointerId: 1 });
      await waitFor(() => expect(mic).toHaveAttribute("data-state", "idle"));
      play.mockClear();
      await holdMic(mic, { ms: 1000 });
      expect(play).toHaveBeenCalled(); // 松手的同步阶段 autoSpeak.prime() 解锁了共享播放元素
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Me too!"));
    });

    it("switching conversations mid-hold releases the microphone and resets the button", async () => {
      const fake = createFakeRecorderEnv();
      setup(holdRoutes({
        "GET /api/conversations/c2": () => json({ id: "c2", name: "Other chat", config: CONFIG }),
        "GET /api/conversations/c2/messages": () => json({ messages: [{ id: "n0", conversation_id: "c2", role: "assistant", content: "Second chat hello" }] }),
      }), fake.env);
      await screen.findByText("reply");
      const mic = await voiceMode();
      fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
      await waitFor(() => expect(mic).toHaveAttribute("data-hold", "recording"));
      await act(async () => { goTo("/chat/c2"); });
      await screen.findByText("Second chat hello");
      expect(fake.track.stop).toHaveBeenCalled();
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-hold", "idle"));
      expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
    });
  });

  describe("WeChat-style composer: text input or a 'hold to talk' bar", () => {
    const innerWidth = window.innerWidth;
    afterEach(() => {
      window.innerWidth = innerWidth;
      vi.restoreAllMocks();
    });
    const modeRoutes = (extra: Record<string, Handler> = {}) => routes({
      "POST /api/ai/audio/transcriptions": () => json({ text: "I like apples" }),
      "POST /api/speech/assessments": () => json(ASSESSED),
      "POST /api/ai/chat/completions": () => sse([delta("Me too!"), DONE_EVENT]),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      ...extra,
    });
    const toggle = () => screen.getByTestId("chat-mode-toggle");
    const input = () => screen.getByTestId("chat-input") as HTMLTextAreaElement;
    const hit = (mock: ReturnType<typeof createFetchMock>, path: string) => mock.calls.some((c) => c.url.pathname === path);

    it("starts in text mode: textarea and send button, no hold bar; the toggle offers voice", async () => {
      setup(modeRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      expect(input()).toBeInTheDocument();
      expect(screen.getByTestId("chat-send")).toBeInTheDocument();
      expect(screen.queryByTestId("chat-mic")).toBeNull();
      expect(toggle()).toHaveAttribute("data-mode", "text");
      expect(toggle()).toHaveAttribute("aria-pressed", "false");
      expect(toggle()).toHaveAccessibleName("Switch to voice");
      expect(screen.getByTestId("chat-hints")).toBeInTheDocument();
    });

    it("the toggle swaps the textarea for a full-width 'Hold to talk' bar and back, keeping the draft and focusing the textarea at its end", async () => {
      setup(modeRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await userEvent.type(input(), "Half a sentence");
      await userEvent.click(toggle());
      expect(toggle()).toHaveAttribute("data-mode", "voice");
      expect(toggle()).toHaveAttribute("aria-pressed", "true");
      expect(toggle()).toHaveAccessibleName("Switch to keyboard");
      expect(screen.queryByTestId("chat-input")).toBeNull();
      expect(screen.queryByTestId("chat-send")).toBeNull(); // 语音模式没有发送按钮:长条就是动作
      const bar = screen.getByTestId("chat-mic");
      expect(bar).toHaveTextContent("Hold to talk");
      expect(bar).toHaveAccessibleName(/hold to talk/i);
      expect(screen.getByTestId("chat-hints")).toBeEnabled(); // 提示不需要文字,两种模式都有
      expect(localStorage.getItem(COMPOSER_MODE_KEY)).toBe("voice");
      await userEvent.click(toggle());
      expect(toggle()).toHaveAttribute("data-mode", "text");
      expect(input()).toHaveValue("Half a sentence");
      await waitFor(() => expect(input()).toHaveFocus());
      expect(input().selectionStart).toBe("Half a sentence".length);
      expect(input().selectionEnd).toBe("Half a sentence".length);
      expect(screen.getByTestId("chat-send")).toBeEnabled();
      expect(screen.queryByTestId("chat-mic")).toBeNull();
      expect(localStorage.getItem(COMPOSER_MODE_KEY)).toBe("text");
    });

    it("switching to voice takes the focus out of the textarea", async () => {
      setup(modeRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await userEvent.click(input());
      expect(input()).toHaveFocus();
      await userEvent.click(toggle());
      expect(screen.queryByTestId("chat-input")).toBeNull();
      expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
    });

    it("remembers the last mode on this device", async () => {
      localStorage.setItem(COMPOSER_MODE_KEY, "voice");
      setup(modeRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      expect(toggle()).toHaveAttribute("data-mode", "voice");
      expect(screen.getByTestId("chat-mic")).toBeInTheDocument();
      expect(screen.queryByTestId("chat-input")).toBeNull();
    });

    it("an unreadable stored mode or unavailable storage falls back to text without breaking the page", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
      setup(modeRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      expect(toggle()).toHaveAttribute("data-mode", "text");
      await userEvent.click(toggle());
      expect(toggle()).toHaveAttribute("data-mode", "voice"); // 本页仍生效
    });

    it("the toggle is disabled until the conversation loads", async () => {
      const loaded = gate();
      setup(modeRoutes({ "GET /api/conversations/c1": async () => { await loaded.promise; return json({ id: "c1", name: "x", config: CONFIG }); } }),
        createFakeRecorderEnv().env);
      const t = await screen.findByTestId("chat-mode-toggle");
      expect(t).toBeDisabled();
      await act(async () => { loaded.release(); });
      await waitFor(() => expect(t).toBeEnabled());
    });

    it("the toggle is disabled while recording, transcribing and while the reply streams, then works again", async () => {
      const transcribed = gate();
      const reply = gate();
      setup(modeRoutes({
        "POST /api/ai/audio/transcriptions": async () => { await transcribed.promise; return json({ text: "I like apples" }); },
        "POST /api/ai/chat/completions": async () => { await reply.promise; return sse([delta("Me too!"), DONE_EVENT]); },
      }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      const bar = await voiceMode();
      let t = 10_000;
      const now = vi.spyOn(performance, "now").mockImplementation(() => t);
      fireEvent.pointerDown(bar, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
      await waitFor(() => expect(bar).toHaveAttribute("data-hold", "recording"));
      expect(toggle()).toBeDisabled();
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute("data-mode", "voice");
      t += 1000;
      fireEvent.pointerUp(bar, { pointerId: 1, clientX: 200, clientY: 700 });
      now.mockRestore();
      await waitFor(() => expect(bar).toHaveAttribute("data-state", "processing"));
      expect(toggle()).toBeDisabled();
      await act(async () => { transcribed.release(); });
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveAttribute("data-status", "streaming"));
      expect(toggle()).toBeDisabled();
      expect(bar).toBeDisabled();
      await act(async () => { reply.release(); });
      await waitFor(() => expect(toggle()).toBeEnabled());
      expect(toggle()).toHaveAttribute("data-mode", "voice"); // 发出语音后仍留在语音模式
    });

    it("pressing the bar shows its pressed label and a centered overlay; sliding up arms cancel (red) or to-text", async () => {
      window.innerWidth = 400;
      setup(modeRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      const bar = await voiceMode();
      fireEvent.pointerDown(bar, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
      await waitFor(() => expect(bar).toHaveAttribute("data-hold", "recording"));
      expect(bar).toHaveTextContent("Release to send");
      const overlay = screen.getByTestId("hold-overlay");
      const hint = screen.getByTestId("hold-overlay-hint");
      expect(hint).toHaveTextContent("Slide up to cancel");
      expect(hint).toHaveAttribute("data-tone", "normal");
      expect(screen.getByTestId("hold-zone-cancel")).toHaveAttribute("data-active", "false");
      expect(screen.getByTestId("hold-zone-text")).toHaveAttribute("data-active", "false");
      expect(overlay).toContainElement(screen.getByTestId("voice-timer"));
      fireEvent.pointerMove(bar, { pointerId: 1, clientX: 50, clientY: 560 });
      expect(hint).toHaveTextContent("Release to cancel");
      expect(hint).toHaveAttribute("data-tone", "danger");
      expect(screen.getByTestId("hold-zone-cancel")).toHaveAttribute("data-active", "true");
      expect(bar).toHaveTextContent("Release to cancel");
      fireEvent.pointerMove(bar, { pointerId: 1, clientX: 350, clientY: 560 });
      expect(hint).toHaveTextContent("Release to convert to text");
      expect(screen.getByTestId("hold-zone-text")).toHaveAttribute("data-active", "true");
      expect(screen.getByTestId("hold-zone-cancel")).toHaveAttribute("data-active", "false");
      expect(bar).toHaveTextContent("Release to convert to text");
      fireEvent.pointerCancel(bar, { pointerId: 1 });
      await waitFor(() => expect(bar).toHaveAttribute("data-state", "idle"));
      expect(screen.queryByTestId("hold-overlay")).toBeNull();
      expect(bar).toHaveTextContent("Hold to talk");
    });

    it("'to text' fills the transcript, switches to text mode and focuses the textarea at the end", async () => {
      window.innerWidth = 400;
      const { mock } = setup(modeRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await userEvent.type(input(), "Well,");
      await holdMic(await voiceMode(), { dy: -150, x: 350 });
      await waitFor(() => expect(toggle()).toHaveAttribute("data-mode", "text"));
      await waitFor(() => expect(input()).toHaveValue("Well, I like apples"));
      await waitFor(() => expect(input()).toHaveFocus());
      expect(input().selectionStart).toBe("Well, I like apples".length);
      expect(screen.getByTestId("chat-send")).toBeEnabled();
      expect(screen.queryByTestId("chat-mic")).toBeNull();
      expect(localStorage.getItem(COMPOSER_MODE_KEY)).toBe("text");
      expect(hit(mock, "/api/ai/chat/completions")).toBe(false);
    });

    it("hold and release in voice mode sends and stays in voice mode", async () => {
      const { mock } = setup(modeRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await holdMic(await voiceMode(), { ms: 1500 });
      await waitFor(() => expect(hit(mock, "/api/ai/chat/completions")).toBe(true));
      expect(await screen.findByTestId("message-user")).toHaveTextContent("I like apples");
      expect(toggle()).toHaveAttribute("data-mode", "voice");
      expect(screen.queryByTestId("chat-input")).toBeNull();
    });

    it("a short tap on the bar and a cancel slide keep their hints", async () => {
      window.innerWidth = 400;
      setup(modeRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      const bar = await voiceMode();
      await holdMic(bar, { ms: 100 });
      expect(await screen.findByTestId("hold-hint")).toHaveTextContent("Hold to talk");
      await waitFor(() => expect(bar).toHaveAttribute("data-state", "idle"));
      await holdMic(bar, { dy: -150, x: 40 });
      await waitFor(() => expect(screen.getByTestId("hold-hint")).toHaveTextContent("Recording cancelled"));
    });

    it("keyboard: Space on the bar starts (overlay explains the keys), Escape cancels, Space twice sends", async () => {
      const { mock } = setup(modeRoutes(), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      const bar = await voiceMode();
      bar.focus();
      pressKey(bar, " ");
      await waitFor(() => expect(bar).toHaveAttribute("data-state", "recording"));
      expect(screen.getByTestId("hold-overlay-hint")).toHaveTextContent(/press Space to send, Escape to cancel/i);
      expect(screen.queryByTestId("hold-zone-cancel")).toBeNull(); // 键盘录音没有上滑落点
      pressKey(bar, "Escape");
      await waitFor(() => expect(bar).toHaveAttribute("data-state", "idle"));
      expect(screen.getByTestId("hold-hint")).toHaveTextContent("Recording cancelled");
      pressKey(bar, " ");
      await waitFor(() => expect(bar).toHaveAttribute("data-state", "recording"));
      pressKey(bar, " ");
      await waitFor(() => expect(hit(mock, "/api/ai/chat/completions")).toBe(true));
    });

    it("'Use this reply' from the hints switches to text mode with the reply filled in", async () => {
      const REPLIES = { replies: [1, 2, 3].map((i) => ({ text: `Reply ${i}.`, zh: `回复 ${i}` })) };
      setup(modeRoutes({ "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: JSON.stringify(REPLIES) } }] }) }),
        createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await voiceMode();
      await userEvent.click(screen.getByTestId("chat-hints"));
      await userEvent.click((await screen.findAllByTestId("hint-fill"))[1]);
      expect(toggle()).toHaveAttribute("data-mode", "text");
      expect(input()).toHaveValue("Reply 2.");
    });

    it("voice mode without microphone support: the toggle works and a press shows the microphone error", async () => {
      const error = vi.spyOn(toast, "error");
      const fake = createFakeRecorderEnv();
      const env = { ...fake.env, getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")) };
      setup(modeRoutes(), env);
      await screen.findByText("reply");
      const bar = await voiceMode();
      fireEvent.pointerDown(bar, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
      await waitFor(() => expect(error).toHaveBeenCalled());
      await waitFor(() => expect(bar).toHaveAttribute("data-state", "idle"));
      expect(toggle()).toBeEnabled();
    });
  });
});

describe("realtime call (plan 2026-10-07)", () => {
  const ENABLED = { enabled: true, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 };
  const WRONG = { has_errors: true, corrected: "She doesn't like coffee.", errors: [{ original: "don't", corrected: "doesn't", category: "agreement", explanation: "x" }] };

  class CallSocket {
    static instances: CallSocket[] = [];
    readyState = 0;
    binaryType = "blob";
    sent: Array<string | ArrayBuffer> = [];
    onopen: null | (() => void) = null;
    onmessage: null | ((e: { data: string | ArrayBuffer }) => void) = null;
    onclose: null | ((e: { code: number }) => void) = null;
    onerror: null | (() => void) = null;
    close = vi.fn((code?: number) => { this.readyState = 3; void code; });
    constructor(public url: string) { CallSocket.instances.push(this); }
    send(data: string | ArrayBuffer) { this.sent.push(data); }
    open() { this.readyState = 1; this.onopen?.(); }
    server(event: object) { this.onmessage?.({ data: JSON.stringify(event) }); }
    serverClose(code: number) { this.readyState = 3; this.onclose?.({ code }); }
    texts() { return this.sent.filter((s): s is string => typeof s === "string").map((s) => JSON.parse(s)); }
  }

  /** 注入的通话环境:假 WebSocket、假麦克风/上下文/worklet、假 VAD(真实的 RealtimeCall 与对话框照常运行)。 */
  function callEnv(over: { audio?: "none" | "throws" } = {}) {
    CallSocket.instances = [];
    const ctx = new FakeAudioContext(16000);
    const node = new FakeWorkletNode();
    const stream = fakeStream();
    const vad = { start: vi.fn(), pause: vi.fn(), setSensitivity: vi.fn(), destroy: vi.fn(async () => undefined) };
    const createAudioContext = vi.fn(() => {
      if (over.audio === "throws") throw new Error("no audio");
      return asContext(ctx);
    });
    const env: RealtimeEnv = {
      WebSocket: CallSocket as unknown as RealtimeEnv["WebSocket"],
      capture: {
        isSecureContext: true, getUserMedia: vi.fn(async () => stream), supportedConstraints: () => ({}),
        createAudioContext: over.audio === "none" ? undefined : createAudioContext,
        createWorkletNode: () => node as unknown as AudioWorkletNode, workletUrl: "/w.js",
      },
      createVad: vi.fn(async () => vad) as unknown as RealtimeEnv["createVad"],
      location: { protocol: "https:", host: "app.test" },
    };
    return { env, ctx, stream, vad, createAudioContext, ws: () => CallSocket.instances[0] };
  }

  function callRoutes(extra: Record<string, Handler> = {}) {
    return routes({
      "GET /api/realtime/config": () => json(ENABLED),
      "POST /api/realtime/ticket": () => json({ ticket: "tk", expires_in: 60 }),
      ...extra,
    });
  }

  function setupCall(r: Record<string, Handler>, env?: RealtimeEnv, opts: { strict?: boolean; recorderEnv?: ReturnType<typeof createFakeRecorderEnv>["env"] } = {}) {
    const mock = createFetchMock(r);
    const page = <><ConversationPage realtimeEnv={env} recorderEnv={opts.recorderEnv} /><NavProbe /></>;
    const view = renderWithProviders(opts.strict ? <StrictMode>{page}</StrictMode> : page, {
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1", path: "/chat/:id",
    });
    return { mock, view };
  }

  /** 打开通话并让服务端就绪:返回已打开的 socket */
  async function connect(c: ReturnType<typeof callEnv>) {
    await userEvent.click(await screen.findByTestId("conversation-call"));
    await waitFor(() => expect(c.ws()).toBeDefined());
    await act(async () => { c.ws().open(); c.ws().server({ type: "ready", asr: "buffered" }); });
    await waitFor(() => expect(screen.getByTestId("call-status")).toHaveAttribute("data-phase", "listening"));
    return c.ws();
  }

  beforeEach(async () => {
    resetServerAiConfigCache();
    resetPageAudioContextForTests();
    await deleteDb();
    resetKvCacheForTests();
    localStorage.clear();
    // 这些用例盯着麦克风:输入栏从"按住 说话"长条开始;要打字的用例用 textMode() 切换
    localStorage.setItem(COMPOSER_MODE_KEY, "voice");
    // 假时钟随真实时间推进(麦克风、userEvent、waitFor 照常);挂断后等关闭的 3 s、补取的 2 s 由 advance 跳过
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    resetPageAudioContextForTests();
    vi.unstubAllGlobals();
  });
  const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  /** 挂断,服务端随后关闭(它存完被打断的回复才关) */
  async function hangUp(ws: CallSocket) {
    await userEvent.click(screen.getByTestId("call-hangup"));
    await act(async () => { ws.serverClose(1000); });
  }
  /** 通话后的收尾结束(补取完成、输入恢复) */
  async function settle() {
    await advance(POST_CALL_FOLLOW_UP_MS + 100);
    await waitFor(() => expect(screen.getByTestId("chat-mic")).toBeEnabled());
  }

  it("shows the call button only when the server enables it", async () => {
    const { mock } = setup(routes());
    await screen.findByText("reply");
    await waitFor(() => expect(callsTo(mock, "GET", "/api/realtime/config")).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByTestId("conversation-call")).toBeNull();
  });

  it("hides the call button when the browser has no AudioContext, even if the server enables it", async () => {
    const c = callEnv({ audio: "none" });
    const { mock } = setupCall(callRoutes(), c.env);
    await screen.findByText("reply");
    await waitFor(() => expect(callsTo(mock, "GET", "/api/realtime/config")).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByTestId("conversation-call")).toBeNull();
  });

  it("opens the call screen from the header and unlocks audio in the click", async () => {
    const created: FakeCtx[] = [];
    class FakeCtx {
      state = "suspended";
      sampleRate = 48000;
      destination = {};
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
      createBuffer = vi.fn(() => ({}));
      createBufferSource = vi.fn(() => ({ connect: vi.fn(), start: vi.fn() }));
      constructor() { created.push(this); }
    }
    vi.stubGlobal("AudioContext", FakeCtx);
    const { mock } = setup(routes({
      "GET /api/realtime/config": () => json(ENABLED),
      "POST /api/realtime/ticket": () => json({ error: "Realtime is not enabled" }, 503),
    }));
    const button = await screen.findByTestId("conversation-call");
    expect(button).toHaveAccessibleName("Start a voice call");
    await userEvent.click(button);
    // 点击的同步阶段:页面级共享上下文已创建并解锁(resume + 一帧静音缓冲)
    expect(created).toHaveLength(1);
    expect(created[0].resume).toHaveBeenCalled();
    expect(created[0].createBufferSource).toHaveBeenCalled();
    expect(await screen.findByTestId("call-screen")).toBeInTheDocument();
    expect(await screen.findByTestId("call-error")).toHaveTextContent("Voice calls are not enabled on this server"); // 票据被拒 → 结束页
    expect(callsTo(mock, "POST", "/api/realtime/ticket")).toHaveLength(1);
    expect(bodyOf(callsTo(mock, "POST", "/api/realtime/ticket")[0])).toEqual({ conversation_id: "c1" });
    await userEvent.click(screen.getByTestId("call-close"));
    expect(screen.queryByTestId("call-screen")).toBeNull();
    // 共享上下文不属于通话(ownsContext: false):不关闭,之后的按住说话还要用它
    expect(created[0].close).not.toHaveBeenCalled();
    // 没有一句话被保存:不重新加载
    await act(async () => {});
    expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(1);
  });

  it("an AudioContext that cannot be created shows 'unsupported' and opens nothing", async () => {
    const spy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const c = callEnv({ audio: "throws" });
    const { mock } = setupCall(callRoutes(), c.env);
    await userEvent.click(await screen.findByTestId("conversation-call"));
    expect(spy).toHaveBeenCalledWith("This browser cannot make voice calls");
    expect(screen.queryByTestId("call-screen")).toBeNull();
    expect(callsTo(mock, "POST", "/api/realtime/ticket")).toHaveLength(0);
  });

  it("starts with the effective system prompt, the conversation's model, temperature and voice, and saves recordings", async () => {
    const c = callEnv();
    setupCall(callRoutes({
      "GET /api/conversations/c1": () => json({ id: "c1", name: "Trip", config: { ...CONFIG, level: "A2", temperature: 0.4, tts_model: "volcengine/seed-tts-2.0", tts_voice: "zh_female_1" } }),
    }), c.env);
    const ws = await connect(c);
    expect(ws.url).toBe("wss://app.test/api/realtime?ticket=tk");
    const start = ws.texts()[0];
    expect(start).toMatchObject({ type: "start", model: "gpt-4o", temperature: 0.4, voice: "zh_female_1", save_recordings: true });
    expect(start.system_prompt).toMatch(/^SYS\n\nLanguage level: the learner is at CEFR A2\./);
  });

  it("a conversation that reads aloud with another provider calls with the server's Volcengine voice", async () => {
    const c = callEnv();
    const { mock } = setupCall(callRoutes({
      "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1", "volcengine/seed-tts-2.0"], voices: { openai: ["alloy"], volcengine: [{ label: "Xiao", value: "zh_female_x", language: "zh-CN" }, { label: "Vivi", value: "en_female_vivi", language: "en-US" }] } } }),
    }), c.env);
    await screen.findByText("reply");
    await waitFor(() => expect(callsTo(mock, "GET", "/api/config/tts_providers_v2")).toHaveLength(1));
    await act(async () => {});
    const ws = await connect(c);
    expect(ws.texts()[0]).toMatchObject({ voice: "en_female_vivi" });
  });

  it("shows the call voice's display name as the call partner", async () => {
    const c = callEnv();
    setupCall(callRoutes({
      "GET /api/conversations/c1": () => json({ id: "c1", name: "Trip", config: { ...CONFIG, tts_model: "volcengine/seed-tts-2.0", tts_voice: "en_female_emma" } }),
      "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["volcengine/seed-tts-2.0"], voices: { volcengine: [{ label: "Emma (US)", value: "en_female_emma", language: "en-US" }] } } }),
    }), c.env);
    await connect(c);
    expect(screen.getByRole("img", { name: "Emma" })).toBeInTheDocument();
  });

  /** 通话后第二次加载起返回通话里保存的两条消息(cm1 不带语法:语法结果晚到,由页面补到重新加载的气泡上) */
  const AFTER_CALL = [{ id: "m0", conversation_id: "c1", role: "assistant", content: "Earlier **reply**" },
    { id: "cm1", conversation_id: "c1", role: "user", content: "She don't like coffee." },
    { id: "cm2", conversation_id: "c1", role: "assistant", content: "Oh, what does she like?" }];
  const BEFORE_CALL = [{ id: "m0", conversation_id: "c1", role: "assistant", content: "Earlier **reply**" }];
  /** 通话里说一句并收到回复(服务端已保存 cm1/cm2) */
  async function oneCallTurn(ws: CallSocket) {
    await act(async () => {
      ws.server({ type: "transcript_final", text: "She don't like coffee.", message_id: "cm1" });
      ws.server({ type: "reply_delta", turn_id: 1, text: "Oh, what does she like?" });
      ws.server({ type: "reply_done", turn_id: 1, message_id: "cm2", interrupted: false });
    });
  }

  it("checks the grammar of each call turn, shows the end reason, reloads as soon as the call closes and patches the late result onto the reloaded message", async () => {
    const c = callEnv();
    const grammar = gate();
    let loads = 0;
    const { mock } = setupCall(callRoutes({
      "GET /api/conversations/c1/messages": () => json({ messages: ++loads === 1 ? BEFORE_CALL : AFTER_CALL }),
      "POST /api/ai/grammar": async () => { await grammar.promise; return json(WRONG); },
      "PATCH /api/messages/cm1": () => json({ id: "cm1" }),
    }), c.env);
    const ws = await connect(c);
    await oneCallTurn(ws);
    await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(1));
    // 第一句之前通话里还没有回复:用页面上最后一条回复作上下文
    expect(bodyOf(callsTo(mock, "POST", "/api/ai/grammar")[0])).toEqual({ text: "She don't like coffee.", context: "Earlier **reply**" });
    await act(async () => { ws.serverClose(4008); });
    expect(await screen.findByTestId("call-error")).toHaveTextContent("Hung up after a long silence");
    expect(c.stream.track.stop).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("call-close"));
    expect(screen.queryByTestId("call-screen")).toBeNull();
    // 不等语法:关闭即重新加载(之后用户做的事不会被晚到的重新加载抹掉)
    await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2));
    expect(await screen.findByText("Oh, what does she like?")).toBeInTheDocument();
    expect(screen.getAllByTestId("message-user").at(-1)).toHaveTextContent("She don't like coffee.");
    expect(screen.getByTestId("badge-grammar")).toHaveAttribute("data-status", "pending");
    await act(async () => { grammar.release(); });
    await waitFor(() => expect(callsTo(mock, "PATCH", "/api/messages/cm1")).toHaveLength(1));
    expect(bodyOf(callsTo(mock, "PATCH", "/api/messages/cm1")[0]).grammar).toMatchObject({ has_errors: true });
    // 晚到的结果按服务端消息 id 补到重新加载的气泡上
    await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveTextContent("Grammar: 1 to fix"));
    expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2); // 语法结果不触发重新加载
    await settle();
    expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(3); // 只有一次按 id 的补取
    expect(screen.getByTestId("badge-grammar")).toHaveTextContent("Grammar: 1 to fix");
    expect(c.ctx.close).not.toHaveBeenCalled();
  });

  it("a grammar result that lands while the post-call reload is still loading is applied to the loaded message", async () => {
    const c = callEnv();
    const grammar = gate();
    const reload = gate();
    let loads = 0;
    const { mock } = setupCall(callRoutes({
      "GET /api/conversations/c1/messages": async () => {
        if (++loads === 1) return json({ messages: BEFORE_CALL });
        await reload.promise;
        return json({ messages: AFTER_CALL });
      },
      "POST /api/ai/grammar": async () => { await grammar.promise; return json(WRONG); },
      "PATCH /api/messages/cm1": () => json({ id: "cm1" }),
    }), c.env);
    const ws = await connect(c);
    await oneCallTurn(ws);
    await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(1));
    await hangUp(ws);
    await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2));
    await act(async () => { grammar.release(); });
    await waitFor(() => expect(callsTo(mock, "PATCH", "/api/messages/cm1")).toHaveLength(1));
    await act(async () => { reload.release(); });
    expect(await screen.findByText("Oh, what does she like?")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveTextContent("Grammar: 1 to fix"));
  });

  it("a call turn whose grammar check failed can be retried from the reloaded message", async () => {
    const c = callEnv();
    let attempts = 0;
    let loads = 0;
    const { mock } = setupCall(callRoutes({
      "GET /api/conversations/c1/messages": () => json({ messages: ++loads === 1 ? BEFORE_CALL : AFTER_CALL }),
      "POST /api/ai/grammar": () => (++attempts === 1 ? json({ error: "Upstream unavailable" }, 502) : json(WRONG)),
      "PATCH /api/messages/cm1": () => json({ id: "cm1" }),
    }), c.env);
    const ws = await connect(c);
    await oneCallTurn(ws);
    await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(1));
    await hangUp(ws);
    await screen.findByText("Oh, what does she like?");
    await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveAttribute("data-status", "error"));
    await userEvent.click(screen.getByTestId("badge-grammar"));
    await waitFor(() => expect(callsTo(mock, "PATCH", "/api/messages/cm1")).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveTextContent("Grammar: 1 to fix"));
  });

  it("skips grammar checks when the conversation turns them off, but still reloads after the call", async () => {
    const c = callEnv();
    const { mock } = setupCall(callRoutes({
      "GET /api/conversations/c1": () => json({ id: "c1", name: "Trip", config: { ...CONFIG, grammar_check: false } }),
    }), c.env);
    const ws = await connect(c);
    await act(async () => { ws.server({ type: "transcript_final", text: "She don't like coffee.", message_id: "cm1" }); });
    await hangUp(ws);
    expect(screen.queryByTestId("call-screen")).toBeNull();
    expect(ws.texts().at(-1)).toEqual({ type: "hangup" });
    await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2));
    expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(0);
  });

  it("while a call runs: read-aloud is stopped, the page behind is inert and the microphone and sending are disabled", async () => {
    const c = callEnv();
    setupCall(callRoutes(), c.env);
    await userEvent.click(await screen.findByTestId("message-tts"));
    await waitFor(() => expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "playing"));
    await connect(c);
    expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "idle");
    expect(screen.getByTestId("chat-mic").closest("[inert]")).not.toBeNull();
    expect(screen.getByTestId("chat-mic")).toBeDisabled();
    // 发送:语音模式没有发送按钮,切回文字输入的按钮也被禁用(且在 inert 的页面里)
    expect(screen.queryByTestId("chat-send")).toBeNull();
    expect(screen.getByTestId("chat-mode-toggle")).toBeDisabled();
    expect(screen.getByTestId("chat-mode-toggle").closest("[inert]")).not.toBeNull();
    expect(screen.getByTestId("conversation-call")).toBeDisabled();
    await hangUp(c.ws());
    expect(screen.getByTestId("chat-mic").closest("[inert]")).toBeNull();
    await settle();
  });

  it("switching conversations mid-call hangs up and releases the microphone; the new conversation has no call", async () => {
    const c = callEnv();
    const { mock } = setupCall(callRoutes({
      "GET /api/conversations/c2": () => json({ id: "c2", name: "Other chat", config: CONFIG }),
      "GET /api/conversations/c2/messages": () => json({ messages: [{ id: "n0", conversation_id: "c2", role: "assistant", content: "Second chat hello" }] }),
    }), c.env);
    const ws = await connect(c);
    await act(async () => { goTo("/chat/c2"); });
    await screen.findByText("Second chat hello");
    expect(screen.queryByTestId("call-screen")).toBeNull();
    expect(ws.texts().at(-1)).toEqual({ type: "hangup" });
    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(c.stream.track.stop).toHaveBeenCalledTimes(1);
    expect(c.vad.destroy).toHaveBeenCalledTimes(1);
    expect(c.ctx.close).not.toHaveBeenCalled();
    await act(async () => {});
    expect(CallSocket.instances).toHaveLength(1);
    expect(callsTo(mock, "POST", "/api/realtime/ticket")).toHaveLength(1);
    expect(screen.getByTestId("chat-mic")).toBeEnabled();
  });

  it("unmounting the page mid-call hangs up and releases the microphone (StrictMode)", async () => {
    const c = callEnv();
    const { view, mock } = setupCall(callRoutes(), c.env, { strict: true });
    const ws = await connect(c);
    expect(callsTo(mock, "POST", "/api/realtime/ticket")).toHaveLength(1);
    view.unmount();
    expect(ws.texts().at(-1)).toEqual({ type: "hangup" });
    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(c.stream.track.stop).toHaveBeenCalledTimes(1);
    expect(c.vad.destroy).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-testid='call-screen']")).toBeNull();
  });
  describe("unsent local state and the post-call reload (review W5 I-2/I-3)", () => {
    let spy: MockInstance;
    beforeEach(() => { spy = vi.spyOn(toast, "error").mockImplementation(() => ""); });
    afterEach(() => spy.mockRestore());
    const NOT_SAVED = "The reply was shown but could not be saved.";
    const BLOCKED = "Send, retry or discard the unsent message first, then start the call.";
    const deletes = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.method === "DELETE");

    it("refuses to start a call while a voice pair whose save failed awaits Retry; nothing is deleted and Retry still saves it with its recording", async () => {
      const c = callEnv();
      let saves = 0;
      const { mock } = setupCall(callRoutes({
        "POST /api/ai/audio/transcriptions": () => json({ text: "I like apples" }),
        "POST /api/speech/assessments": () => json(ASSESSED),
        "POST /api/ai/chat/completions": () => sse([delta("Me too!"), DONE_EVENT]),
        // 非"可能已保存"的临时失败:旧的重新加载会 abandonOpen 并删除它的评测
        "POST /api/conversations/c1/messages": () => (++saves === 1 ? json({ error: "Slow down" }, 429) : json({ messages: [{ id: "m1" }, { id: "m2" }] })),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
        "DELETE /api/assessments/a1": () => json({ id: "a1" }),
      }), c.env, { recorderEnv: createFakeRecorderEnv().env });
      await screen.findByText("reply");
      await recordAndSend();
      await waitFor(() => expect(spy).toHaveBeenCalledWith(NOT_SAVED, expect.anything()));
      const retrySave = (spy.mock.calls.find((call) => call[0] === NOT_SAVED)![1] as { action: { onClick(): void } }).action;
      const button = screen.getByTestId("conversation-call");
      expect(button).toHaveAttribute("title", BLOCKED);
      await userEvent.click(button);
      expect(spy).toHaveBeenCalledWith(BLOCKED);
      expect(screen.queryByTestId("call-screen")).toBeNull();
      await act(async () => {});
      expect(callsTo(mock, "POST", "/api/realtime/ticket")).toHaveLength(0);
      expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(1);
      expect(deletes(mock)).toHaveLength(0);
      // 用户点 Retry:同一对带着评测保存,然后可以通话
      await act(async () => { retrySave.onClick(); });
      await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(2));
      expect(bodyOf(callsTo(mock, "POST", "/api/conversations/c1/messages")[1]).messages[0]).toMatchObject({ content: "I like apples", assessment_id: "a1" });
      await waitFor(() => expect(screen.getByTestId("conversation-call")).not.toHaveAttribute("title"));
      await connect(c);
      expect(deletes(mock)).toHaveLength(0);
    });

    it("clicking the call button while a save awaits Retry retries that save (the toast may be gone), then the call can start", async () => {
      const c = callEnv();
      let saves = 0;
      const { mock } = setupCall(callRoutes({
        "POST /api/ai/chat/completions": () => sse([delta("Fine"), DONE_EVENT]),
        "POST /api/conversations/c1/messages": () => (++saves === 1 ? json({ error: "Slow down" }, 429) : json({ messages: [{ id: "m1" }, { id: "m2" }] })),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      }), c.env);
      await screen.findByText("reply");
      await userEvent.type(await textMode(), "Hello there");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(spy).toHaveBeenCalledWith(NOT_SAVED, expect.anything()));
      await userEvent.click(screen.getByTestId("conversation-call"));
      expect(spy).toHaveBeenCalledWith(BLOCKED);
      expect(screen.queryByTestId("call-screen")).toBeNull();
      await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(2));
      await waitFor(() => expect(screen.getByTestId("conversation-call")).not.toHaveAttribute("title"));
      expect(callsTo(mock, "POST", "/api/realtime/ticket")).toHaveLength(0);
      await connect(c);
    });

    it("refuses to start a call while a failed reply awaits Retry, and allows it once the retry is saved", async () => {
      const c = callEnv();
      let attempt = 0;
      const { mock } = setupCall(callRoutes({
        "POST /api/ai/chat/completions": () => (++attempt === 1 ? sse(['data: {"error": "Upstream unavailable"}\n\n']) : sse([delta("Fine"), DONE_EVENT])),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
      }), c.env);
      await screen.findByText("reply");
      await userEvent.type(await textMode(), "Hello there");
      await userEvent.click(screen.getByTestId("chat-send"));
      await screen.findByTestId("message-retry");
      await userEvent.click(screen.getByTestId("conversation-call"));
      expect(spy).toHaveBeenCalledWith(BLOCKED);
      expect(screen.queryByTestId("call-screen")).toBeNull();
      await userEvent.click(screen.getByTestId("message-retry"));
      await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
      await connect(c);
    });

    it("a message typed and sent right after closing a call keeps its reply and its save when the call's grammar check finishes", async () => {
      const c = callEnv();
      const grammar = gate();
      const reply = gate();
      let loads = 0;
      const { mock } = setupCall(callRoutes({
        "GET /api/conversations/c1/messages": () => json({ messages: ++loads === 1 ? BEFORE_CALL : AFTER_CALL }),
        "POST /api/ai/grammar": async () => { await grammar.promise; return json(WRONG); },
        "PATCH /api/messages/cm1": () => json({ id: "cm1" }),
        "POST /api/ai/chat/completions": () => {
          const enc = new TextEncoder();
          return new Response(new ReadableStream({
            async start(ctl) { ctl.enqueue(enc.encode(delta("You are "))); await reply.promise; ctl.enqueue(enc.encode(delta("welcome") + DONE_EVENT)); ctl.close(); },
          }), { headers: { "Content-Type": "text/event-stream" } });
        },
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m5" }, { id: "m6" }] }),
      }), c.env);
      const ws = await connect(c);
      await oneCallTurn(ws);
      await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(1));
      await hangUp(ws);
      await screen.findByText("Oh, what does she like?");
      await settle();
      await userEvent.type(await textMode(), "Thanks");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("You are"));
      // 通话那句的语法结果在回复流式途中到达:不得触发重新加载(那会中止回复、丢掉保存)
      await act(async () => { grammar.release(); });
      await waitFor(() => expect(callsTo(mock, "PATCH", "/api/messages/cm1")).toHaveLength(1));
      await act(async () => { reply.release(); });
      await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
      expect(bodyOf(callsTo(mock, "POST", "/api/conversations/c1/messages")[0]).messages.map((m: { content: string }) => m.content))
        .toEqual(["Thanks", "You are welcome"]);
      expect(screen.getAllByTestId("message-user").at(-1)).toHaveTextContent("Thanks");
      expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("You are welcome");
      expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(3); // 重新加载 + 一次补取,之后不再加载
    });

    it("a hold recording started after closing a call is not cancelled when the call's grammar check finishes", async () => {
      const c = callEnv();
      const fake = createFakeRecorderEnv();
      const grammar = gate();
      let loads = 0;
      const { mock } = setupCall(callRoutes({
        "GET /api/conversations/c1/messages": () => json({ messages: ++loads === 1 ? BEFORE_CALL : AFTER_CALL }),
        "POST /api/ai/grammar": async () => { await grammar.promise; return json(WRONG); },
        "PATCH /api/messages/cm1": () => json({ id: "cm1" }),
      }), c.env, { recorderEnv: fake.env });
      const ws = await connect(c);
      await oneCallTurn(ws);
      await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(1));
      await hangUp(ws);
      await screen.findByText("Oh, what does she like?");
      await settle();
      await startRecording();
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording"));
      await act(async () => { grammar.release(); });
      await waitFor(() => expect(callsTo(mock, "PATCH", "/api/messages/cm1")).toHaveLength(1));
      await act(async () => {});
      expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording");
      expect(fake.track.stop).not.toHaveBeenCalled();
      expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(3);
    });

    it("never deletes a recording around a call: a voice turn still being scored when the call starts is linked to its message after the reload", async () => {
      const c = callEnv();
      const assessment = gate();
      let loads = 0;
      const { mock } = setupCall(callRoutes({
        "GET /api/conversations/c1/messages": () => json({ messages: ++loads === 1 ? BEFORE_CALL : AFTER_CALL }),
        "POST /api/ai/audio/transcriptions": () => json({ text: "I like apples" }),
        "POST /api/speech/assessments": async () => { await assessment.promise; return json(ASSESSED); },
        "POST /api/ai/chat/completions": () => sse([delta("Me too!"), DONE_EVENT]),
        "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
        "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: CONFIG }),
        "PATCH /api/messages/m1": () => json({ id: "m1" }),
        "DELETE /api/assessments/a1": () => json({ id: "a1" }),
      }), c.env, { recorderEnv: createFakeRecorderEnv().env });
      await screen.findByText("reply");
      await recordAndSend();
      await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
      const ws = await connect(c);
      await oneCallTurn(ws);
      await hangUp(ws);
      await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2));
      await act(async () => { assessment.release(); });
      await waitFor(() => expect(callsTo(mock, "PATCH", "/api/messages/m1")).toHaveLength(1));
      expect(bodyOf(callsTo(mock, "PATCH", "/api/messages/m1")[0])).toEqual({ assessment_id: "a1" });
      expect(deletes(mock)).toHaveLength(0);
    });
  });

  describe("the post-call reload waits for the server's writes (review F4 I-1)", () => {
    const SAID = { id: "cm1", conversation_id: "c1", role: "user", content: "She don't like coffee." };
    /** 挂断时正在说的回复:服务端在收到 hangup 之后才把说出的部分存为 "… …" */
    const CUT = { id: "cm2", conversation_id: "c1", role: "assistant", content: "Oh, what does she … …" };
    const SCORED = { ...SAID, assessment_id: "ca1",
      assessment: { id: "ca1", scores: { pronunciation_score: 71, accuracy_score: 70, fluency_score: 72, completeness_score: 90 }, words: [] as unknown[] } };
    const composerLocked = () => {
      expect(screen.getByTestId("chat-mic")).toBeDisabled();
      expect(screen.getByTestId("chat-hints")).toBeDisabled();
      expect(screen.getByTestId("conversation-call")).toBeDisabled();
    };

    it("keeps the socket open after the hang-up until the server closes it, releasing the microphone at once; the reply saved meanwhile appears after the reload", async () => {
      const c = callEnv();
      let loads = 0;
      const { mock } = setupCall(callRoutes({
        "GET /api/conversations/c1/messages": () => json({ messages: ++loads === 1 ? BEFORE_CALL : [...BEFORE_CALL, SAID, CUT] }),
        "POST /api/ai/grammar": () => json(WRONG),
        "PATCH /api/messages/cm1": () => json({ id: "cm1" }),
      }), c.env);
      const ws = await connect(c);
      await act(async () => {
        ws.server({ type: "transcript_final", text: SAID.content, message_id: "cm1" });
        ws.server({ type: "reply_delta", turn_id: 1, text: "Oh, what does she like?" });
      });
      await userEvent.click(screen.getByTestId("call-hangup"));
      expect(screen.queryByTestId("call-screen")).toBeNull();
      expect(ws.texts().at(-1)).toEqual({ type: "hangup" });
      expect(c.stream.track.stop).toHaveBeenCalledTimes(1);
      expect(c.vad.destroy).toHaveBeenCalledTimes(1);
      expect(ws.close).not.toHaveBeenCalled();
      await act(async () => {});
      // 服务端还没存完(还没关闭):不重新加载,输入与麦克风保持禁用
      expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(1);
      composerLocked();
      await act(async () => { ws.serverClose(1000); });
      await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2));
      expect(await screen.findByText("Oh, what does she … …")).toBeInTheDocument();
      expect(ws.close).not.toHaveBeenCalled();
    });

    it("fetches once more ~2 s after the reload: an assessment linked after the close shows its badge; the composer unlocks only then", async () => {
      const c = callEnv();
      let loads = 0;
      const { mock } = setupCall(callRoutes({
        "GET /api/conversations/c1/messages": () => {
          loads += 1;
          return json({ messages: loads === 1 ? BEFORE_CALL : loads === 2 ? [...BEFORE_CALL, SAID, CUT] : [...BEFORE_CALL, SCORED, CUT] });
        },
        "POST /api/ai/grammar": () => json(WRONG),
        "PATCH /api/messages/cm1": () => json({ id: "cm1" }),
      }), c.env);
      const ws = await connect(c);
      await act(async () => { ws.server({ type: "transcript_final", text: SAID.content, message_id: "cm1" }); });
      await userEvent.click(screen.getByTestId("call-hangup"));
      await act(async () => { ws.serverClose(1000); });
      await screen.findByText("Oh, what does she … …");
      expect(screen.queryByTestId("badge-pronunciation")).toBeNull();
      composerLocked();
      await advance(POST_CALL_FOLLOW_UP_MS + 100);
      await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(3));
      expect(await screen.findByTestId("badge-pronunciation")).toHaveTextContent("Pronunciation 71");
      // 合并按 id:同一条消息只有一个气泡,语法结果(按消息 id 补上的)仍在
      expect(screen.getAllByTestId("message-user")).toHaveLength(1);
      await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveTextContent("Grammar: 1 to fix"));
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toBeEnabled());
      expect(screen.getByTestId("conversation-call")).toBeEnabled();
      await advance(10_000);
      expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(3); // 只补取一次
    });

    it("an utterance the server saves while closing gets its grammar check and appears (also when it is the call's only turn)", async () => {
      const c = callEnv();
      let loads = 0;
      const LATE = { id: "cm3", conversation_id: "c1", role: "user", content: "He go to school every day." };
      const { mock } = setupCall(callRoutes({
        "GET /api/conversations/c1/messages": () => json({ messages: ++loads === 1 ? BEFORE_CALL : [...BEFORE_CALL, LATE] }),
        "POST /api/ai/grammar": () => json(WRONG),
        "PATCH /api/messages/cm3": () => json({ id: "cm3" }),
      }), c.env);
      const ws = await connect(c);
      await userEvent.click(screen.getByTestId("call-hangup"));
      await act(async () => { ws.server({ type: "transcript_final", text: LATE.content, message_id: "cm3" }); });
      await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/grammar")).toHaveLength(1));
      await act(async () => { ws.serverClose(1000); });
      await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2));
      expect(await screen.findByText(LATE.content)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId("badge-grammar")).toHaveTextContent("Grammar: 1 to fix"));
    });

    it("a call that connected reloads even if no turn reached the page (the server may have saved one while closing)", async () => {
      const c = callEnv();
      const { mock } = setupCall(callRoutes(), c.env);
      const ws = await connect(c);
      await userEvent.click(screen.getByTestId("call-hangup"));
      await act(async () => { ws.serverClose(1000); });
      await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2));
    });

    it("proceeds without the server's close after the bound and closes the socket itself", async () => {
      const c = callEnv();
      const { mock } = setupCall(callRoutes(), c.env);
      const ws = await connect(c);
      await act(async () => { ws.server({ type: "transcript_final", text: SAID.content, message_id: "cm1" }); });
      await userEvent.click(screen.getByTestId("call-hangup"));
      await advance(HANGUP_CLOSE_WAIT_MS - 200);
      expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(1);
      expect(ws.close).not.toHaveBeenCalled();
      await advance(300);
      expect(ws.close).toHaveBeenCalledWith(1000);
      await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2));
    });

    it("the composer unlocks after at most the bound even when the follow-up fetch hangs", async () => {
      const c = callEnv();
      let loads = 0;
      const { mock } = setupCall(callRoutes({
        "GET /api/conversations/c1/messages": () => (++loads <= 2 ? json({ messages: BEFORE_CALL }) : new Promise<Response>(() => undefined)),
      }), c.env);
      const ws = await connect(c);
      await userEvent.click(screen.getByTestId("call-hangup"));
      await act(async () => { ws.serverClose(1000); });
      await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2));
      await advance(POST_CALL_FOLLOW_UP_MS + 100);
      await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(3));
      composerLocked();
      await advance(POST_CALL_SETTLE_MAX_MS);
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toBeEnabled());
      expect(POST_CALL_SETTLE_MAX_MS).toBeLessThanOrEqual(6000);
    });

    it("switching conversations while waiting for the close drops the socket and never reloads the old conversation", async () => {
      const c = callEnv();
      const { mock } = setupCall(callRoutes({
        "GET /api/conversations/c2": () => json({ id: "c2", name: "Other chat", config: CONFIG }),
        "GET /api/conversations/c2/messages": () => json({ messages: [{ id: "n0", conversation_id: "c2", role: "assistant", content: "Second chat hello" }] }),
      }), c.env);
      const ws = await connect(c);
      await act(async () => { ws.server({ type: "transcript_final", text: SAID.content, message_id: "cm1" }); });
      await userEvent.click(screen.getByTestId("call-hangup"));
      await act(async () => { goTo("/chat/c2"); });
      await screen.findByText("Second chat hello");
      expect(ws.close).toHaveBeenCalledTimes(1);
      await advance(POST_CALL_SETTLE_MAX_MS + 1000);
      expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(1);
      expect(callsTo(mock, "GET", "/api/conversations/c2/messages")).toHaveLength(1);
      expect(screen.getByTestId("chat-mic")).toBeEnabled();
    });

    it("returns focus to the call button once it is enabled again after the call (review F2 m12)", async () => {
      const c = callEnv();
      setupCall(callRoutes(), c.env);
      const ws = await connect(c);
      expect(screen.getByTestId("call-hangup")).toHaveFocus();
      await userEvent.click(screen.getByTestId("call-hangup"));
      await act(async () => { ws.serverClose(1000); });
      await advance(POST_CALL_FOLLOW_UP_MS + 100);
      await waitFor(() => expect(screen.getByTestId("conversation-call")).toBeEnabled());
      await waitFor(() => expect(screen.getByTestId("conversation-call")).toHaveFocus());
    });

    it("a refused call returns focus to the call button too", async () => {
      const c = callEnv();
      setupCall(callRoutes({ "POST /api/realtime/ticket": () => json({ error: "Realtime is not enabled" }, 503) }), c.env);
      await userEvent.click(await screen.findByTestId("conversation-call"));
      await userEvent.click(await screen.findByTestId("call-close"));
      await waitFor(() => expect(screen.getByTestId("conversation-call")).toHaveFocus());
    });

    it("focus the user moved elsewhere while the call settles is left alone", async () => {
      localStorage.setItem(COMPOSER_MODE_KEY, "text"); // 收尾期间打字:从文字模式开始
      const c = callEnv();
      setupCall(callRoutes(), c.env);
      const ws = await connect(c);
      await userEvent.click(screen.getByTestId("call-hangup"));
      await act(async () => { ws.serverClose(1000); });
      act(() => screen.getByTestId("chat-input").focus()); // 收尾期间可以先打字
      await advance(POST_CALL_FOLLOW_UP_MS + 100);
      await waitFor(() => expect(screen.getByTestId("conversation-call")).toBeEnabled());
      await advance(50);
      expect(screen.getByTestId("chat-input")).toHaveFocus();
    });

    it("unmounting the page while waiting for the close drops the socket", async () => {
      const c = callEnv();
      const { view } = setupCall(callRoutes(), c.env);
      const ws = await connect(c);
      await userEvent.click(screen.getByTestId("call-hangup"));
      expect(ws.close).not.toHaveBeenCalled();
      view.unmount();
      expect(ws.close).toHaveBeenCalledTimes(1);
    });

    it("a call closed by the server reloads with the same follow-up when the end screen is closed", async () => {
      const c = callEnv();
      let loads = 0;
      const { mock } = setupCall(callRoutes({
        "GET /api/conversations/c1/messages": () => {
          loads += 1;
          return json({ messages: loads === 1 ? BEFORE_CALL : loads === 2 ? [...BEFORE_CALL, SAID] : [...BEFORE_CALL, SCORED] });
        },
        "POST /api/ai/grammar": () => json(WRONG),
        "PATCH /api/messages/cm1": () => json({ id: "cm1" }),
      }), c.env);
      const ws = await connect(c);
      await act(async () => { ws.server({ type: "transcript_final", text: SAID.content, message_id: "cm1" }); });
      await act(async () => { ws.serverClose(4008); });
      await userEvent.click(await screen.findByTestId("call-close"));
      await waitFor(() => expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(2));
      composerLocked();
      await advance(POST_CALL_FOLLOW_UP_MS + 100);
      expect(await screen.findByTestId("badge-pronunciation")).toHaveTextContent("Pronunciation 71");
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toBeEnabled());
    });
  });

  it("refuses early with 'invalid voice' when the server AI config failed to load and the conversation reads aloud with another provider", async () => {
    const spy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const c = callEnv();
    const { mock } = setupCall(callRoutes({
      "GET /api/config/tts_providers_v2": () => json({ error: "boom" }, 500),
    }), c.env);
    await userEvent.click(await screen.findByTestId("conversation-call"));
    expect(spy).toHaveBeenCalledWith("This conversation's voice can't be used for calls. Choose another voice in the conversation settings.");
    expect(screen.queryByTestId("call-screen")).toBeNull();
    await act(async () => {});
    expect(callsTo(mock, "POST", "/api/realtime/ticket")).toHaveLength(0);
    spy.mockRestore();
  });
});
