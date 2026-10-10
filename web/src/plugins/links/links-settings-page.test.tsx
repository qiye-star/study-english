import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { ALL_OFF, getLinkFlags, setLinkFlags } from "~/lib/extension-points";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LinksSettingsPage } from "./links-settings-page";

const CONFIG = (mistakes = true) => ({
  enabled: true,
  links: [
    { key: "word_actions", global: true, user: true, effective: true },
    { key: "daily_tasks", global: true, user: true, effective: true },
    { key: "mistakes", global: true, user: mistakes, effective: mistakes },
    { key: "pron_shadow", global: true, user: true, effective: true },
    { key: "chat_words", global: false, user: true, effective: false },
    { key: "rank_sources", global: true, user: true, effective: true },
  ],
});

beforeEach(async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
});
afterEach(async () => {
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

describe("LinksSettingsPage", () => {
  it("lists six switches, disables the ones the admin turned off and saves a toggle", async () => {
    const mock = createFetchMock({
      "GET /api/links/config": () => json(CONFIG()),
      "PUT /api/links/prefs": () => json(CONFIG(false)),
    });
    renderWithProviders(<LinksSettingsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const mistakes = await screen.findByRole("switch", { name: /易错词/ });
    expect(mistakes).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("switch")).toHaveLength(6);
    const chat = screen.getByRole("switch", { name: /对话用到今日词/ });
    expect(chat).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("管理员已关闭")).toBeInTheDocument();
    fireEvent.click(chat);
    expect(mock.calls.filter((c) => c.method === "PUT")).toHaveLength(0); // admin-off switches do nothing
    fireEvent.click(mistakes);
    await waitFor(() => expect(mistakes).toHaveAttribute("aria-checked", "false"));
    expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ key: "mistakes", enabled: false });
    await waitFor(() => expect(getLinkFlags().links.mistakes).toBe(false));
    expect(getLinkFlags().links.word_actions).toBe(true);
  });

  it("rolls back when saving fails", async () => {
    const mock = createFetchMock({
      "GET /api/links/config": () => json(CONFIG()),
      "PUT /api/links/prefs": () => json({ error: "Links are disabled" }, 404),
    });
    renderWithProviders(<LinksSettingsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const mistakes = await screen.findByRole("switch", { name: /易错词/ });
    fireEvent.click(mistakes);
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PUT")).toBe(true));
    await waitFor(() => expect(mistakes).toHaveAttribute("aria-checked", "true"));
    expect(getLinkFlags()).toBe(ALL_OFF);
  });

  it("offers a retry when the config cannot be loaded", async () => {
    let fail = true;
    const mock = createFetchMock({
      "GET /api/links/config": () => (fail ? json({ error: "boom" }, 500) : json(CONFIG())),
    });
    renderWithProviders(<LinksSettingsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const retry = await screen.findByTestId("links-settings-retry");
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findAllByRole("switch")).toHaveLength(6);
  });
});
