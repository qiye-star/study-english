import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConversationSettingsSheet } from "./conversation-settings-sheet";

const base = { systemPrompt: "SYS", model: "", temperature: 0.7, ttsModel: "openai/tts-1", ttsVoice: "alloy" };

describe("ConversationSettingsSheet", () => {
  it("keeps typed text when the parent re-renders with a new but equal config object", async () => {
    const props = { open: true, onOpenChange: vi.fn(), ai: null as null, onSave: vi.fn() };
    const { rerender } = render(<ConversationSettingsSheet {...props} config={{ ...base }} />);
    const box = screen.getByTestId("settings-system-prompt");
    await userEvent.clear(box);
    await userEvent.type(box, "My prompt");
    rerender(<ConversationSettingsSheet {...props} config={{ ...base }} />);
    expect(screen.getByTestId("settings-system-prompt")).toHaveValue("My prompt");
  });

  it("saves the grammar check and coach mode switches", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ConversationSettingsSheet open onOpenChange={vi.fn()} ai={null} onSave={onSave} config={{ ...base }} />);
    expect(screen.getByTestId("settings-grammar-check")).toHaveAttribute("data-state", "checked");
    expect(screen.getByTestId("settings-coach-mode")).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByTestId("settings-bilingual")).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByTestId("settings-grammar-check")).toHaveAttribute("role", "switch");
    expect(screen.getByRole("switch", { name: /Grammar check/ })).toBe(screen.getByTestId("settings-grammar-check"));
    expect(screen.getByRole("switch", { name: /Coach mode/ })).toBe(screen.getByTestId("settings-coach-mode"));
    await userEvent.click(screen.getByTestId("settings-grammar-check"));
    await userEvent.click(screen.getByTestId("settings-coach-mode"));
    await userEvent.click(screen.getByTestId("settings-save"));
    expect(onSave).toHaveBeenCalledWith({ grammarCheck: false, coachMode: true });
  });

  it("emits only changed keys and never an empty model/voice", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ConversationSettingsSheet open onOpenChange={vi.fn()} ai={null} onSave={onSave} config={{ ...base, model: "", ttsModel: "", ttsVoice: "" }} />);
    await userEvent.click(screen.getByTestId("settings-save"));
    expect(onSave).toHaveBeenCalledWith({});
  });
  it("shows auto-read on and level auto for a conversation without those keys, and saves only what changed", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ConversationSettingsSheet open onOpenChange={vi.fn()} ai={null} onSave={onSave} config={{ ...base }} />);
    expect(screen.getByTestId("settings-auto-speak")).toHaveAttribute("data-state", "checked");
    expect(screen.getByRole("switch", { name: /Read replies aloud automatically/ })).toBe(screen.getByTestId("settings-auto-speak"));
    expect(screen.getByTestId("settings-level")).toHaveValue("auto");
    await userEvent.click(screen.getByTestId("settings-auto-speak"));
    await userEvent.selectOptions(screen.getByTestId("settings-level"), "B1");
    await userEvent.click(screen.getByTestId("settings-save"));
    expect(onSave).toHaveBeenCalledWith({ autoSpeak: false, level: "B1" });
  });

  it("labels the levels and explains the chosen one under the select (plan 2026-10-14-level-annotations W2)", async () => {
    render(<ConversationSettingsSheet open onOpenChange={vi.fn()} ai={null} onSave={vi.fn()} config={{ ...base }} />);
    expect(screen.queryByTestId("settings-level-hint")).toBeNull(); // auto 没有说明
    expect(screen.getByRole("option", { name: "B1 · Intermediate" })).toHaveAttribute("value", "B1");
    expect(screen.getByRole("option", { name: "Auto (no limit)" })).toHaveAttribute("value", "auto");
    await userEvent.selectOptions(screen.getByTestId("settings-level"), "B1");
    expect(screen.getByTestId("settings-level-hint")).toHaveTextContent("Copes with most everyday situations");
    expect(screen.getByTestId("settings-level")).toHaveAttribute("aria-describedby", "settings-level-hint");
  });

  it("shows a stored auto-read off and level", () => {
    render(<ConversationSettingsSheet open onOpenChange={vi.fn()} ai={null} onSave={vi.fn()} config={{ ...base, autoSpeak: false, level: "C1" }} />);
    expect(screen.getByTestId("settings-auto-speak")).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByTestId("settings-level")).toHaveValue("C1");
  });

  it("changes the scenario; the role prompt is hidden for scenario conversations", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ConversationSettingsSheet open onOpenChange={vi.fn()} ai={null} onSave={onSave} config={{ ...base, scenario: { id: "cafe" } }} />);
    expect(screen.getByTestId("settings-scenario")).toHaveValue("cafe");
    expect(screen.queryByTestId("settings-system-prompt")).toBeNull();
    expect(screen.getByTestId("settings-scenario-note")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("settings-scenario"), "free");
    expect(screen.getByTestId("settings-system-prompt")).toHaveValue("SYS");
    await userEvent.click(screen.getByTestId("settings-save"));
    expect(onSave).toHaveBeenCalledWith({ scenario: { id: "free" } });
  });

  it("an unchanged scenario object is not resent; a custom one is sanitized and required", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ConversationSettingsSheet open onOpenChange={vi.fn()} ai={null} onSave={onSave} config={{ ...base, scenario: { id: "hotel" } }} />);
    await userEvent.selectOptions(screen.getByTestId("settings-scenario"), "cafe");
    await userEvent.selectOptions(screen.getByTestId("settings-scenario"), "hotel");
    await userEvent.click(screen.getByTestId("settings-save"));
    expect(onSave).toHaveBeenLastCalledWith({});
    await userEvent.selectOptions(screen.getByTestId("settings-scenario"), "custom");
    expect(screen.getByTestId("settings-save")).toBeDisabled();
    expect(screen.getByTestId("settings-scenario-custom")).toHaveAttribute("maxlength", "500");
    await userEvent.type(screen.getByTestId("settings-scenario-custom"), "  At the	bank  ");
    await userEvent.click(screen.getByTestId("settings-save"));
    expect(onSave).toHaveBeenLastCalledWith({ scenario: { id: "custom", custom: "At the bank" } });
  });

  it("renders without crashing when the stored custom scenario text is not a string", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ConversationSettingsSheet open onOpenChange={vi.fn()} ai={null} onSave={onSave} config={{ ...base, scenario: { id: "custom", custom: 5 as unknown as string } }} />);
    expect(screen.getByTestId("settings-scenario")).toHaveValue("custom");
    expect(screen.getByTestId("settings-scenario-custom")).toHaveValue("");
    expect(screen.getByTestId("settings-save")).toBeDisabled();
  });
});

