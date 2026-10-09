import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
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
