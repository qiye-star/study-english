import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { setLiquid } from "~/test/glass";
import { renderWithProviders } from "~/test/render";
import type { RoomMessage } from "../protocol";
import type { AssistEntry } from "../room-state";
import { AssistDock, type AssistDockProps } from "./assist-dock";

const reply: RoomMessage = { seq: 6, id: "a6", lane: "private", kind: "assist_reply", sender: { kind: "ai", id: null, name: null }, text: "巧克力是 chocolate。",
  assisted: false, replyTo: null, aiStatus: null, createdAt: "", quote: null, voice: null, reactions: [],
  meta: { replyZh: "巧克力是 chocolate。", glossary: [{ src: "巧克力", en: "chocolate" }],
    suggestions: [{ en: "I like chocolate.", noteZh: "最常用" }, { en: "I'm really into chocolate!", noteZh: "更口语" }] } };
const entries: AssistEntry[] = [{ requestId: "r1", request: "I like 巧克力", reply, status: "done", error: null }];

function setup(over: Partial<AssistDockProps> = {}) {
  const props: AssistDockProps = { open: true, snap: "mid", keyboardOpen: false, entries, disabled: false, offline: false,
    onSnap: vi.fn(), onClose: vi.fn(), onAsk: vi.fn(() => true), onSend: vi.fn(), onEdit: vi.fn(), onHeight: vi.fn(), ...over };
  let update: (next: Partial<AssistDockProps>) => void = () => {};
  function Harness() {
    const [over2, setOver] = useState<Partial<AssistDockProps>>({});
    update = setOver;
    return <AssistDock {...props} {...over2} />;
  }
  renderWithProviders(<Harness />);
  return { props, rerender: (next: Partial<AssistDockProps>) => act(() => update(next)) };
}

