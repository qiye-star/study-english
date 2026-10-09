import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ROOM } from "./room-fixtures";
import { RoomPage } from "./room-page";

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  static count = 0;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) { FakeWebSocket.last = this; FakeWebSocket.count += 1; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  push(e: object) { act(() => this.onmessage?.({ data: JSON.stringify(e) })); }
  drop(code: number) { act(() => { this.readyState = 3; this.onclose?.({ code }); }); }
}

const user = (seq: number, text: string, over = {}) => ({ seq, id: `m${seq}`, lane: "public", kind: "text", sender: { kind: "user", id: 22, name: "bob" },
  text, assisted: false, reply_to: null as number | null, ai_status: null as string | null, meta: null as unknown, created_at: "2026-10-09T09:00:00+00:00",
  quote: null as unknown, voice: null as unknown, reactions: [] as unknown[], ...over });
const V2_CONFIG = { enabled: true, ai_available: true, max_members: 8, max_text: 500, scenarios: [{ key: "free", title_zh: "自由聊天", title_en: "Free talk" }],
  levels: ["A1", "A2", "B1", "B2", "C1"], default_max_members: 4, name_max: 30, voice_available: false, max_voice_ms: 60000,
  summary_available: false, reactions: ["like", "love", "haha", "wow", "clap", "thanks"] };
const MEMBERS = [{ user_id: 11111111, name: "alice", role: "owner", online: true }, { user_id: 22, name: "bob", role: "member", online: true }];

function setup(routes: Record<string, Handler> = {}) {
  const mock = createFetchMock({
    "GET /api/rooms/config": () => json({ enabled: true, ai_available: true, max_members: 8, max_text: 500 }),
    "POST /api/rooms/r1/ticket": () => json({ ticket: "secret-ticket", expires_in: 60 }),
    ...routes,
  });
  renderWithProviders(<RoomPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rooms/r/r1", path: "/rooms/r/:roomId",
    user: { id: "11111111", name: "alice" } });
  return mock;
}

async function live(room: object = ROOM) {
  await waitFor(() => expect(FakeWebSocket.last?.sent[0]).toBe('{"type":"hello","last_seq":0,"v":2}'));
  FakeWebSocket.last!.push({ type: "welcome", room, me: { user_id: 11111111, role: "owner" },
    members: MEMBERS, last_seq: 0, truncated: false, assist_history: [] });
}

