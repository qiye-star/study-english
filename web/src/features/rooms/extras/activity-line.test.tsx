import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import type { RoomMemberInfo } from "../protocol";
import { ActivityLine } from "./activity-line";

const members: RoomMemberInfo[] = [
  { userId: 11, name: "alice", role: "owner", online: true },
  { userId: 22, name: "lily", role: "member", online: true },
  { userId: 33, name: "bob", role: "member", online: true },
];

describe("ActivityLine", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  const line = () => screen.getByTestId("room-activity"); // ambient text, not a live region (review m5)

  it("leaves myself out", () => {
    renderWithProviders(<ActivityLine activity={{ 11: { state: "typing", at: 2 }, 22: { state: "typing", at: 1 } }} members={members} meId={11} />);
    expect(line().textContent).toBe("lily 正在输入…");
    expect(line().getAttribute("aria-live")).toBeNull();
  });

  it("says who is speaking", () => {
    renderWithProviders(<ActivityLine activity={{ 22: { state: "recording", at: 1 } }} members={members} meId={11} />);
    expect(line().textContent).toBe("lily 正在说话…");
  });

  it("names two people, newest first, and lists mixed states separately", () => {
    const { unmount } = renderWithProviders(<ActivityLine activity={{ 22: { state: "typing", at: 1 }, 33: { state: "typing", at: 5 } }} members={members} meId={11} />);
    expect(line().textContent).toBe("bob、lily 正在输入…");
    unmount();
    renderWithProviders(<ActivityLine activity={{ 22: { state: "typing", at: 5 }, 33: { state: "recording", at: 1 } }} members={members} meId={11} />);
    expect(line().textContent).toBe("lily 正在输入…,bob 正在说话…");
  });

  it("shows two names and a count for three or more; unknown members are 'someone'", () => {
    renderWithProviders(<ActivityLine activity={{ 22: { state: "typing", at: 3 }, 33: { state: "typing", at: 2 }, 44: { state: "typing", at: 1 } }} members={members} meId={11} />);
    expect(line().textContent).toBe("lily、bob 等 3 人正在输入…");
  });

  it("renders nothing without activity from others", () => {
    renderWithProviders(<ActivityLine activity={{ 11: { state: "typing", at: 1 } }} members={members} meId={11} />);
    expect(screen.queryByTestId("room-activity")).toBeNull();
  });

  it("uses 'someone' for a member not in the list", () => {
    renderWithProviders(<ActivityLine activity={{ 44: { state: "recording", at: 1 } }} members={members} meId={11} />);
    expect(line().textContent).toBe("有人 正在说话…");
  });
});