describe("AssistDock", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { vi.unstubAllGlobals(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("is a docked panel, not a modal sheet", () => {
    const { props } = setup();
    const dock = screen.getByTestId("assist-dock");
    expect(dock.getAttribute("role")).not.toBe("dialog");
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("[data-state='open']")).toBeNull(); // no overlay / sheet
    expect(screen.getByRole("region", { name: "助手 · 仅你可见" })).toBe(dock);
    expect(screen.getByText("仅你可见")).toBeTruthy();
    const mid = Math.round(window.innerHeight * 0.28);
    expect(dock.style.height).toBe(`${mid}px`);
    expect(props.onHeight).toHaveBeenLastCalledWith(mid);
    expect(dock.className).not.toContain("backdrop");
  });

  it("sits on the composer's top edge and follows its height", () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true,
      get(this: HTMLElement) { return this.dataset.testid === "room-composer" ? 64 : 0; } });
    try {
      const props: AssistDockProps = { open: true, snap: "mid", keyboardOpen: false, entries, disabled: false, offline: false,
        onSnap: vi.fn(), onClose: vi.fn(), onAsk: vi.fn(() => true), onSend: vi.fn(), onEdit: vi.fn(), onHeight: vi.fn() };
      renderWithProviders(<div><AssistDock {...props} /><div data-testid="room-composer"><input data-testid="room-input" /></div></div>);
      expect(screen.getByTestId("assist-dock").style.bottom).toBe("64px");
      fireEvent.click(screen.getAllByTestId("assist-edit")[0]);
      expect(props.onEdit).toHaveBeenCalledWith("I like chocolate.");
      expect(document.activeElement).toBe(screen.getByTestId("room-input")); // 改一改 focuses the composer
    } finally {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", desc);
    }
  });

  it("renders the request, the Chinese explanation, glossary chips and suggestion cards", () => {
    setup();
    expect(screen.getByText("I like 巧克力")).toBeTruthy();
    expect(screen.getByText("巧克力是 chocolate。")).toBeTruthy();
    expect(screen.getByText("巧克力 → chocolate")).toBeTruthy();
    expect(screen.getAllByTestId("assist-suggestion")).toHaveLength(2);
    expect(screen.getByText("最常用")).toBeTruthy();
    expect(screen.getAllByTestId("assist-send")[0].textContent).toBe("发送");
    expect(screen.getAllByTestId("assist-edit")[0].textContent).toBe("改一改");
  });

  it("collapses to one row while the keyboard is open", () => {
    const { props } = setup({ keyboardOpen: true });
    expect(screen.getByTestId("assist-dock").style.height).toBe("52px");
    expect(props.onHeight).toHaveBeenLastCalledWith(52);
    expect(screen.queryAllByTestId("assist-send")).toHaveLength(0);
    expect(screen.getByText("I like chocolate.")).toBeTruthy(); // one-line summary: first suggestion of the latest reply
  });

  it("is closed and reports no height when not open", () => {
    const { props } = setup({ open: false });
    expect(screen.queryByTestId("assist-dock")).toBeNull();
    expect(props.onHeight).toHaveBeenLastCalledWith(0);
  });

  it("sends a suggestion or hands it to the composer, and stays open", () => {
    const { props } = setup();
    fireEvent.click(screen.getAllByTestId("assist-send")[0]);
    expect(props.onSend).toHaveBeenCalledWith("I like chocolate.", "a6");
    expect(props.onClose).not.toHaveBeenCalled();
    // one assist_id per reply: the sent card says so and the other one cannot be sent with the same id
    expect(screen.getByText("已发送")).toBeTruthy();
    expect(screen.queryAllByTestId("assist-send")).toHaveLength(1);
    expect((screen.getByTestId("assist-send") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByTestId("assist-edit")[1]);
    expect(props.onEdit).toHaveBeenCalledWith("I'm really into chocolate!");
  });

  it("treats a reply already used in an earlier session as sent", () => {
    setup({ entries: [{ ...entries[0], requestId: null, reply: { ...reply, meta: { ...reply.meta, used: true } } }] });
    const sends = screen.getAllByTestId("assist-send");
    expect(sends).toHaveLength(2);
    expect(sends.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("cannot send while offline or after the room ended", () => {
    setup({ offline: true });
    expect(screen.getAllByTestId("assist-send").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getAllByTestId("assist-edit")[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows waiting and failure states and retries a failed request", () => {
    const { props } = setup({ entries: [{ requestId: "r2", request: "我想说再见", reply: null, status: "failed", error: "upstream" },
      { requestId: "r3", request: "谢谢", reply: null, status: "waiting", error: null }] });
    expect(screen.getByText("助手暂时不可用")).toBeTruthy();
    expect(screen.getByText("助手正在想…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(props.onAsk).toHaveBeenCalledWith("我想说再见");
  });

  it("explains how to ask when there is nothing yet", () => {
    setup({ entries: [] });
    expect(screen.getByText(/在下面的输入框写下想说的话/)).toBeTruthy();
  });

  it("snaps with the keyboard on the handle and closes", () => {
    const { props } = setup();
    const handle = screen.getByRole("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
    expect(handle.getAttribute("aria-valuenow")).toBe(String(Math.round(window.innerHeight * 0.28)));
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(props.onSnap).toHaveBeenCalledWith("max");
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(props.onSnap).toHaveBeenLastCalledWith("row");
    fireEvent.click(screen.getByTestId("assist-dock-toggle"));
    expect(props.onSnap).toHaveBeenLastCalledWith("row");
    fireEvent.click(screen.getByTestId("assist-dock-close"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("expands from one row back to the last expanded snap", () => {
    const { props, rerender } = setup({ snap: "max" });
    rerender({ snap: "row" });
    expect(screen.getByTestId("assist-dock").style.height).toBe("52px");
    fireEvent.click(screen.getByTestId("assist-dock-toggle"));
    expect(props.onSnap).toHaveBeenLastCalledWith("max");
  });

  it("drags the handle and snaps to the nearest height on release", () => {
    // jsdom has no PointerEvent: without it fireEvent drops clientY / pointerId
    class FakePointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
    }
    vi.stubGlobal("PointerEvent", FakePointerEvent);
    const { props } = setup();
    const handle = screen.getByRole("separator");
    const mid = Math.round(window.innerHeight * 0.28);
    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 450, pointerId: 1 });
    expect(screen.getByTestId("assist-dock").style.height).toBe(`${mid + 50}px`);
    fireEvent.pointerUp(handle, { clientY: 450, pointerId: 1 });
    expect(props.onSnap).toHaveBeenLastCalledWith("max");
  });

  it("counts new suggestions that arrive while collapsed to one row", () => {
    const { rerender } = setup({ snap: "row" });
    expect(screen.queryByText(/条新建议/)).toBeNull();
    const next: RoomMessage = { ...reply, id: "a8", seq: 8, meta: { ...reply.meta, suggestions: [{ en: "See you!", noteZh: "" }, { en: "Bye!", noteZh: "" }] } };
    rerender({ snap: "row", entries: [...entries, { requestId: "r4", request: "再见", reply: next, status: "done", error: null }] });
    expect(screen.getByText("2 条新建议")).toBeTruthy();
    expect(screen.getByText("See you!")).toBeTruthy();
    rerender({ snap: "mid", entries: [...entries, { requestId: "r4", request: "再见", reply: next, status: "done", error: null }] });
    expect(screen.queryByText(/条新建议/)).toBeNull();
  });
  it("liquid: the dock is an E1 panel without blur (R-L7-2)", () => {
    setLiquid(true);
    try {
      setup();
      const dock = screen.getByTestId("assist-dock");
      expect(dock.className).toContain("mat-surface");
      expect(dock.className).not.toContain("backdrop");
      expect(dock.className).not.toMatch(/mat-chrome|mat-sheet|\bglass\b/);
    } finally {
      setLiquid(false);
    }
  });
});
