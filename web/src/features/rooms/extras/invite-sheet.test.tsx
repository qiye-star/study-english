import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { InviteSheet } from "./invite-sheet";
import { QrCode } from "./qr";

function setup(props: { isOwner: boolean; joinMode: "code" | "approval" }, routes = {}) {
  const mock = createFetchMock({
    "POST /api/rooms/r1/invite": () => json({ token: "tok123", path: "/rooms/invite/tok123" }),
    "POST /api/rooms/r1/invite/rotate": () => json({ token: "tok456", path: "/rooms/invite/tok456" }),
    ...routes,
  });
  const onOpenChange = vi.fn();
  renderWithProviders(<InviteSheet open onOpenChange={onOpenChange} roomId="r1" {...props} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { mock, onOpenChange };
}

describe("InviteSheet", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => {
    localStorage.removeItem("enjoy-web.settings");
    await i18n.changeLanguage("en");
    vi.unstubAllGlobals();
  });

  it("shows the full link, a local QR code and the owner's reset", async () => {
    const { mock } = setup({ isOwner: true, joinMode: "code" });
    const link = await screen.findByTestId("invite-link") as HTMLInputElement;
    await waitFor(() => expect(link.value.endsWith("/rooms/invite/tok123")).toBe(true));
    expect(link.value.startsWith(window.location.origin)).toBe(true);
    expect(link.readOnly).toBe(true);
    expect(document.querySelector("svg[role=img]")).toBeTruthy();
    // only the room's own invite endpoint was called: no third-party QR service
    expect(mock.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(["POST /api/rooms/r1/invite"]);
    fireEvent.click(screen.getByRole("button", { name: "重置链接" }));
    fireEvent.click(await screen.findByTestId("invite-rotate-confirm"));
    await waitFor(() => expect(link.value.endsWith("/rooms/invite/tok456")).toBe(true));
  });

  it("copies the link", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    setup({ isOwner: false, joinMode: "code" });
    await waitFor(() => expect((screen.getByTestId("invite-link") as HTMLInputElement).value).toContain("tok123"));
    expect(screen.queryByRole("button", { name: "重置链接" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/rooms/invite/tok123`));
  });

  it("explains instead of asking when only the owner may share an approval room", () => {
    const { mock } = setup({ isOwner: false, joinMode: "approval" });
    expect(screen.getByText("需房主同意的房间,只有房主可以分享链接")).toBeTruthy();
    expect(mock.calls).toHaveLength(0);
    expect(screen.queryByTestId("invite-link")).toBeNull();
  });

  it("shows a translated error without the token", async () => {
    setup({ isOwner: false, joinMode: "code" }, { "POST /api/rooms/r1/invite": () => json({ error: "Room not found" }, 404) });
    expect(await screen.findByText("房间不存在或已结束")).toBeTruthy();
  });
});

describe("QrCode", () => {
  it("renders one svg path from the module matrix", () => {
    const { container } = render(<QrCode text="https://example.test/rooms/invite/tok123" size={184} label="QR" />);
    const svg = container.querySelector("svg[role=img]")!;
    expect(svg.getAttribute("aria-label")).toBe("QR");
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    expect(svg.querySelector("path")!.getAttribute("fill")).toBe("currentColor");
    const box = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(box[2]).toBeGreaterThanOrEqual(21 + 8); // version >= 1 plus the 4-module quiet zone on each side
  });
});
