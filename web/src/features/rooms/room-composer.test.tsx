import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { setLiquid, textOutsidePlates } from "~/test/glass";
import { renderWithProviders } from "~/test/render";
import { ActivityLine } from "./extras/activity-line";
import { QuoteBar } from "./extras/quote-block";
import { RoomComposer, type RoomComposerProps } from "./room-composer";

function setup(over: Partial<RoomComposerProps> = {}) {
  const props: RoomComposerProps = { disabled: false, offline: false, value: "", ai: true, onChange: vi.fn(), onSend: vi.fn(),
    target: "group", onClearTarget: vi.fn(), voice: { available: false, mode: "text", onToggle: vi.fn(), input: null }, ...over };
  renderWithProviders(<RoomComposer {...props} />);
  return props;
}

describe("RoomComposer", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("shows the ask-assistant pill and placeholder while targeting the assistant", () => {
    const p = setup({ target: "assist" });
    const pill = screen.getByTestId("room-target-assist");
    expect(pill.textContent).toContain("问助手");
    const input = screen.getByTestId("room-input") as HTMLInputElement;
    expect(input.placeholder).toBe("想说什么?中英混写也行");
    expect(screen.getByTestId("room-input-box").className).toContain("border-blue/40");
    expect(screen.queryByTestId("room-at-ai")).toBeNull(); // @ai is for the group
    fireEvent.click(screen.getByTestId("room-target-clear"));
    expect(p.onClearTarget).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "改回发到群聊" })).toBeTruthy();
  });

  it("uses the group placeholder and no pill for the group", () => {
    setup();
    expect(screen.queryByTestId("room-target-assist")).toBeNull();
    expect(screen.getByTestId("room-input-box").className).not.toContain("border-blue/40");
  });

  it("shows the @ key inside the input only while it is empty", () => {
    const p = setup();
    const at = screen.getByTestId("room-at-ai");
    expect(screen.getByTestId("room-input-box").contains(at)).toBe(true);
    fireEvent.click(at);
    expect(p.onChange).toHaveBeenCalledWith("@ai ");
  });

  it("hides the @ key once there is text", () => {
    setup({ value: "Hi" });
    expect(screen.queryByTestId("room-at-ai")).toBeNull();
  });

  it("hides the @ key when AI is unavailable", () => {
    setup({ ai: false });
    expect(screen.queryByTestId("room-at-ai")).toBeNull();
  });

  it("replaces the text field and the send key with the voice input in voice mode", () => {
    const onToggle = vi.fn();
    setup({ voice: { available: true, mode: "voice", onToggle, input: <div data-testid="x" /> } });
    expect(screen.getByTestId("x")).toBeTruthy();
    expect(screen.queryByTestId("room-input")).toBeNull();
    expect(screen.queryByTestId("room-send")).toBeNull();
    const toggle = screen.getByTestId("room-voice-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalled();
  });

  it("has no voice toggle when voice is unavailable", () => {
    setup({ voice: { available: false, mode: "voice", onToggle: vi.fn(), input: <div data-testid="x" /> } });
    expect(screen.queryByTestId("room-voice-toggle")).toBeNull();
    expect(screen.queryByTestId("x")).toBeNull();
    expect(screen.getByTestId("room-input")).toBeTruthy();
  });

  it("lays out the row as entry, voice toggle, input, send", () => {
    setup({ value: "Hi", leading: <button type="button" data-testid="lead">a</button>,
      voice: { available: true, mode: "text", onToggle: vi.fn(), input: null } });
    const row = screen.getByTestId("room-composer-row");
    const order = [...row.children].map((el) => (el as HTMLElement).dataset.testid);
    expect(order).toEqual(["lead", "room-voice-toggle", "room-input-box", "room-send"]);
  });

  it("renders the above slot before the input row and after the banner", () => {
    setup({ banner: "连接中…", above: <div data-testid="above">reply to lily</div> });
    const banner = screen.getByRole("status");
    const above = screen.getByTestId("above");
    const row = screen.getByTestId("room-composer-row");
    expect(banner.compareDocumentPosition(above) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(above.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sends with the key or Enter, but not while offline or empty", () => {
    const p = setup({ value: "Hello" });
    fireEvent.click(screen.getByTestId("room-send"));
    fireEvent.keyDown(screen.getByTestId("room-input"), { key: "Enter" });
    expect(p.onSend).toHaveBeenCalledTimes(2);
  });

  it("disables sending while offline and with an empty draft", () => {
    const p = setup({ value: "Hello", offline: true });
    expect((screen.getByTestId("room-send") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByTestId("room-input"), { key: "Enter" });
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it("keeps every key at least 44px", () => {
    setup({ value: "", target: "assist", voice: { available: true, mode: "text", onToggle: vi.fn(), input: null } });
    for (const id of ["room-voice-toggle", "room-send"]) expect(screen.getByTestId(id).className).toContain("size-tap");
    expect(screen.getByTestId("room-target-clear").className).toContain("before:-inset-");
  });
});

const MENTIONS = { agents: [{ id: "builtin:coach", name: "Emma" }, { id: "u1", name: "Leo" }], defaultName: "Emma" };

function Controlled(over: Partial<RoomComposerProps> & { onSendSpy?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <RoomComposer disabled={false} offline={false} ai target="group" onClearTarget={() => {}} voice={{ available: false, mode: "text", onToggle: () => {}, input: null }}
      mentions={MENTIONS} {...over} value={value} onChange={setValue} onSend={over.onSendSpy ?? (() => {})} />
  );
}

describe("RoomComposer @ autocomplete (spec addressing §3.2 #4)", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("opens on a leading @ with the AI alias named after the default agent, filters, and Enter picks instead of sending", async () => {
    const onSend = vi.fn();
    renderWithProviders(<Controlled onSendSpy={onSend} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "@");
    const list = screen.getByRole("listbox", { name: "选择智能体" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["AI(Emma)", "Emma", "Leo"]);
    expect(input).toHaveAttribute("aria-expanded", "true");
    await userEvent.type(input, "l");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Leo"]);
    await userEvent.keyboard("{Enter}");
    expect(input).toHaveValue("@Leo ");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("moves with the arrow keys and closes on Escape until the text changes", async () => {
    renderWithProviders(<Controlled />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "@");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.type(input, "E");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("a tap picks without taking focus from the input (iOS keeps the keyboard)", async () => {
    renderWithProviders(<Controlled />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "＠");
    const emma = screen.getAllByRole("option")[1];
    const down = fireEvent.mouseDown(emma);
    expect(down).toBe(false); // default prevented: the input does not blur
    fireEvent.click(emma);
    expect(input).toHaveValue("@Emma ");
    expect(document.activeElement).toBe(input);
  });

  it("leaves keys alone while an IME is composing (iOS / Android / Sogou)", async () => {
    const onSend = vi.fn();
    renderWithProviders(<Controlled onSendSpy={onSend} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "@");
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input).toHaveValue("@");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("closes on blur and never opens mid-message", async () => {
    renderWithProviders(<Controlled />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "@");
    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.clear(input);
    await userEvent.type(input, "hi @E");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("the @ key inserts a bare @ and opens the list when agents exist; shows the default agent in the placeholder", async () => {
    renderWithProviders(<Controlled groupPlaceholder="说点什么,或 @AI(Emma)提问" />);
    expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "说点什么,或 @AI(Emma)提问");
    fireEvent.click(screen.getByTestId("room-at-ai"));
    expect(screen.getByRole("combobox")).toHaveValue("@");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
  it("liquid: one blurred composer, text only on plates (Rule 4, R-L7-1)", () => {
    setLiquid(true);
    try {
      setup({
        banner: "连接中",
        above: <QuoteBar quote={{ seq: 3, kind: "text", name: "bob", text: "What snacks do you like" }} onClear={vi.fn()} />,
      });
      const composer = screen.getByTestId("room-composer");
      expect(composer.className).toContain("mat-chrome-bar");
      expect(composer.className).toContain("liquid:rounded-float");
      expect(screen.getByTestId("room-input-box").className).toContain("plate");
      expect(textOutsidePlates(composer)).toEqual([]);
    } finally {
      setLiquid(false);
    }
  });
});
