import { screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { ALL_OFF, getLinkFlags, setLinkFlags } from "~/lib/extension-points";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LinksConfigLoader } from "./links-config";
import { LinksMeRow } from "./links-me-row";

afterEach(() => setLinkFlags(ALL_OFF));

it("loads effective flags after login and resets them on unmount; a failure keeps everything off but loaded", async () => {
  const mock = createFetchMock({ "GET /api/links/config": () => json({ enabled: true, links: [{ key: "mistakes", global: true, user: true, effective: true }] }) });
  const view = renderWithProviders(<LinksConfigLoader />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  await waitFor(() => expect(getLinkFlags().links.mistakes).toBe(true));
  view.unmount();
  expect(getLinkFlags()).toBe(ALL_OFF);
  const broken = createFetchMock({});
  renderWithProviders(<LinksConfigLoader />, { api: new ApiClient({ getToken: () => "t", fetchImpl: broken.fetch }) });
  await waitFor(() => expect(broken.calls).toHaveLength(1));
  // Review Z2: still all off, but no longer the "not loaded yet" ALL_OFF itself, so a link route opened directly
  // goes back to practice instead of staying blank forever
  await waitFor(() => expect(getLinkFlags()).not.toBe(ALL_OFF));
  expect(getLinkFlags()).toEqual(ALL_OFF);
});

it("the me row counts the links that are on", async () => {
  const links = ["word_actions", "daily_tasks", "mistakes", "pron_shadow", "chat_words", "rank_sources"]
    .map((key, i) => ({ key, global: true, user: true, effective: i < 4 }));
  const mock = createFetchMock({ "GET /api/links/config": () => json({ enabled: true, links }) });
  renderWithProviders(<><LinksConfigLoader /><LinksMeRow /></>, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  await waitFor(() => expect(screen.getByTestId("me-links")).toHaveTextContent("4/6"));
  expect(screen.getByTestId("me-links")).toHaveAttribute("href", "/me/links");
});
