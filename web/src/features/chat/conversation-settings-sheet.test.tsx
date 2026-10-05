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
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ grammarCheck: false, coachMode: true }));
  });
});
