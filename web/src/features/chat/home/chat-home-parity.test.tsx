import "fake-indexeddb/auto";
import { configure, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import type { ChromeCtl } from "../conversation-chrome";
import { homeChrome } from "./home-chrome";
import { resetChatHomeStore } from "./chat-home-store";
import { ChatRoutesHarness, chatHomeRoutes } from "./test-routes";

// 现有语言对话能力在新外框里的对照(计划 §4 P-3 … P-12):同一个 ConversationPage,按 testid 逐项走一遍。
configure({ asyncUtilTimeout: 5000 });

const CFG = { system_prompt: "SYS", model: "gpt-4o", temperature: 0.7, tts_model: "openai/tts-1", tts_voice: "alloy" };
const sse = (parts: string[]) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
};
const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:tts"), revokeObjectURL: vi.fn() });
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});
beforeEach(() => { resetServerAiConfigCache(); resetChatHomeStore(); localStorage.clear(); });
afterEach(async () => { resetChatHomeStore(); localStorage.clear(); await i18n.changeLanguage("en"); });

function setup(extra: Record<string, Handler> = {}, language = "zh-CN") {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language })); // 非英文界面:双语翻译行才显示
  const mock = createFetchMock(chatHomeRoutes({
    "GET /api/conversations/c1": () => json({ id: "c1", name: "Trip", config: CFG }),
    "GET /api/realtime/config": () => json({ enabled: true, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 }),
    ...extra,
  }));
  renderWithProviders(<ChatRoutesHarness />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1", path: "*" });
  return mock;
}
const callsTo = (mock: ReturnType<typeof createFetchMock>, method: string, path: string) =>
  mock.calls.filter((c) => c.method === method && c.url.pathname === path);
const patchBody = (mock: ReturnType<typeof createFetchMock>) => JSON.parse(String(mock.calls.filter((c) => c.method === "PATCH" && c.url.pathname === "/api/conversations/c1").at(-1)!.body));

async function openSheet() {
  await screen.findByText("Where to?");
  await userEvent.click(screen.getByTestId("chat-settings-open"));
  return screen.findByTestId("chat-settings-sheet");
}

