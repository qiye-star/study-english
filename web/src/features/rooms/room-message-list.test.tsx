import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import type { RoomMessage } from "./protocol";
import { RoomMessageList, type RoomMessageListProps } from "./room-message-list";
import { initialRoomState, type RoomState } from "./room-state";

const msg = (seq: number, text: string, over: Partial<RoomMessage> = {}): RoomMessage => ({
  seq, id: `m${seq}`, lane: "public", kind: "text", sender: { kind: "user", id: 22, name: "bob" }, text, assisted: false, replyTo: null,
  aiStatus: null, meta: null, createdAt: "", quote: null, voice: null, reactions: [], ...over,
});

function stateWith(messages: RoomMessage[]): RoomState {
  return { ...initialRoomState(), status: "live", me: { userId: 11, role: "owner" }, messages };
}

function setup(messages: RoomMessage[], routes = {}) {
  const mock = createFetchMock(routes);
  const props: RoomMessageListProps = {
    state: stateWith(messages), roomId: "r1", reported: new Set(), autoText: false,
    onLoadEarlier: vi.fn(), onReport: vi.fn(), onReact: vi.fn(), onQuote: vi.fn(), onTranslateVoice: vi.fn(), onRetryVoice: vi.fn(),
  };
  renderWithProviders(<RoomMessageList {...props} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { mock, props };
}

describe("RoomMessageList (v2 extras)", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("opens the action row on tap and quotes the message", () => {
    const { props } = setup([msg(3, "What snacks do you like?")]);
    expect(screen.queryByTestId("msg-quote")).toBeNull();
    fireEvent.click(screen.getByText("What snacks do you like?"));
    fireEvent.click(screen.getByTestId("msg-quote"));
    expect(props.onQuote).toHaveBeenCalledWith(expect.objectContaining({ seq: 3 }));
    expect(screen.queryByTestId("msg-quote")).toBeNull();
  });

  it("ignores a second tap on the same reaction until the server answers (review m6)", () => {
    const { props } = setup([msg(3, "Hi", { reactions: [{ key: "like", userIds: [22] }] })]);
    fireEvent.click(screen.getByTestId("reaction-like"));
    fireEvent.click(screen.getByTestId("reaction-like")); // quick double tap: state has not changed yet
    expect(props.onReact).toHaveBeenCalledTimes(1);
    expect(props.onReact).toHaveBeenCalledWith(3, "like", true);
  });

  it("reacts with the message seq and closes the row", () => {
    const { props } = setup([msg(3, "Hi", { reactions: [{ key: "like", userIds: [11] }] })]);
    fireEvent.click(screen.getByText("Hi"));
    fireEvent.click(screen.getByTestId("react-like"));
    expect(props.onReact).toHaveBeenCalledWith(3, "like", false);
    expect(screen.queryByTestId("react-like")).toBeNull();
    fireEvent.click(screen.getByTestId("reaction-like"));
    expect(props.onReact).toHaveBeenLastCalledWith(3, "like", false);
  });

  it("translates a text message below the bubble", async () => {
    const calls: string[] = [];
    const { mock } = setup([msg(3, "Not yet. Is it sweet?")], {
      "POST /api/ai/chat/completions": (call: { body: BodyInit | null | undefined }) => {
        calls.push(JSON.parse(call.body as string).messages.at(-1).content);
        return json({ choices: [{ message: { content: "还没有。它甜吗?" } }] });
      },
    });
    fireEvent.click(screen.getByText("Not yet. Is it sweet?"));
    fireEvent.click(screen.getByTestId("msg-translate"));
    await waitFor(() => expect(screen.getByTestId("room-translation")).toHaveAttribute("data-status", "done"));
    expect(screen.getByTestId("room-translation").textContent).toContain("还没有。它甜吗?");
    expect(calls.some((c) => c.includes("Not yet. Is it sweet?"))).toBe(true);
    expect(mock.calls.some((c) => c.url.pathname === "/api/ai/chat/completions")).toBe(true);
  });

  it("does not offer translate for a message already in the native language, nor for voice", () => {
    setup([msg(3, "我也喜欢巧克力"), msg(4, "", { kind: "voice", voice: { durationMs: 1000, status: "pending", transcript: null, lang: null, translation: null, translationStatus: null, attempts: 0, audio: true } })]);
    fireEvent.click(screen.getByText("我也喜欢巧克力"));
    expect(screen.queryByTestId("msg-translate")).toBeNull();
    expect(screen.queryByTestId("msg-speak")).toBeNull(); // all-Chinese text has nothing to read aloud (R-AW9)
    const voice = screen.getAllByTestId("room-message").find((m) => m.dataset.kind === "voice")!;
    fireEvent.click(voice);
    expect(screen.queryByTestId("msg-translate")).toBeNull();
    expect(screen.queryByTestId("msg-speak")).toBeNull();
    expect(screen.getByTestId("msg-quote")).toBeTruthy();
  });

  it("renders the quote block inside the bubble and own messages have no report", () => {
    setup([msg(3, "Any food?"), msg(4, "Noodles!", { sender: { kind: "user", id: 11, name: "alice" }, quote: { seq: 3, name: "bob", kind: "text", text: "Any food?" } })]);
    const mine = screen.getAllByTestId("room-message").find((m) => m.dataset.mine === "true")!;
    expect(within(mine).getByTestId("quote-block").textContent).toContain("bob");
    fireEvent.click(within(mine).getByText("Noodles!"));
    expect(screen.getByTestId("msg-quote")).toBeTruthy();
    expect(screen.queryByTestId("room-report")).toBeNull();
  });
  it("spells out each settings change with WC's describeSettingsChanges", async () => {
    const meta = { changes: [{ field: "name", value: "咖啡角" }, { field: "max_members", value: 5 }] };
    setup([msg(3, "settings", { kind: "system", sender: { kind: "system", id: null, name: null }, meta })]);
    expect(await screen.findByText("房主把房间名改为「咖啡角」,把人数上限改为 5")).toBeTruthy();
  });

  it("names a changed scenario from the rooms config and falls back to the generic text", async () => {
    const meta = { changes: [{ field: "scenario", value: "cafe" }] };
    setup([
      msg(3, "settings", { kind: "system", sender: { kind: "system", id: null, name: null }, meta }),
      msg(4, "settings", { kind: "system", sender: { kind: "system", id: null, name: null }, meta: { changes: [{ field: "x", value: 1 }] } }),
    ], { "GET /api/rooms/config": () => json({ scenarios: [{ key: "cafe", title_zh: "咖啡店点单", title_en: "At a café" }] }) });
    expect(await screen.findByText("房主把场景改为「咖啡店点单」")).toBeTruthy();
    expect(screen.getByText("房主修改了房间设置")).toBeTruthy();
  });
});

