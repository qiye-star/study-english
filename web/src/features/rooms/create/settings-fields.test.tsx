import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import type { RoomsConfig } from "../rooms-api";
import { SettingsFields } from "./settings-fields";

const CONFIG: RoomsConfig = { enabled: true, aiAvailable: true, maxMembers: 8, maxText: 500, nameMax: 30, defaultMaxMembers: 4,
  scenarios: [{ key: "free", titleZh: "自由聊天", titleEn: "Free talk" }, { key: "cafe", titleZh: "咖啡店点单", titleEn: "At a café" }],
  levels: ["A1", "A2", "B1", "B2", "C1"], voiceAvailable: false, maxVoiceMs: 60000, summaryAvailable: false,
  reactions: ["like", "love", "haha", "wow", "clap", "thanks"] };

describe("SettingsFields", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("renders the seven settings with defaults and hides voice when unavailable", () => {
    const onChange = vi.fn();
    renderWithProviders(<SettingsFields value={{ scenario: "free", joinMode: "code", maxMembers: 4, aiPublic: true, allowVoice: true }}
      onChange={onChange} config={CONFIG} mode="create" namePlaceholder="alice的房间" minMembers={2} />);
    expect(screen.getByPlaceholderText("alice的房间")).toBeTruthy();
    expect(screen.getByRole("button", { name: "咖啡店点单" })).toBeTruthy();
    expect(screen.getByText("需房主同意")).toBeTruthy();
    expect(screen.getByTestId("room-max-members").textContent).toBe("4");
    expect(screen.queryByTestId("room-allow-voice")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "咖啡店点单" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ scenario: "cafe" }));
    fireEvent.click(screen.getByTestId("room-max-members-inc"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ maxMembers: 5 }));
  });

  it("shows each target level with its name and says what happens when none is picked (plan 2026-10-14-level-annotations W5)", () => {
    const onChange = vi.fn();
    renderWithProviders(<SettingsFields value={{ scenario: "free" }} onChange={onChange} config={CONFIG} mode="create" namePlaceholder="" minMembers={2} />);
    const b1 = screen.getByRole("radio", { name: /^B1/ });
    expect(b1.textContent).toBe("B1中级");
    expect(screen.getByRole("radio", { name: /^A1/ }).textContent).toBe("A1入门");
    expect(screen.getByTestId("room-level")).toHaveAttribute("aria-describedby", "room-level-hint");
    expect(screen.getByTestId("room-level-hint")).toHaveTextContent("不选时按你的段位自动定。");
    fireEvent.click(b1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ level: "B1" }));
  });

  it("explains the chosen target level", () => {
    renderWithProviders(<SettingsFields value={{ scenario: "free", level: "B2" }} onChange={vi.fn()} config={CONFIG} mode="edit" namePlaceholder="" minMembers={2} />);
    expect(screen.getByRole("radio", { name: /^B2/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("room-level-hint")).toHaveTextContent("能流利地讨论熟悉的话题");
  });

  it("uses short level names in English so the 5 segments do not truncate (Q3)", () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en" }));
    renderWithProviders(<SettingsFields value={{ scenario: "free" }} onChange={vi.fn()} config={CONFIG} mode="create" namePlaceholder="" minMembers={2} />);
    expect(screen.getByRole("radio", { name: /^B2/ }).textContent).toBe("B2Upper");
  });

  it("does not go below the current member count when editing", () => {
    const onChange = vi.fn();
    renderWithProviders(<SettingsFields value={{ maxMembers: 3 }} onChange={onChange} config={CONFIG} mode="edit" namePlaceholder="" minMembers={3} />);
    expect((screen.getByTestId("room-max-members-dec") as HTMLButtonElement).disabled).toBe(true);
  });

  it("caps the member limit at the site maximum and eight", () => {
    const onChange = vi.fn();
    renderWithProviders(<SettingsFields value={{ maxMembers: 6 }} onChange={onChange} config={{ ...CONFIG, maxMembers: 6 }} mode="create" namePlaceholder="" minMembers={2} />);
    expect((screen.getByTestId("room-max-members-inc") as HTMLButtonElement).disabled).toBe(true);
  });

  it("picks level and join mode, toggles switches and shows voice when available", () => {
    const onChange = vi.fn();
    renderWithProviders(<SettingsFields value={{ scenario: "free", joinMode: "code", maxMembers: 4, aiPublic: true, allowVoice: true }}
      onChange={onChange} config={{ ...CONFIG, voiceAvailable: true }} mode="create" namePlaceholder="x" minMembers={2} />);
    // 水平不传时(服务端按段位默认)不预选任何一档
    expect(screen.getAllByRole("radio", { checked: true }).map((r) => r.textContent)).toEqual(["凭房间号"]);
    fireEvent.click(screen.getByRole("radio", { name: /^B2/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ level: "B2" }));
    fireEvent.click(screen.getByRole("radio", { name: "需房主同意" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ joinMode: "approval" }));
    fireEvent.click(screen.getByTestId("room-ai-public"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ aiPublic: false }));
    fireEvent.click(screen.getByTestId("room-allow-voice"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ allowVoice: false }));
    fireEvent.change(screen.getByPlaceholderText("x"), { target: { value: "美食角" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: "美食角" }));
    expect(screen.getByText("0/30")).toBeTruthy();
  });

  it("commits a renamed room on blur when editing, never an empty name", () => {
    const onChange = vi.fn();
    renderWithProviders(<SettingsFields value={{ name: "美食角" }} onChange={onChange} config={CONFIG} mode="edit" namePlaceholder="" minMembers={2} />);
    const input = screen.getByDisplayValue("美食角");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("美食角");
    fireEvent.change(input, { target: { value: "电影角 " } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: "电影角" }));
  });
});
