import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { AssistTray } from "./assist-tray";
import type { RoomMessage } from "./protocol";
import type { AssistEntry } from "./room-state";

const reply: RoomMessage = { seq: 6, id: "a6", lane: "private", kind: "assist_reply", sender: { kind: "ai", id: null, name: null }, text: "巧克力是 chocolate。",
  assisted: false, replyTo: null, aiStatus: null, createdAt: "", quote: null, voice: null, reactions: [],
  meta: { replyZh: "巧克力是 chocolate。", glossary: [{ src: "巧克力", en: "chocolate" }],
    suggestions: [{ en: "I like chocolate.", noteZh: "最常用" }, { en: "I'm really into chocolate!", noteZh: "更口语" }] } };

function setup(entries: AssistEntry[], disabled = false) {
  const props = { onAsk: vi.fn(() => true), onSend: vi.fn(), onEdit: vi.fn(), onOpenChange: vi.fn() };
  renderWithProviders(<AssistTray open entries={entries} disabled={disabled} {...props} />);
  return props;
}

describe("AssistTray", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("asks the assistant with the draft", () => {
    const p = setup([]);
    expect(screen.getByText("助手 · 仅你可见")).toBeTruthy();
    expect(screen.getByText("不会用英文说?先在这里问助手,满意了再一键发到群里。")).toBeTruthy();
    fireEvent.change(screen.getByTestId("assist-input"), { target: { value: "I like 巧克力" } });
    fireEvent.click(screen.getByTestId("assist-ask"));
    expect(p.onAsk).toHaveBeenCalledWith("I like 巧克力");
    expect((screen.getByTestId("assist-input") as HTMLInputElement).value).toBe("");
  });

  it("keeps the draft when the question could not be sent", () => {
    const onAsk = vi.fn(() => false);
    renderWithProviders(<AssistTray open entries={[]} onAsk={onAsk} onSend={vi.fn()} onEdit={vi.fn()} onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId("assist-input"), { target: { value: "怎么说" } });
    fireEvent.click(screen.getByTestId("assist-ask"));
    expect(onAsk).toHaveBeenCalledWith("怎么说");
    expect((screen.getByTestId("assist-input") as HTMLInputElement).value).toBe("怎么说");
  });

  it("can't ask or send while offline but keeps typing", () => {
    renderWithProviders(<AssistTray open offline entries={[{ requestId: "r1", request: "q", reply, status: "done", error: null }]}
      onAsk={vi.fn()} onSend={vi.fn()} onEdit={vi.fn()} onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId("assist-input"), { target: { value: "x" } });
    expect((screen.getByTestId("assist-ask") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByTestId("assist-send")[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByTestId("assist-edit")[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows glossary and suggestions; send and edit hand the sentence back", () => {
    const p = setup([{ requestId: "r1", request: "I like 巧克力", reply, status: "done", error: null }]);
    expect(screen.getByText("巧克力 → chocolate")).toBeTruthy();
    expect(screen.getAllByTestId("assist-suggestion")).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId("assist-send")[0]);
    expect(p.onSend).toHaveBeenCalledWith("I like chocolate.", "a6");
    fireEvent.click(screen.getAllByTestId("assist-edit")[1]);
    expect(p.onEdit).toHaveBeenCalledWith("I'm really into chocolate!");
  });

  it("shows waiting and failure states", () => {
    setup([{ requestId: "r1", request: "hi", reply: null, status: "waiting", error: null },
      { requestId: "r2", request: "?", reply: null, status: "failed", error: "quota" }]);
    expect(screen.getByText("助手正在想…")).toBeTruthy();
    expect(screen.getByText("今天的助手次数已用完")).toBeTruthy();
  });

  it("is read-only when the room has ended", () => {
    setup([{ requestId: null, request: "q", reply, status: "done", error: null }], true);
    expect((screen.getByTestId("assist-input") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByTestId("assist-send").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});
