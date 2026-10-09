import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomSocket, type SocketLike } from "./room-socket";

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) { FakeSocket.all.push(this); }
  send(data: string) { this.sent.push(data); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  open() { this.readyState = 1; this.onopen?.(); }
  push(event: object) { this.onmessage?.({ data: JSON.stringify(event) }); }
  drop(code: number) { this.readyState = 3; this.onclose?.({ code }); }
}

function setup(over: Partial<ConstructorParameters<typeof RoomSocket>[0]> = {}) {
  const statuses: string[] = [];
  const events: string[] = [];
  let seq = 0;
  let tickets = 0;
  const socket = new RoomSocket({
    getTicket: async () => `t${++tickets}`, url: (t) => `ws://x/api/rooms/ws?ticket=${t}`, lastSeq: () => seq,
    onEvent: (e) => { events.push(e.type); if (e.type === "message") seq = e.message.seq; },
    onStatus: (s, reason) => statuses.push(reason ? `${s}:${reason}` : s),
    createSocket: (url) => new FakeSocket(url), ...over,
  });
  return { socket, statuses, events };
}

describe("RoomSocket", () => {
  beforeEach(() => { FakeSocket.all = []; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it("sends hello with the last seq, goes live on welcome and pings", async () => {
    const { socket, statuses, events } = setup();
    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    const ws = FakeSocket.all[0];
    ws.open();
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "hello", last_seq: 0 });
    ws.push({ type: "welcome", room: {}, me: {}, members: [], last_seq: 0, truncated: false, assist_history: [] });
    expect(statuses).toEqual(["connecting", "live"]);
    ws.push({ type: "message", message: { seq: 7 } });
    expect(events).toEqual(["welcome", "message"]);
    vi.advanceTimersByTime(25_000);
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ type: "ping" });
  });

  it("reconnects with backoff and a fresh ticket, resuming from the last seq", async () => {
    const { socket, statuses } = setup();
    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    FakeSocket.all[0].open();
    FakeSocket.all[0].push({ type: "message", message: { seq: 12 } });
    FakeSocket.all[0].drop(1012);
    expect(statuses.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.all[1].url).toContain("ticket=t2");
    FakeSocket.all[1].open();
    expect(JSON.parse(FakeSocket.all[1].sent[0])).toEqual({ type: "hello", last_seq: 12 });
  });

  it("backs off 1/2/4 seconds across failed attempts", async () => {
    const { socket } = setup();
    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    FakeSocket.all[0].drop(1006);
    await vi.advanceTimersByTimeAsync(1000);
    FakeSocket.all[1].drop(1006);
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeSocket.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    FakeSocket.all[2].drop(1006);
    await vi.advanceTimersByTimeAsync(3999);
    expect(FakeSocket.all).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it("stops on terminal closes and on close()", async () => {
    const { socket, statuses } = setup();
    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    FakeSocket.all[0].open();
    FakeSocket.all[0].drop(4010);
    expect(statuses.at(-1)).toBe("closed:kicked");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    const second = setup();
    second.socket.connect();
    await vi.runOnlyPendingTimersAsync();
    second.socket.close();
    expect(second.statuses.at(-1)).toBe("closed");
    expect(second.socket.send("{}")).toBe(false);
  });

  it("treats a 404 ticket as a closed room and other ticket errors as retryable", async () => {
    const notFound = Object.assign(new Error("Room not found"), { status: 404 });
    const { socket, statuses } = setup({ getTicket: () => Promise.reject(notFound), isTerminalTicketError: (e) => (e as { status?: number }).status === 404 });
    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    expect(statuses.at(-1)).toBe("closed:not_found");

    let calls = 0;
    const flaky = setup({ getTicket: async () => { calls += 1; if (calls === 1) throw Object.assign(new Error("x"), { status: 500 }); return "t"; },
      isTerminalTicketError: (e) => (e as { status?: number }).status === 404 });
    flaky.socket.connect();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    expect(flaky.statuses).not.toContain("closed");
  });

  it("reconnectNow skips the remaining backoff", async () => {
    const { socket } = setup();
    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    FakeSocket.all[0].open();
    FakeSocket.all[0].drop(1006);
    socket.reconnectNow();
    await vi.runOnlyPendingTimersAsync();
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("drops a silent socket on the next ping and reconnects", async () => {
    const { socket, statuses } = setup({ backoffMs: [1000] });
    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    FakeSocket.all[0].open();
    FakeSocket.all[0].push({ type: "welcome", room: {}, me: {}, members: [], last_seq: 0, truncated: false, assist_history: [] });
    await vi.advanceTimersByTimeAsync(25_000);
    FakeSocket.all[0].push({ type: "pong" }); // answered: still alive
    await vi.advanceTimersByTimeAsync(50_000);
    expect(FakeSocket.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(25_000); // 75 s without a frame
    expect(statuses.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("reconnectNow replaces a socket that went silent while the page was hidden", async () => {
    const { socket, statuses } = setup();
    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    FakeSocket.all[0].open();
    socket.reconnectNow(); // fresh: keep it
    expect(FakeSocket.all).toHaveLength(1);
    vi.setSystemTime(Date.now() + 120_000); // suspended: no timers ran, no close event
    socket.reconnectNow();
    expect(statuses.at(-1)).toBe("reconnecting");
    await vi.runOnlyPendingTimersAsync();
    expect(FakeSocket.all).toHaveLength(2);
    expect(FakeSocket.all[0].readyState).toBe(3);
  });

  it("a 403 ticket (removed from the room) closes with the kicked reason", async () => {
    const removed = Object.assign(new Error("Removed from room"), { status: 403 });
    const { socket, statuses } = setup({ getTicket: () => Promise.reject(removed),
      isTerminalTicketError: (e) => ((e as { status?: number }).status === 403 ? "kicked" : false) });
    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    expect(statuses.at(-1)).toBe("closed:kicked");
  });

  it("ignores frames that are not known events", async () => {
    const { socket, events } = setup();
    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    FakeSocket.all[0].open();
    FakeSocket.all[0].onmessage?.({ data: "garbage" });
    FakeSocket.all[0].push({ type: "unknown" });
    expect(events).toEqual([]);
  });
});
