import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { CHANGELOG_PREFS_KEY } from "~/lib/storage";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ChangelogEntry } from "./changelog-entry";

const page = (unread: number, latest: number | null) => json({ entries: [], next: null, unread, latest_id: latest });
function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  const view = renderWithProviders(<ChangelogEntry />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice" });
  return { mock, ...view };
}
beforeEach(() => localStorage.clear());

describe("ChangelogEntry", () => {
  it("renders nothing when nothing is published", async () => {
    const { mock } = setup({ "GET /api/changelog": () => page(0, null) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("changelog-entry")).toBeNull();
  });

  it("renders nothing when the request fails", async () => {
    const { mock } = setup({ "GET /api/changelog": () => json({ error: "boom" }, 500) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("changelog-entry")).toBeNull();
  });

  it("is a quiet icon link when everything is read", async () => {
    setup({ "GET /api/changelog": () => page(0, 5) });
    const link = await screen.findByTestId("changelog-entry");
    expect(link).toHaveAttribute("href", "/practice/changelog");
    expect(link).toHaveAccessibleName("What's new");
    expect(screen.queryByTestId("changelog-dot")).toBeNull();
    expect(screen.queryByTestId("changelog-hint")).toBeNull();
  });

  it("shows the dot, counts unread in its name and shows the hint exactly once", async () => {
    const first = setup({ "GET /api/changelog": () => page(2, 5) });
    const link = await screen.findByTestId("changelog-entry");
    expect(link).toHaveAccessibleName("What's new, 2 unread updates");
    expect(screen.getByTestId("changelog-dot")).toBeInTheDocument();
    expect(await screen.findByTestId("changelog-hint")).toHaveTextContent("2 new updates");
    expect(JSON.parse(localStorage.getItem(CHANGELOG_PREFS_KEY)!)).toEqual({ hintSeen: true });
    first.unmount();
    setup({ "GET /api/changelog": () => page(2, 5) }); // a later visit: the dot is back, the hint is not
    await screen.findByTestId("changelog-dot");
    expect(screen.queryByTestId("changelog-hint")).toBeNull();
  });

  it("puts the hint away on the next press anywhere and keeps the dot", async () => {
    setup({ "GET /api/changelog": () => page(1, 5) });
    expect(await screen.findByTestId("changelog-hint")).toHaveTextContent("1 new update");
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByTestId("changelog-hint")).toBeNull());
    expect(screen.getByTestId("changelog-dot")).toBeInTheDocument();
  });

  it("does not show the hint when this device has shown it before", async () => {
    localStorage.setItem(CHANGELOG_PREFS_KEY, JSON.stringify({ hintSeen: true }));
    setup({ "GET /api/changelog": () => page(4, 9) });
    await screen.findByTestId("changelog-dot");
    expect(screen.queryByTestId("changelog-hint")).toBeNull();
  });
});
