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
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ConversationPage } from "./conversation-page";

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
    ...extra,
  };
}

let goTo: (path: string) => void = () => {};
function NavProbe(): null {
  goTo = useNavigate();
  return null;
}

function setup(r: Record<string, Handler>, recorderEnv?: ReturnType<typeof createFakeRecorderEnv>["env"], opts: { strict?: boolean } = {}) {
  const mock = createFetchMock(r);
  const page = <><ConversationPage recorderEnv={recorderEnv} /><NavProbe /></>;
  const view = renderWithProviders(opts.strict ? <StrictMode>{page}</StrictMode> : page, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: "/chat/c1",
    path: "/chat/:id",
  });
  return { mock, view };
}

const ASSESSED = {
  pronunciation_score: 82, accuracy_score: 80, fluency_score: 85, completeness_score: 90, assessment_id: "a1",
  detail_result: { display: "", words: [{ word: "like", pronunciation_assessment: { accuracy_score: 40, error_type: "Mispronunciation" } }] },
};
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}
async function recordAndSend() {
  await userEvent.click(await screen.findByTestId("chat-mic"));
  expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording");
  await userEvent.click(screen.getByTestId("chat-mic"));
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
  beforeEach(() => resetServerAiConfigCache());

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
    await userEvent.type(screen.getByTestId("chat-input"), "Hi");
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
    await userEvent.type(screen.getByTestId("chat-input"), "Hi");
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
    await userEvent.click(screen.getByTestId("conversation-settings"));
    await waitFor(() => expect(screen.getByTestId("settings-tts-voice").querySelectorAll("option")).toHaveLength(2));
    await userEvent.selectOptions(screen.getByTestId("settings-tts-voice"), "echo");
    await userEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.method === "PATCH")!.body as string).config).toMatchObject({ tts_voice: "echo", system_prompt: "SYS" });
  });

  it("persists the grammar check and coach mode switches as snake_case config keys", async () => {
    const { mock } = setup(routes({ "PATCH /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: { ...CONFIG, grammar_check: false, coach_mode: true } }) }));
    await screen.findByText("reply");
    await userEvent.click(screen.getByTestId("conversation-settings"));
    await userEvent.click(screen.getByTestId("settings-grammar-check"));
    await userEvent.click(screen.getByTestId("settings-coach-mode"));
    await userEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.method === "PATCH")!.body as string).config).toMatchObject({ grammar_check: false, coach_mode: true, system_prompt: "SYS" });
  });

  it("discards a partially streamed reply on failure: error bubble replaces it, nothing is saved", async () => {
    const { mock } = setup(routes({
      "POST /api/ai/chat/completions": () => sse([delta("Half an ans"), 'data: {"error": "Upstream unavailable"}\n\n']),
    }));
    await screen.findByText("reply");
    await userEvent.type(screen.getByTestId("chat-input"), "Hi");
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
    await userEvent.type(screen.getByTestId("chat-input"), "Hi");
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
    await userEvent.type(screen.getByTestId("chat-input"), "Hi");
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
    await userEvent.type(screen.getByTestId("chat-input"), "Hi");
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
    await userEvent.type(screen.getByTestId("chat-input"), "Failed one");
    await userEvent.click(screen.getByTestId("chat-send"));
    await screen.findByTestId("message-retry");
    await userEvent.type(screen.getByTestId("chat-input"), "Next");
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
    await userEvent.type(screen.getByTestId("chat-input"), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByText("The AI returned an empty reply.")).toBeInTheDocument();
    expect(posted(mock)).toHaveLength(0);
  });

  it("keeps the settings sheet open when saving fails", async () => {
    const { mock } = setup(routes({ "PATCH /api/conversations/c1": () => json({ error: "boom" }, 500) }));
    await screen.findByText("reply");
    await userEvent.click(screen.getByTestId("conversation-settings"));
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
      await userEvent.type(screen.getByTestId("chat-input"), "Hi");
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
      await userEvent.type(screen.getByTestId("chat-input"), "Hi");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hello"));
      await waitFor(() => expect(screen.getByTestId("chat-send")).toBeDisabled()); // input emptied; sending finished
      await userEvent.type(screen.getByTestId("chat-input"), "Again");
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
    beforeEach(() => {
      indexedDB.deleteDatabase("enjoy-web");
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
      expect(screen.getByTestId("conversation-bilingual")).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByTestId("message-translation")).toBeNull(); // 不补译旧消息
      await userEvent.type(screen.getByTestId("chat-input"), "Hi");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getAllByTestId("message-translation")).toHaveLength(1));
      expect(calls).toEqual(["New reply"].map((s) => expect.stringContaining(s)));
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
      const toggle = screen.getByTestId("conversation-bilingual");
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
      await userEvent.click(screen.getByTestId("conversation-bilingual"));
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
      const before = mock.calls.length;
      await userEvent.click(screen.getByTestId("chat-mic"));
      expect(screen.getByTestId("voice-timer")).toHaveTextContent("00:00 / 01:00");
      expect(screen.queryByTestId("chat-input")).toBeNull(); // 录音时输入框让位给计时条
      await userEvent.click(screen.getByTestId("chat-mic-cancel"));
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle"));
      expect(fake.track.stop).toHaveBeenCalled();
      expect(mock.calls.length).toBe(before);
      expect(screen.queryAllByTestId("message-user")).toHaveLength(0);
    });

    it("cancel during transcription aborts it, removes the draft bubble and sends nothing", async () => {
      let aborted = false;
      const { mock } = setup(voiceRoutes({ "POST /api/ai/audio/transcriptions": hang(() => { aborted = true; }) }), createFakeRecorderEnv().env);
      await screen.findByText("reply");
      await recordAndSend();
      expect(await screen.findByTestId("voice-transcribing")).toBeInTheDocument();
      expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "processing");
      expect(screen.getByTestId("chat-input")).toBeDisabled(); // R19:转写中不能打字
      expect(screen.getByTestId("chat-send")).toBeDisabled();
      await userEvent.click(screen.getByTestId("chat-mic-cancel"));
      await waitFor(() => expect(aborted).toBe(true));
      await waitFor(() => expect(screen.queryAllByTestId("message-user")).toHaveLength(0));
      expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
      expect(screen.getByTestId("chat-input")).toBeEnabled();
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
      await userEvent.type(screen.getByTestId("chat-input"), "Typed instead");
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
      await userEvent.type(screen.getByTestId("chat-input"), "Something else");
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
      await userEvent.type(screen.getByTestId("chat-input"), "Something else");
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
      await userEvent.type(screen.getByTestId("chat-input"), "Hi");
      await userEvent.click(screen.getByTestId("chat-send"));
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toBeDisabled());
      await act(async () => { reply.release(); });
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toBeEnabled());
      await userEvent.click(screen.getByTestId("chat-mic"));
      expect(screen.getByTestId("chat-send")).toBeDisabled();
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
      it("sends a kept recording on request", async () => {
        const fake = createFakeRecorderEnv();
        const { mock } = setup(voiceRoutes(), fake.env);
        await screen.findByText("reply");
        await userEvent.click(screen.getByTestId("chat-mic"));
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
        await userEvent.click(screen.getByTestId("chat-mic"));
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
        await userEvent.type(screen.getByTestId("chat-input"), "One");
        await userEvent.click(screen.getByTestId("chat-send"));
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        await userEvent.type(screen.getByTestId("chat-input"), "Two");
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
        await userEvent.type(screen.getByTestId("chat-input"), "Typed");
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
          await userEvent.type(screen.getByTestId("chat-input"), "Next");
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
        await userEvent.type(screen.getByTestId("chat-input"), text);
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

      it("an ambiguous failure where nothing was stored reloads first and then posts", async () => {
        let attempt = 0;
        const { mock } = setup(routes({
          "POST /api/ai/chat/completions": () => sse([delta("Reply"), DONE_EVENT]),
          "POST /api/conversations/c1/messages": () => (++attempt === 1 ? lose() : SAVE_OK()),
          "PATCH /api/conversations/c1": RENAME,
        }));
        await screen.findByText("reply");
        await userEvent.type(screen.getByTestId("chat-input"), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await waitFor(() => expect(notSavedToasts(spy)).toHaveLength(1));
        const before = callsTo(mock, "GET", "/api/conversations/c1/messages").length;
        await act(async () => { lastToastAction(spy).onClick(); });
        await waitFor(() => expect(msgPosts(mock)).toHaveLength(2));
        expect(callsTo(mock, "GET", "/api/conversations/c1/messages")).toHaveLength(before + 1);
        expect(bodyOf(msgPosts(mock)[1]).messages[0].content).toBe("Typed");
      });

      it("a definite rejection is not treated as ambiguous: no reload before the retry", async () => {
        let attempt = 0;
        const { mock } = setup(routes({
          "POST /api/ai/chat/completions": () => sse([delta("Reply"), DONE_EVENT]),
          "POST /api/conversations/c1/messages": () => (++attempt === 1 ? json({ error: "Too many requests, please try again later" }, 429) : SAVE_OK()),
          "PATCH /api/conversations/c1": RENAME,
        }));
        await screen.findByText("reply");
        await userEvent.type(screen.getByTestId("chat-input"), "Typed");
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
        await userEvent.type(screen.getByTestId("chat-input"), "Typed");
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
        await userEvent.type(screen.getByTestId("chat-input"), "Typed");
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
        await userEvent.type(screen.getByTestId("chat-input"), "Typed");
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
        await userEvent.type(screen.getByTestId("chat-input"), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await screen.findByTestId("message-retry");
        await userEvent.click(screen.getByTestId("chat-mic"));
        expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording");
        expect(screen.queryByTestId("message-retry")).toBeNull();
        await userEvent.click(screen.getByTestId("chat-mic-cancel"));
        expect(await screen.findByTestId("message-retry")).toBeInTheDocument();
      });

      it("keeps a transcript that arrives while a retry streams as a draft the user can send or discard", async () => {
        const { second, handlers } = failingThenGated();
        const { mock } = setup(handlers, createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await userEvent.type(screen.getByTestId("chat-input"), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await screen.findByTestId("message-retry");
        // 同一帧里点了录音和重试:两个点击都发生在重新渲染之前
        act(() => {
          fireEvent.click(screen.getByTestId("chat-mic"));
          fireEvent.click(screen.getByTestId("message-retry"));
        });
        await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording"));
        await userEvent.click(screen.getByTestId("chat-mic")); // 停止并发送
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

      it("a held transcript can be discarded", async () => {
        const { second, handlers } = failingThenGated();
        setup(handlers, createFakeRecorderEnv().env);
        await screen.findByText("reply");
        await userEvent.type(screen.getByTestId("chat-input"), "Typed");
        await userEvent.click(screen.getByTestId("chat-send"));
        await screen.findByTestId("message-retry");
        act(() => {
          fireEvent.click(screen.getByTestId("chat-mic"));
          fireEvent.click(screen.getByTestId("message-retry"));
        });
        await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording"));
        await userEvent.click(screen.getByTestId("chat-mic"));
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
      await userEvent.click(screen.getByTestId("chat-mic"));
      await waitFor(() => expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "idle"));
      expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording");
      await userEvent.click(screen.getByTestId("chat-mic-cancel"));
      await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle"));
      // 焦点已释放:再次朗读正常
      await userEvent.click(screen.getByTestId("message-tts"));
      await waitFor(() => expect(screen.getByTestId("message-tts")).toHaveAttribute("data-state", "playing"));
    });

    describe("leaving the page", () => {
      it("releases the microphone when the page unmounts mid-recording", async () => {
        const fake = createFakeRecorderEnv();
        const { view } = setup(routes(), fake.env);
        await screen.findByText("reply");
        await userEvent.click(screen.getByTestId("chat-mic"));
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
        await userEvent.click(screen.getByTestId("chat-mic"));
        await act(async () => { goTo("/chat/c2"); });
        await screen.findByText("Second chat hello");
        expect(fake.track.stop).toHaveBeenCalled();
        expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
        expect(screen.getByTestId("chat-input")).toBeInTheDocument();
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
        await userEvent.click(screen.getByTestId("chat-mic"));
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
});
