import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import camelcaseKeys from "camelcase-keys";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { FreeReviewSheet } from "./free-review-sheet";
import { FREE_SET, LEARNED_SUMMARY } from "./learned-test-fixtures";
import type { LearnedSummary } from "./wordbook-api";

const SUMMARY = camelcaseKeys(LEARNED_SUMMARY, { deep: true }) as unknown as LearnedSummary;

function setup(summary: LearnedSummary = SUMMARY, routes: Parameters<typeof createFetchMock>[0] = {}) {
  const mock = createFetchMock({ "POST /api/wordbook/free/start": () => json(FREE_SET), ...routes });
  renderWithProviders(<FreeReviewSheet open onOpenChange={() => {}} summary={summary} />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/learned",
  });
  return mock;
}
const body = (mock: ReturnType<typeof createFetchMock>) => JSON.parse(String(mock.calls.find((c) => c.url.pathname.endsWith("/free/start"))?.body));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("FreeReviewSheet", () => {
  it("starts a random mix of 20 choice questions with the settings the user picks", async () => {
    const mock = setup();
    await userEvent.click(screen.getByRole("radio", { name: "选择题" }));
    await userEvent.click(screen.getByRole("radio", { name: "20 个" }));
    await userEvent.click(screen.getByRole("button", { name: "开始" }));
    await waitFor(() => expect(body(mock)).toMatchObject({ scope: "all", mode: "choice", count: 20 }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/review"));
    expect(JSON.parse(screen.getByTestId("location").getAttribute("data-state") ?? "null").free.setId).toBe("abcdef012345");
  });

  it("sends the book or the tier only for those scopes", async () => {
    const mock = setup();
    await userEvent.click(screen.getByRole("button", { name: "某一本书" }));
    await userEvent.click(screen.getByRole("button", { name: "开始" }));
    await waitFor(() => expect(body(mock)).toMatchObject({ scope: "book", book: "cet4" }));
  });

  it("disables scopes that have no words", () => {
    setup({ ...SUMMARY, yesterday: 0, last7: 0, weak: 0, byTier: { learning: 0, growing: 0, mastered: 6 } });
    expect(screen.getByRole("button", { name: "昨天学的" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "最近 7 天" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "易错词" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "随机抽取" })).not.toBeDisabled();
  });

  it("states the rules in one line and surfaces a translated error", async () => {
    setup(SUMMARY, { "POST /api/wordbook/free/start": () => json({ error: "No words to review" }, 409) });
    expect(screen.getByText(/不计段位点/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "开始" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("这个范围里还没有可复习的词");
  });
});
