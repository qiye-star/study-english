import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
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

function setup(r: Record<string, Handler>, recorderEnv?: ReturnType<typeof createFakeRecorderEnv>["env"]) {
  const mock = createFetchMock(r);
  const view = renderWithProviders(<ConversationPage recorderEnv={recorderEnv} />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: "/chat/c1",
    path: "/chat/:id",
  });
  return { mock, view };
}

const posted = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname.endsWith("/messages") && c.method === "POST");

describe("ConversationPage", () => {
  beforeEach(() => resetServerAiConfigCache());

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

  it("puts the transcription into the input without sending it", async () => {
    const { mock } = setup(routes({
      "POST /api/ai/audio/transcriptions": () => json({ text: "spoken words" }),
    }), createFakeRecorderEnv().env);
    await screen.findByText("reply");
    await userEvent.click(screen.getByTestId("chat-mic"));
    await userEvent.click(screen.getByTestId("chat-mic"));
    await waitFor(() => expect(screen.getByTestId("chat-input")).toHaveValue("spoken words"));
    expect(mock.calls.some((c) => c.url.pathname === "/api/ai/chat/completions")).toBe(false);
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
});