describe("the new chrome keeps every conversation capability", () => {
  it("P-3: sends a text message, streams the reply, saves the pair and names the chat", async () => {
    const mock = setup({
      "GET /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: CFG }),
      "POST /api/ai/chat/completions": () => sse([delta("Hello "), delta("there!"), "data: [DONE]\n\n"]),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1", role: "user", content: "Hi" }, { id: "m2", role: "assistant", content: "Hello there!" }] }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: CFG }),
    });
    await screen.findByText("Where to?");
    await userEvent.type(await screen.findByTestId("chat-input"), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hello there!"));
    await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
    expect(JSON.parse(String(callsTo(mock, "POST", "/api/conversations/c1/messages")[0].body))).toEqual({ messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello there!" }] });
    await waitFor(() => expect(patchBody(mock)).toEqual({ name: "Hi" }));
  });

  it("P-3: a failed reply offers retry on the same bubble", async () => {
    setup({ "POST /api/ai/chat/completions": () => json({ error: "boom" }, 500) });
    await screen.findByText("Where to?");
    await userEvent.type(await screen.findByTestId("chat-input"), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByTestId("message-retry")).toBeInTheDocument();
  });

  it("P-9: the settings sheet holds the three option rows with the old test ids; bilingual writes only its key", async () => {
    const mock = setup({ "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Trip", config: { ...CFG, bilingual: true } }) });
    const sheet = await openSheet();
    for (const id of ["conversation-bilingual", "conversation-autospeak", "conversation-speed", "conversation-recap", "conversation-settings"]) {
      expect(sheet.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
    expect(screen.queryByTestId("conversation-options")).toBeNull(); // the classic popover is not in this chrome
    await waitFor(() => expect(screen.getByTestId("conversation-bilingual")).toBeEnabled());
    await userEvent.click(screen.getByTestId("conversation-bilingual"));
    await waitFor(() => expect(callsTo(mock, "PATCH", "/api/conversations/c1")).toHaveLength(1));
    expect(patchBody(mock).config.bilingual).toBe(true);
  });

  it("P-6: more conversation settings opens the original settings sheet", async () => {
    setup();
    await openSheet();
    await waitFor(() => expect(screen.getByTestId("conversation-settings")).toBeEnabled());
    await userEvent.click(screen.getByTestId("conversation-settings"));
    expect(await screen.findByTestId("settings-model")).toBeInTheDocument();
  });

  it("P-11: the recap row opens the recap sheet", async () => {
    setup();
    await openSheet();
    await waitFor(() => expect(screen.getByTestId("conversation-recap")).toBeEnabled());
    await userEvent.click(screen.getByTestId("conversation-recap"));
    expect(await screen.findByTestId("recap-sheet")).toBeInTheDocument();
  });

  it("P-7 / P-10: the composer keeps the keyboard-voice toggle and the hints entry", async () => {
    setup();
    await screen.findByText("Where to?");
    expect(await screen.findByTestId("chat-mode-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("chat-hints")).toBeInTheDocument();
  });

  it("assistant bubbles keep listen / practice (and lookup context)", async () => {
    setup();
    const bubble = (await screen.findByText("Where to?")).closest("[data-testid=message-assistant]") as HTMLElement;
    expect(bubble.querySelector('[data-testid="message-tts"]')).not.toBeNull();
    expect(bubble.querySelector('[data-testid="message-practice"]')).not.toBeNull();
    expect(bubble.querySelector("[data-lookup-context]")).not.toBeNull();
  });

  it("P-12: the call button sits in the new top bar with the same test id", async () => {
    setup();
    await screen.findByText("Where to?");
    // jsdom has no AudioContext, so the page itself hides the button; its rendering is checked on the chrome directly below
    expect(screen.queryByTestId("conversation-call")).toBeNull();
  });
});

describe("home chrome call button (same gating as the classic top bar)", () => {
  const ctl = (over: Partial<ChromeCtl["callState"]>) => ({
    conversation: { id: "c1", name: "x", config: {}, createdAt: "", updatedAt: "" }, personaName: null, busy: { any: false },
    startCall: vi.fn(), choosePersona: vi.fn(), reportPersona: vi.fn(), reportAgentsOff: vi.fn(),
    toggles: { canTranslate: false, bilingual: false, autoSpeak: false, loaded: true, bilingualSaving: false, autoSpeakSaving: false },
    callState: { canCall: true, callDisabled: false, callButtonRef: createRef<HTMLButtonElement>(), ...over },
  }) as unknown as ChromeCtl;
  const chrome = () => homeChrome({ t: i18n.t.bind(i18n) as never, lang: "en", todayId: null, historyOpen: false, onOpenHistory: vi.fn(), historyButtonRef: createRef(), settingsOpen: false, onSettingsOpenChange: vi.fn() });

  it("renders the button next to settings; blocked state is dimmed, explained and still clickable text-wise", () => {
    const c = ctl({ callBlockedReason: "Send or retry first" });
    const first = renderWithProviders(<>{chrome().renderActions(c)}</>);
    const call = screen.getByTestId("conversation-call");
    expect(call).toHaveAttribute("data-blocked", "true");
    expect(call).toHaveAttribute("title", "Send or retry first");
    expect(call).toHaveAttribute("aria-describedby", "conversation-call-blocked");
    first.unmount();
    renderWithProviders(<>{chrome().renderActions(ctl({ canCall: false }))}</>);
    expect(screen.queryByTestId("conversation-call")).toBeNull();
    expect(screen.getByTestId("chat-settings-open")).toBeInTheDocument();
  });

  it("the button is the ref target the page focuses after a call ends", () => {
    const c = ctl({});
    renderWithProviders(<>{chrome().renderActions(c)}</>);
    expect(c.callState.callButtonRef.current).toBe(screen.getByTestId("conversation-call"));
  });
});
