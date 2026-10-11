import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import camelcaseKeys from "camelcase-keys";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { FreeBrowse } from "./free-browse";
import { FREE_SET_BROWSE } from "./learned-test-fixtures";
import { CONFIG } from "./test-fixtures";
import type { FreeSet } from "./wordbook-api";

vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play: vi.fn(), playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
}));

const SET = camelcaseKeys(FREE_SET_BROWSE, { deep: true }) as unknown as FreeSet;

function setup() {
  const mock = createFetchMock({
    "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
    "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
    "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: [], voices: {} } }),
    "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "", voice: "alloy" } } }),
    "GET /api/wordbook/config": () => json(CONFIG),
  });
  renderWithProviders(<FreeBrowse set={SET} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/review" });
  return mock;
}

beforeEach(() => { resetServerAiConfigCache(); localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("FreeBrowse", () => {
  it("shows the word first, flips to the full card, and walks through the set", async () => {
    setup();
    expect(await screen.findByTestId("recall-card")).toBeTruthy();
    expect(screen.queryByText("accept 的释义")).toBeNull();          // 翻面前没有释义
    await userEvent.click(screen.getByRole("button", { name: "翻面" }));
    expect(await screen.findByText("accept 的释义")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "下一个" }));
    expect(await screen.findByTestId("question-word")).toHaveTextContent("talk");
    expect(screen.getByRole("button", { name: "上一个" })).not.toBeDisabled();
  });

  it("finishes after the last card and never calls the server for answers", async () => {
    const mock = setup();
    await userEvent.click(await screen.findByRole("button", { name: "翻面" }));
    await userEvent.click(screen.getByRole("button", { name: "下一个" }));
    await userEvent.click(screen.getByRole("button", { name: "翻面" }));
    await userEvent.click(screen.getByRole("button", { name: "看完了" }));
    expect(await screen.findByText("这一组看完了")).toBeTruthy();
    expect(mock.calls.some((c) => c.url.pathname.includes("/answers"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "再看一遍" }));
    expect(await screen.findByTestId("question-word")).toHaveTextContent("accept");
  });
});