describe("system prompt limit (realtime start payload, Task 4.11)", () => {
  it("caps the role prompt so the effective prompt with any level still fits the call's start message", async () => {
    const { MAX_SYSTEM_PROMPT } = await import("./conversation-settings-sheet");
    const { effectiveSystemPrompt } = await import("./chat-request");
    const { LEVELS } = await import("./levels");
    const { START_LIMITS } = await import("~/features/realtime/protocol");
    for (const level of LEVELS) {
      const prompt = effectiveSystemPrompt({ ...base, systemPrompt: "x".repeat(MAX_SYSTEM_PROMPT), level });
      expect(Array.from(prompt).length).toBeLessThanOrEqual(START_LIMITS.systemPrompt);
    }
  });

  it("enforces the limit on the field and tells the user how much is used", async () => {
    const { MAX_SYSTEM_PROMPT } = await import("./conversation-settings-sheet");
    render(<ConversationSettingsSheet open onOpenChange={vi.fn()} ai={null} onSave={vi.fn()} config={{ ...base }} />);
    expect(screen.getByTestId("settings-system-prompt")).toHaveAttribute("maxlength", String(MAX_SYSTEM_PROMPT));
    expect(screen.getByTestId("settings-system-prompt-count")).toHaveTextContent(`3 / ${MAX_SYSTEM_PROMPT}`);
    await userEvent.type(screen.getByTestId("settings-system-prompt"), "!");
    expect(screen.getByTestId("settings-system-prompt-count")).toHaveTextContent(`4 / ${MAX_SYSTEM_PROMPT}`);
  });
});
