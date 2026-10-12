import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { RoomPage } from "../room-page";
import { AGENTS_WIRE, ME, ROOM_WIRE } from "./fixtures";

vi.mock("~/features/agents", async (importActual) => ({
  ...(await importActual<typeof import("~/features/agents")>()),
  ProcessCapsule: () => <div data-testid="capsule" />, PersonaPicker: (): null => null,
}));

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) { FakeWebSocket.last = this; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  push(e: object) { act(() => this.onmessage?.({ data: JSON.stringify(e) })); }
}

const CONFIG = { enabled: true, ai_available: true, max_members: 8, max_text: 500, scenarios: [] as unknown[], levels: ["B1"], default_max_members: 4,
  name_max: 30, voice_available: false, max_voice_ms: 60000, summary_available: false, reactions: [] as unknown[], agents_available: true,
  agent_tutor_available: true, max_agents: 2 };
const TUTOR_WIRE = { persona_id: "builtin:coach", persona_name: "Emma", phase: "await_answer", step_index: 1, steps_total: 8,
  current_user_id: ME, current_name: "alice", deadline_at: "2026-10-12T09:01:00Z", remaining_ms: 60000, started_by: 22, paused_reason: null as string | null };

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
const TARGET_KEY = `enjoy-web.rooms.target.v1.${ME}.r1`;
afterEach(async () => {
  vi.unstubAllGlobals(); FakeWebSocket.last = null; localStorage.removeItem("enjoy-web.settings"); localStorage.removeItem(TARGET_KEY); await i18n.changeLanguage("en");
});

it("wires agent names, the persona sheet's @ask and the tutor bar into the room page", async () => {
  const mock = createFetchMock({
    "GET /api/rooms/config": () => json(CONFIG),
    "POST /api/rooms/r1/ticket": () => json({ ticket: "secret-ticket", expires_in: 60 }),
    "GET /api/rooms/r1/agents": () => json(AGENTS_WIRE),
  });
  renderWithProviders(<RoomPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rooms/r/r1", path: "/rooms/r/:roomId" });
  await vi.waitFor(() => expect(FakeWebSocket.last?.sent[0]).toBeTruthy());
  const ws = FakeWebSocket.last!;
  ws.push({ type: "welcome", room: { ...ROOM_WIRE, owner_id: 22, my_role: "member" }, me: { user_id: ME, role: "member" },
    members: [{ user_id: ME, name: "alice", role: "member", online: true }, { user_id: 22, name: "bob", role: "owner", online: true }],
    last_seq: 0, truncated: false, assist_history: [], protocol: 2, reactions: [], join_requests: [] });
  ws.push({ type: "message", message: { seq: 1, id: "m1", lane: "public", kind: "ai_answer", sender: { kind: "ai", id: null, name: null },
    text: "Sure.", assisted: false, reply_to: null, ai_status: null, created_at: "2026-10-12T09:00:00Z", hidden: false, quote: null, voice: null,
    reactions: [], meta: { agent: { persona_id: "builtin:coach", name: "Emma" }, asker: { id: 22, name: "bob" } } } });
  ws.push({ type: "agent_tutor", tutor: TUTOR_WIRE });
  expect(await screen.findByTestId("room-agent-answered")).toHaveTextContent("Emma 已回答 · 对 bob");
  expect(screen.getByTestId("room-tutor-bar")).toHaveTextContent("轮到你了");
  fireEvent.click(screen.getByTestId("room-agent-name"));
  fireEvent.click(await screen.findByRole("button", { name: "@Emma 提问" }));
  expect(screen.getByTestId("room-input")).toHaveValue("@Emma ");
  expect(document.body.textContent).not.toContain("secret-ticket");
});

const says = (ws: FakeWebSocket) => ws.sent.map((f) => JSON.parse(f) as Record<string, unknown>).filter((f) => f.type === "say");
async function enterRoom() {
  const mock = createFetchMock({
    "GET /api/rooms/config": () => json(CONFIG),
    "POST /api/rooms/r1/ticket": () => json({ ticket: "secret-ticket", expires_in: 60 }),
    "GET /api/rooms/r1/agents": () => json(AGENTS_WIRE),
  });
  renderWithProviders(<RoomPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rooms/r/r1", path: "/rooms/r/:roomId" });
  await vi.waitFor(() => expect(FakeWebSocket.last?.sent[0]).toBeTruthy());
  const ws = FakeWebSocket.last!;
  ws.push({ type: "welcome", room: { ...ROOM_WIRE, owner_id: 22, my_role: "member" }, me: { user_id: ME, role: "member" },
    members: [{ user_id: ME, name: "alice", role: "member", online: true }, { user_id: 22, name: "bob", role: "owner", online: true }],
    last_seq: 0, truncated: false, assist_history: [], protocol: 2, reactions: [], join_requests: [] });
  await screen.findByRole("button", { name: "对 Emma 说" });
  return ws;
}
function send(text: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("room-send"));
}

it("the target chip adds say.to, shows the standing hint and is remembered per room (spec addressing §3.2 #2)", async () => {
  const ws = await enterRoom();
  expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "说点什么,或 @AI(Emma)提问");
  send("plain");
  expect(says(ws).at(-1)).not.toHaveProperty("to");
  fireEvent.click(screen.getByRole("button", { name: "对 Emma 说" }));
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("消息会交给 Emma");
  send("hello coach");
  expect(says(ws).at(-1)).toMatchObject({ text: "hello coach", to: "builtin:coach" });
  expect(JSON.parse(localStorage.getItem(TARGET_KEY)!)).toMatchObject({ on: true, personaId: "builtin:coach" });
  expect(document.body.textContent).not.toContain("secret-ticket");
});

