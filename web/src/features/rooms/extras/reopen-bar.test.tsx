import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import type { RoomInfo } from "../protocol";
import { canReopen, ReopenBar } from "./reopen-bar";

const info = (over: Partial<RoomInfo> = {}) => ({ id: "r1", status: "closed", closeReason: "owner", ...over }) as RoomInfo;

describe("canReopen", () => {
  it("is for the owner of a room that was not closed by an admin", () => {
    expect(canReopen(info(), null, true)).toBe(true);
    expect(canReopen(info({ closeReason: null }), "idle", true)).toBe(true); // just ended live: the close event carries the reason
    expect(canReopen(info({ closeReason: "admin" }), null, true)).toBe(false);
    expect(canReopen(info({ closeReason: null }), "admin", true)).toBe(false);
    expect(canReopen(info(), null, false)).toBe(false);
    expect(canReopen(null, "owner", true)).toBe(false);
    expect(canReopen(info({ closeReason: null }), "kicked", true)).toBe(false);
  });
});

describe("ReopenBar", () => {
  beforeEach(() => localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })));
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });
  const setup = (routes: Record<string, Handler>, onReopened = vi.fn()) => {
    const mock = createFetchMock(routes);
    renderWithProviders(<ReopenBar roomId="r1" onReopened={onReopened} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    return { mock, onReopened };
  };

  it("reopens and hands the new room to the page", async () => {
    const { onReopened } = setup({ "POST /api/rooms/r1/reopen": () => json({ room: { id: "r1", status: "open", code: "573920" } }) });
    fireEvent.click(screen.getByTestId("room-reopen"));
    await waitFor(() => expect(onReopened).toHaveBeenCalledWith(expect.objectContaining({ id: "r1", code: "573920" })));
  });
  it("treats 'already reopened' (409) as success after re-reading the room (R-O6)", async () => {
    const { onReopened } = setup({
      "POST /api/rooms/r1/reopen": () => json({ error: "Room is not closed" }, 409),
      "GET /api/rooms/r1": () => json({ room: { id: "r1", status: "open", code: "573920" }, members: [] }),
    });
    fireEvent.click(screen.getByTestId("room-reopen"));
    await waitFor(() => expect(onReopened).toHaveBeenCalled());
  });
  it("shows why it failed", async () => {
    const { onReopened } = setup({ "POST /api/rooms/r1/reopen": () => json({ error: "Too many rooms" }, 429) });
    fireEvent.click(screen.getByTestId("room-reopen"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe(""));
    expect(onReopened).not.toHaveBeenCalled();
  });
});