describe("RoomPage", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    FakeWebSocket.last = null;
    FakeWebSocket.count = 0;
    localStorage.removeItem("enjoy-web.settings");
    await i18n.changeLanguage("en");
  });

  it("connects with a ticket, renders messages and sends", async () => {
    setup();
    await live();
    expect(FakeWebSocket.last!.url).toContain("/api/rooms/ws?ticket=secret-ticket");
    expect(document.body.textContent).not.toContain("secret-ticket");
    expect(screen.getByText(/房间 482 913/).textContent).toContain("2 人在线");
    FakeWebSocket.last!.push({ type: "message", message: user(1, "joined", { kind: "system", sender: { kind: "system", id: null, name: null }, meta: { name: "bob" } }) });
    FakeWebSocket.last!.push({ type: "message", message: user(2, "I like chocolate.", { assisted: true }) });
    expect(screen.getByText("bob 加入了房间")).toBeTruthy();
    expect(screen.getByText("助手润色")).toBeTruthy();
    fireEvent.change(screen.getByTestId("room-input"), { target: { value: "Me too!" } });
    fireEvent.click(screen.getByTestId("room-send"));
    const say = JSON.parse(FakeWebSocket.last!.sent.at(-1)!);
    expect(say).toMatchObject({ type: "say", text: "Me too!", assist_id: null });
    expect((screen.getByTestId("room-input") as HTMLInputElement).value).toBe("");
    FakeWebSocket.last!.push({ type: "ack", client_id: say.client_id, seq: 3 });
    FakeWebSocket.last!.push({ type: "message", message: user(3, "Me too!", { sender: { kind: "user", id: 11111111, name: "alice" } }) });
    const mine = screen.getAllByTestId("room-message").filter((m) => m.dataset.mine === "true");
    expect(mine.map((m) => m.textContent)).toEqual(["Me too!"]);
  });

  it("prefills @ai and shows the AI typing state and answer", async () => {
    setup();
    await live();
    fireEvent.click(screen.getByTestId("room-at-ai"));
    expect((screen.getByTestId("room-input") as HTMLInputElement).value).toBe("@ai ");
    FakeWebSocket.last!.push({ type: "message", message: user(3, "@ai what does break the ice mean?", { ai_status: "pending" }) });
    FakeWebSocket.last!.push({ type: "ai_typing", reply_to: 3 });
    expect(screen.getByText("AI 助手正在输入…")).toBeTruthy();
    FakeWebSocket.last!.push({ type: "message", message: user(4, "It means starting a conversation.\n中文:打破僵局。", { kind: "ai_answer", sender: { kind: "ai", id: null, name: null }, reply_to: 3 }) });
    const ai = screen.getAllByTestId("room-message").find((m) => m.dataset.kind === "ai_answer")!;
    expect(ai.textContent).toContain("AI 助手");
    expect(ai.textContent).toContain("bob: @ai what does break the ice mean?");
    expect(within(ai).getByText("中文:打破僵局。")).toBeTruthy();
    expect(screen.queryByText("AI 助手正在输入…")).toBeNull();
  });

  it("shows notices and the closed state", async () => {
    setup();
    await live();
    FakeWebSocket.last!.push({ type: "notice", code: "ai_off" });
    expect(screen.getByText("房主关闭了 AI 公开回答,可以用助手私聊")).toBeTruthy();
    FakeWebSocket.last!.push({ type: "closed", reason: "owner" });
    expect(screen.getByText("房主结束了房间")).toBeTruthy();
    expect((screen.getByTestId("room-input") as HTMLInputElement).disabled).toBe(true);
  });

  it("shows a reconnecting banner and resumes from the last seq", async () => {
    setup();
    await live();
    FakeWebSocket.last!.push({ type: "message", message: user(5, "hello") });
    FakeWebSocket.last!.drop(1012);
    expect(screen.getByText("连接中断,正在重连…")).toBeTruthy();
    await waitFor(() => expect(FakeWebSocket.count).toBe(2), { timeout: 3000 });
    await waitFor(() => expect(FakeWebSocket.last!.sent[0]).toBe('{"type":"hello","last_seq":5,"v":2}'));
  });

  it("resends an unacknowledged message after a reconnect with the same client id and shows it once", async () => {
    setup();
    await live();
    fireEvent.change(screen.getByTestId("room-input"), { target: { value: "Are you there?" } });
    fireEvent.click(screen.getByTestId("room-send"));
    const first = FakeWebSocket.last!;
    const say = JSON.parse(first.sent.at(-1)!);
    first.drop(1006); // dropped before the ack
    expect((screen.getByTestId("room-send") as HTMLButtonElement).disabled).toBe(true); // nothing can be sent while reconnecting
    await waitFor(() => expect(FakeWebSocket.count).toBe(2), { timeout: 3000 });
    await waitFor(() => expect(FakeWebSocket.last!.sent[0]).toBe('{"type":"hello","last_seq":0,"v":2}'));
    FakeWebSocket.last!.push({ type: "welcome", room: ROOM, me: { user_id: 11111111, role: "owner" }, members: MEMBERS, last_seq: 4, truncated: false, assist_history: [] });
    const resent = FakeWebSocket.last!.sent.map((f) => JSON.parse(f)).filter((f) => f.type === "say");
    expect(resent).toEqual([say]);
    // the server had stored it: the replay carries the real message, then the dedup ack
    FakeWebSocket.last!.push({ type: "message", message: user(4, "Are you there?", { sender: { kind: "user", id: 11111111, name: "alice" } }) });
    FakeWebSocket.last!.push({ type: "ack", client_id: say.client_id, seq: 4 });
    expect(screen.getAllByText("Are you there?")).toHaveLength(1);
    expect(screen.queryByTestId("room-pending")).toBeNull();
  });

  it("announces only live messages from others, not the whole list", async () => {
    setup();
    await live();
    expect(screen.getByTestId("room-messages").getAttribute("aria-live")).toBeNull();
    FakeWebSocket.last!.push({ type: "message", message: user(2, "Hi there") });
    expect(screen.getByTestId("room-announcer").textContent).toBe("bob: Hi there");
    FakeWebSocket.last!.push({ type: "message", message: user(3, "Mine", { sender: { kind: "user", id: 11111111, name: "alice" } }) });
    expect(screen.getByTestId("room-announcer").textContent).toBe("bob: Hi there");
  });

  it("a member removed from the room sees that, not 'not found'", async () => {
    setup({ "POST /api/rooms/r1/ticket": () => json({ error: "Removed from room" }, 403) });
    expect(await screen.findByText("你已被移出房间")).toBeTruthy();
  });

  it("opens an ended room as read-only history", async () => {
    setup({
      "POST /api/rooms/r1/ticket": () => json({ error: "Room not found" }, 404),
      "GET /api/rooms/r1": () => json({ room: { ...ROOM, status: "closed", code: null, my_role: "member" }, members: MEMBERS }),
      "GET /api/rooms/r1/messages": () => json({ messages: [user(7, "See you!"), user(8, "Bye", { sender: { kind: "user", id: 11111111, name: "alice" } })] }),
    });
    expect(await screen.findByText("See you!")).toBeTruthy();
    expect(screen.getByText("房间已结束,只能查看。")).toBeTruthy();
    expect(screen.getByText("已结束 · 只读")).toBeTruthy();
    expect((screen.getByTestId("room-input") as HTMLInputElement).disabled).toBe(true);
    expect(FakeWebSocket.count).toBe(0);
  });

  it("reports another member's message with a reason", async () => {
    const mock = setup({ "POST /api/rooms/r1/messages/m2/report": () => json({ ok: true }) });
    await live();
    FakeWebSocket.last!.push({ type: "message", message: user(2, "spam spam") });
    fireEvent.click(screen.getByText("spam spam"));
    fireEvent.click(screen.getByTestId("room-report"));
    fireEvent.click(await screen.findByRole("button", { name: "垃圾信息" }));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/rooms/r1/messages/m2/report")).toBe(true));
    expect(await screen.findByText("已举报")).toBeTruthy();
  });

  it("lets the owner change settings, remove a member and end the room", async () => {
    const mock = setup({
      "PATCH /api/rooms/r1": () => json({ room: { ...ROOM, locked: true } }),
      "POST /api/rooms/r1/kick": () => json({ ok: true }),
      "POST /api/rooms/r1/close": () => json({ room: { ...ROOM, status: "closed", code: null } }),
    });
    await live();
    fireEvent.click(screen.getByRole("button", { name: "成员与设置" }));
    fireEvent.click(await screen.findByTestId("room-lock"));
    await waitFor(() => expect(mock.calls.find((c) => c.method === "PATCH")?.body).toBe('{"locked":true}'));
    await waitFor(() => expect(screen.getByTestId("room-lock").getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByTestId("room-kick-22"));
    fireEvent.click(await screen.findByTestId("room-confirm"));
    await waitFor(() => expect(JSON.parse(mock.calls.find((c) => c.url.pathname.endsWith("/kick"))!.body as string)).toEqual({ user_id: 22 }));
    fireEvent.click(screen.getByTestId("room-close"));
    fireEvent.click(await screen.findByTestId("room-confirm"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname.endsWith("/close"))).toBe(true));
  });

  it("composes with the assistant and sends the suggestion as assisted", async () => {
    setup();
    await live();
    fireEvent.click(screen.getByTestId("room-assist-open"));
    fireEvent.change(await screen.findByTestId("assist-input"), { target: { value: "I like 巧克力" } });
    fireEvent.click(screen.getByTestId("assist-ask"));
    const ask = JSON.parse(FakeWebSocket.last!.sent.at(-1)!);
    expect(ask).toMatchObject({ type: "assist", text: "I like 巧克力" });
    FakeWebSocket.last!.push({ type: "assist_reply", request_id: ask.request_id, message: { seq: 5, id: "a5", lane: "private", kind: "assist_reply",
      sender: { kind: "ai", id: null, name: null }, text: "x", assisted: false, reply_to: null, ai_status: null, created_at: "",
      meta: { reply_zh: "巧克力是 chocolate。", glossary: [], suggestions: [{ en: "I like chocolate.", note_zh: "最常用" }] } } });
    expect(screen.queryAllByTestId("room-message")).toHaveLength(0); // the private lane never enters the public list
    fireEvent.click(await screen.findByTestId("assist-send"));
    expect(JSON.parse(FakeWebSocket.last!.sent.at(-1)!)).toMatchObject({ type: "say", text: "I like chocolate.", assist_id: "a5" });
    await waitFor(() => expect(screen.queryByTestId("assist-tray")).toBeNull());
  });

  it("edits a suggestion in the composer", async () => {
    setup();
    await live();
    FakeWebSocket.last!.push({ type: "welcome", room: ROOM, me: { user_id: 11111111, role: "owner" }, members: MEMBERS, last_seq: 0, truncated: false,
      assist_history: [{ seq: 1, id: "q1", lane: "private", kind: "assist_request", sender: { kind: "user", id: 11111111, name: "alice" }, text: "我想说你好",
        assisted: false, reply_to: null, ai_status: null, meta: null, created_at: "" },
      { seq: 2, id: "a2", lane: "private", kind: "assist_reply", sender: { kind: "ai", id: null, name: null }, text: "x", assisted: false, reply_to: null,
        ai_status: null, created_at: "", meta: { reply_zh: "x", glossary: [], suggestions: [{ en: "Hello everyone!", note_zh: "" }] } }] });
    fireEvent.click(screen.getByTestId("room-assist-open"));
    expect(await screen.findByText("我想说你好")).toBeTruthy();
    fireEvent.click(screen.getByTestId("assist-edit"));
    await waitFor(() => expect((screen.getByTestId("room-input") as HTMLInputElement).value).toBe("Hello everyone!"));
  });

  it("survives StrictMode's mount, unmount, mount without ending up closed", async () => {
    const mock = createFetchMock({
      "GET /api/rooms/config": () => json({ enabled: true, ai_available: true, max_members: 8, max_text: 500 }),
      "POST /api/rooms/r1/ticket": () => json({ ticket: "secret-ticket", expires_in: 60 }),
    });
    renderWithProviders(<StrictMode><RoomPage /></StrictMode>, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
      route: "/rooms/r/r1", path: "/rooms/r/:roomId", user: { id: "11111111", name: "alice" } });
    await waitFor(() => expect(FakeWebSocket.last?.sent[0]).toBe('{"type":"hello","last_seq":0,"v":2}'));
    expect(screen.queryByText("房间已结束,只能查看。")).toBeNull(); // the trial unmount must not leave a terminal "closed"
    await live();
    FakeWebSocket.last!.push({ type: "message", message: user(1, "still live") });
    expect(screen.getByText("still live")).toBeTruthy();
    expect((screen.getByTestId("room-input") as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText("房间已结束,只能查看。")).toBeNull();
  });

  it("routes the composer to the assistant while the assistant is open", async () => {
    setup({ "GET /api/rooms/config": () => json(V2_CONFIG) });
    await live();
    fireEvent.click(screen.getByTestId("room-assist-open"));
    expect(screen.getByTestId("room-target-assist").textContent).toContain("问助手");
    fireEvent.change(screen.getByTestId("room-input"), { target: { value: "I like 巧克力" } });
    fireEvent.click(screen.getByTestId("room-send"));
    expect(JSON.parse(FakeWebSocket.last!.sent.at(-1)!)).toMatchObject({ type: "assist", text: "I like 巧克力" });
    expect((screen.getByTestId("room-input") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByTestId("room-target-clear"));
    expect(screen.queryByTestId("room-target-assist")).toBeNull();
    fireEvent.change(screen.getByTestId("room-input"), { target: { value: "Hi all" } });
    fireEvent.click(screen.getByTestId("room-send"));
    expect(JSON.parse(FakeWebSocket.last!.sent.at(-1)!)).toMatchObject({ type: "say", text: "Hi all", reply_to: null });
  });

  it("shows the voice toggle only when the site and the room allow voice", async () => {
    setup({ "GET /api/rooms/config": () => json(V2_CONFIG) });
    await live({ ...ROOM, allow_voice: true });
    expect(screen.queryByTestId("room-voice-toggle")).toBeNull(); // site voice is off
  });

  it("shows the voice toggle when voice is available and switches the input", async () => {
    setup({ "GET /api/rooms/config": () => json({ ...V2_CONFIG, voice_available: true }) });
    await live({ ...ROOM, allow_voice: true });
    fireEvent.click(screen.getByTestId("room-voice-toggle"));
    expect(screen.queryByTestId("room-input")).toBeNull(); // the (stub) hold-to-talk input replaces the text box
    fireEvent.click(screen.getByTestId("room-voice-toggle"));
    expect(screen.getByTestId("room-input")).toBeTruthy();
  });

  it("renders v2 messages and the invite button", async () => {
    setup({ "GET /api/rooms/config": () => json(V2_CONFIG) });
    await live();
    FakeWebSocket.last!.push({ type: "message", message: user(2, "Any food?") });
    FakeWebSocket.last!.push({ type: "message", message: user(3, "Noodles!", { kind: "voice", reply_to: 2,
      quote: { seq: 2, name: "bob", kind: "text", text: "Any food?" }, reactions: [{ key: "like", user_ids: [22] }],
      voice: { duration_ms: 6400, status: "done", transcript: "Noodles!", lang: "en", translation: null, translation_status: null, attempts: 1, audio: true } }) });
    // the message itself and the quote block inside the reply (WE1 Addendum: QuoteBlock now renders the quoted text)
    expect(screen.getAllByText("Any food?")).toHaveLength(2);
    const voice = screen.getAllByTestId("room-message").find((m) => m.dataset.kind === "voice")!;
    expect(voice.textContent).toContain("Noodles!");
    expect(voice.closest("[data-seq]")?.getAttribute("data-seq")).toBe("3");
    expect(screen.getByTestId("room-invite")).toBeTruthy();
  });

  it("explains when rooms are off", async () => {
    const mock = createFetchMock({ "GET /api/rooms/config": () => json({ enabled: false, ai_available: false, max_members: 8, max_text: 500 }) });
    renderWithProviders(<RoomPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rooms/r/r1", path: "/rooms/r/:roomId" });
    expect(await screen.findByText("联机练习未开启。")).toBeTruthy();
    expect(FakeWebSocket.count).toBe(0);
  });
});
