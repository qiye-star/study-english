import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TestProviders } from "~/test/render";
import { useRoomVoiceAutoText } from "./auto-text";

describe("useRoomVoiceAutoText", () => {
  afterEach(() => localStorage.removeItem("enjoy-web.settings"));
  it("reads the device preference, off by default", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <TestProviders>{children}</TestProviders>;
    expect(renderHook(useRoomVoiceAutoText, { wrapper }).result.current).toBe(false);
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en", roomVoiceAutoText: true }));
    expect(renderHook(useRoomVoiceAutoText, { wrapper }).result.current).toBe(true);
  });
});