describe("RoomMessageList bubble layout (short own messages wrapped per letter)", () => {
  const row = (el: HTMLElement) => el.closest<HTMLElement>("[data-message-id]")!;

  it("lays each message row across the list so the 88% cap is measured against the list, not the bubble", () => {
    setup([msg(3, "Hi"), msg(4, "OK", { sender: { kind: "user", id: 11, name: "alice" } }),
      msg(5, "Sure", { kind: "ai_answer", sender: { kind: "ai", id: null, name: null } })]);
    for (const bubble of screen.getAllByTestId("room-message")) {
      // a shrink-wrapped row (self-start / self-end) made max-w-[88%] resolve against the bubble's own width
      expect(row(bubble).className.split(/\s+/)).toContain("w-full");
      expect(row(bubble).className).not.toMatch(/\bself-(start|end)\b/);
    }
    const mine = screen.getAllByTestId("room-message").find((m) => m.dataset.mine === "true")!;
    expect(row(mine).className).toContain("items-end");
  });

  it("a tap on the empty part of a row still closes the open action row", () => {
    setup([msg(3, "Hi", { sender: { kind: "user", id: 11, name: "alice" } })]);
    fireEvent.click(screen.getByText("Hi"));
    expect(screen.getByTestId("msg-quote")).toBeTruthy();
    fireEvent.pointerDown(screen.getByText("Hi")); // inside the bubble: stays open
    expect(screen.getByTestId("msg-quote")).toBeTruthy();
    fireEvent.pointerDown(row(screen.getByText("Hi"))); // blank space beside the bubble
    expect(screen.queryByTestId("msg-quote")).toBeNull();
  });

  it("gives a pending bubble the same row as the confirmed one, so it does not re-wrap on ack", () => {
    const mock = createFetchMock({});
    const state: RoomState = { ...stateWith([]), pending: [{ clientId: "c1", text: "On my way", assistId: null, seq: null, replyTo: null }] };
    renderWithProviders(<RoomMessageList state={state} roomId="r1" reported={new Set()} autoText={false} onLoadEarlier={vi.fn()} onReport={vi.fn()}
      onReact={vi.fn()} onQuote={vi.fn()} onTranslateVoice={vi.fn()} onRetryVoice={vi.fn()} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const pending = screen.getByTestId("room-pending");
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.textContent).toBe("On my way");
    const line = pending.parentElement!;
    expect(line.className).toContain("max-w-[88%]");
    expect(line.className).toContain("flex-row-reverse");
    // the slot where the confirmed bubble gets its 「更多操作」 button: same width, not focusable, hidden from readers
    const slot = line.querySelector<HTMLElement>("[data-testid=room-pending-slot]")!;
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(slot.className).toContain("size-7");
    expect(line.parentElement!.className.split(/\s+/)).toContain("w-full");
  });
});

describe("RoomMessageList avatars (W3)", () => {
  const AV = "/api/avatars/00000000000000000000000000000000";
  it("shows the sender's avatar image, or the initial when there is none", () => {
    setup([
      msg(1, "with photo", { sender: { kind: "user", id: 22, name: "bob", avatarUrl: AV } }),
      msg(2, "no photo", { sender: { kind: "user", id: 23, name: "carol", avatarUrl: null } }),
    ]);
    const imgs = document.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute("src", AV);
    expect(screen.getByRole("img", { name: "carol" })).toHaveTextContent("C");
  });
});
