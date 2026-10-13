import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { AddVocabularyButton } from "~/features/vocabulary";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { WordActions } from "~/lib/extension-points-react";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WithShadowSheet } from "~/features/practice/shadow/test-utils";
import "./index";

const ON: LinkFlags = { enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k === "word_actions"])) as LinkFlags["links"] };
const api = (routes: Parameters<typeof createFetchMock>[0], wordbook = true) => {
  const mock = createFetchMock({ "GET /api/wordbook/config": () => json({ enabled: wordbook, ai_available: false, defaults: { daily_new: 20, review_cap: 100 }, books: [] }), ...routes });
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

beforeEach(async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
});
afterEach(async () => {
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

describe("word actions menu", () => {
  it("is absent while the link is off", () => {
    renderWithProviders(<WordActions testId="lookup-vocab" variant="labeled" target={{ word: "talk", source: "lookup" }} />, api({}));
    expect(screen.getByTestId("lookup-vocab")).toBeInTheDocument();
    expect(screen.queryByTestId("lookup-vocab-more")).toBeNull();
  });

  it("keeps the core button byte-identical and only adds a sibling more button", () => {
    const target = { word: "talk", source: "progress" as const };
    const old = renderWithProviders(<AddVocabularyButton testId="progress-word-vocab" label="Add: talk" input={target} />);
    const html = old.container.innerHTML;
    old.unmount();
    setLinkFlags(ON);
    const now = renderWithProviders(<WordActions testId="progress-word-vocab" label="Add: talk" variant="icon" target={target} />);
    const core = screen.getByTestId("progress-word-vocab");
    const more = screen.getByTestId("progress-word-vocab-more");
    expect(core.nextElementSibling).toBe(more);
    expect(now.container.innerHTML.startsWith(html.replace(/<div data-testid="location".*$/, ""))).toBe(true);
    expect(more).toHaveAttribute("aria-label", "更多操作:talk");
  });

  it("opens a sheet with four rows; adopting reports the server status", async () => {
    setLinkFlags(ON);
    const { mock, api: client } = api({ "POST /api/links/wordbook/adopt": () => json({ status: "added", book_id: "junior" }) });
    renderWithProviders(<WordActions testId="progress-word-vocab" variant="icon" target={{ word: "talk", source: "progress" }} />, { api: client });
    fireEvent.click(screen.getByRole("button", { name: "更多操作:talk" }));
    const sheet = await screen.findByRole("dialog", { name: "单词操作" });
    await within(sheet).findByRole("button", { name: /加入词书学习/ });
    const rows = within(sheet).getAllByRole("button").map((b) => b.textContent);
    expect(rows.join("|")).toMatch(/加入词汇本.*加入词书学习.*跟读这个词.*查看词卡/);
    fireEvent.click(within(sheet).getByRole("button", { name: /加入词书学习/ }));
    await waitFor(() => expect(within(sheet).getByText("已加入,下次复习出现")).toBeInTheDocument());
    expect(within(sheet).queryByRole("button", { name: /加入词书学习/ })).toBeNull(); // 有结果后行不可再点
    expect(JSON.parse(String(mock.calls.find((c) => c.url.pathname.endsWith("/adopt"))!.body))).toEqual({ word: "talk" });
  });

  it("explains a word that is not in the current book", async () => {
    setLinkFlags(ON);
    const { api: client } = api({ "POST /api/links/wordbook/adopt": () => json({ status: "not_in_book", book_id: "junior" }) });
    renderWithProviders(<WordActions testId="lookup-vocab" variant="labeled" target={{ word: "zebra", source: "lookup" }} />, { api: client });
    fireEvent.click(screen.getByTestId("lookup-vocab-more"));
    fireEvent.click(await screen.findByRole("button", { name: /加入词书学习/ }));
    expect(await screen.findByText("当前词书里没有这个词")).toBeInTheDocument();
  });

  it("hides the two wordbook rows while the wordbook is off", async () => {
    setLinkFlags(ON);
    renderWithProviders(<WordActions testId="lookup-vocab" variant="labeled" target={{ word: "talk", source: "lookup" }} />, api({}, false));
    fireEvent.click(screen.getByTestId("lookup-vocab-more"));
    const sheet = await screen.findByRole("dialog", { name: "单词操作" });
    await waitFor(() => expect(within(sheet).getByRole("button", { name: /跟读这个词/ })).toBeInTheDocument());
    expect(within(sheet).queryByRole("button", { name: /加入词书学习/ })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /查看词卡/ })).toBeNull();
  });

  it("adds to the vocabulary book from the sheet", async () => {
    setLinkFlags(ON);
    const { mock, api: client } = api({ "POST /api/vocabulary": () => json({ id: "v1", word: "talk", reps: 0, createdAt: new Date().toISOString() }) });
    renderWithProviders(<WordActions testId="lookup-vocab" variant="labeled" target={{ word: "talk", meaning: "说", source: "lookup" }} />, { api: client });
    fireEvent.click(screen.getByTestId("lookup-vocab-more"));
    const sheet = await screen.findByRole("dialog", { name: "单词操作" });
    fireEvent.click(within(sheet).getByRole("button", { name: /加入词汇本/ }));
    expect(await within(sheet).findByText("已在词汇本中")).toBeInTheDocument();
    expect(JSON.parse(String(mock.calls.find((c) => c.url.pathname === "/api/vocabulary")!.body))).toMatchObject({ word: "talk", meaning: "说", source: "lookup" });
  });

  it("shadowing opens the shadow sheet with the example (or the word), without navigating", async () => {
    setLinkFlags(ON);
    renderWithProviders(
      <WithShadowSheet><WordActions testId="summary-word-add-0" variant="icon" target={{ word: "brew", example: "Brew the tea.", source: "recap" }} /></WithShadowSheet>,
      { ...api({}), route: "/rooms/r/1/summary" },
    );
    fireEvent.click(screen.getByTestId("summary-word-add-0-more"));
    fireEvent.click(await screen.findByRole("button", { name: /跟读这个词/ }));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Brew the tea.");
    expect(screen.getByTestId("location")).toHaveTextContent("/rooms/r/1/summary");
    expect(screen.getByTestId("location").dataset.state).toBe("null");
    expect(screen.queryByRole("dialog", { name: "单词操作" })).toBeNull();
  });

  it("shadowing a word without an example reads the word itself", async () => {
    setLinkFlags(ON);
    renderWithProviders(
      <WithShadowSheet><WordActions testId="summary-word-add-1" variant="icon" target={{ word: "brew", source: "recap" }} /></WithShadowSheet>,
      { ...api({}), route: "/rooms/r/1/summary" },
    );
    fireEvent.click(screen.getByTestId("summary-word-add-1-more"));
    fireEvent.click(await screen.findByRole("button", { name: /跟读这个词/ }));
    expect(await screen.findByTestId("shadow-reference")).toHaveTextContent("brew");
  });

  it("returns focus to the more button when the sheet closes", async () => {
    setLinkFlags(ON);
    renderWithProviders(<WordActions testId="lookup-vocab" variant="labeled" target={{ word: "talk", source: "lookup" }} />, api({}));
    const more = screen.getByTestId("lookup-vocab-more");
    fireEvent.click(more);
    const sheet = await screen.findByRole("dialog", { name: "单词操作" });
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(more);
  });
});