it("auto-opens for a member when a tutor starts and closes when it stops; never sends to while it is my turn (R-AW3, R-AW4)", async () => {
  const ws = await enterRoom();
  ws.push({ type: "agent_tutor", tutor: { ...TUTOR_WIRE, current_user_id: 22, current_name: "bob" } });
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toHaveAttribute("aria-pressed", "true");
  ws.push({ type: "agent_tutor", tutor: { ...TUTOR_WIRE, current_user_id: ME } }); // now my turn
  send("I went to the park");
  expect(says(ws).at(-1)).not.toHaveProperty("to");
  ws.push({ type: "message", message: { seq: 3, id: "m3", lane: "public", kind: "system", sender: { kind: "system", id: null, name: null }, text: "tutor_stopped",
    assisted: false, reply_to: null, ai_status: null, created_at: "2026-10-12T09:02:00Z", hidden: false, quote: null, voice: null, reactions: [], meta: {} } });
  ws.push({ type: "agent_tutor", tutor: null });
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toHaveAttribute("aria-pressed", "false");
});

it("shows 回复 Emma 中 while quoting an agent reply and keeps reply_to as today", async () => {
  const ws = await enterRoom();
  ws.push({ type: "message", message: { seq: 2, id: "m2", lane: "public", kind: "ai_answer", sender: { kind: "ai", id: null, name: null }, text: "Try again.",
    assisted: false, reply_to: null, ai_status: null, created_at: "2026-10-12T09:00:00Z", hidden: false, quote: null, voice: null, reactions: [],
    meta: { agent: { persona_id: "builtin:coach", name: "Emma" }, asker: { id: ME, name: "alice" } } } });
  fireEvent.click(await screen.findByTestId("room-message-more"));
  fireEvent.click(screen.getByTestId("msg-quote"));
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("回复 Emma 中 · 消息会交给 Emma");
  send("ok");
  expect(says(ws).at(-1)).toMatchObject({ reply_to: 2 });
  expect(says(ws).at(-1)).not.toHaveProperty("to");
});

it("hides the generic banner for voice_unclear during my turn (the tutor bar says it)", async () => {
  const ws = await enterRoom();
  ws.push({ type: "agent_tutor", tutor: { ...TUTOR_WIRE, current_user_id: ME } });
  ws.push({ type: "notice", code: "voice_unclear" });
  expect(screen.getByTestId("room-tutor-bar")).toHaveTextContent("没听清,再说一次");
  expect(screen.getAllByText("没听清,再说一次")).toHaveLength(1);
});
