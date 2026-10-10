import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LetterDiff } from "./letter-diff-standin";
import { WordbookSpellPage } from "./spell-page";

vi.mock("~/features/chat", () => ({
  useTtsPlayer: () => ({ states: {}, play: vi.fn(), playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
  ttsErrorMessage: () => "tts error",
}));

const SET = { set_id: "abc123abc123", lines: [
  { key: "talk", sentence_id: "1".repeat(16), zh: "经过一次长谈后,我们决定离婚。", segments: [{ t: "text", v: "After a long " }, { t: "blank", i: 0, len: 4 }, { t: "text", v: ", we decided on divorce." }] },
  { key: "used to", sentence_id: "2".repeat(16), zh: "我以前住在海边的一个小镇。", segments: [{ t: "text", v: "I " }, { t: "blank", i: 1, len: 4 }, { t: "text", v: " " }, { t: "blank", i: 2, len: 2 }, { t: "text", v: " live in a small town by the sea." }] },
] };
const CARD = (word: string) => ({ key: word, word, us: "", uk: "", senses: [{ pos: "v", text: "说话" }], phrases: [] as unknown[], examples: [] as unknown[] });
const RESULT = { credit: 75, counted: true, words: [
  { key: "talk", outcome: "typo", credit: 50, item: null as unknown, card: CARD("talk"), blanks: [{ i: 0, outcome: "typo", credit: 50, typed: "tlak", expected: "talk",
    diff: [{ op: "eq", a: "t", b: "t" }, { op: "sub", a: "a", b: "l" }, { op: "sub", a: "l", b: "a" }, { op: "eq", a: "k", b: "k" }] }] },
  { key: "used to", outcome: "correct", credit: 100, item: null, card: CARD("used to"), blanks: [
    { i: 1, outcome: "correct", credit: 100, typed: "used", expected: "used", diff: [] },
    { i: 2, outcome: "correct", credit: 100, typed: "to", expected: "to", diff: [] }] },
] };
const S = "​";

const page = (routes: Record<string, Handler>) => {
  const mock = createFetchMock(routes);
  renderWithProviders(<WordbookSpellPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return mock;
};
const submitBody = (mock: ReturnType<typeof createFetchMock>) =>
  JSON.parse(String(mock.calls.find((c) => c.url.pathname.endsWith("/submit"))!.body));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); localStorage.removeItem("enjoy-web.wordbook.prefs"); void i18n.changeLanguage("en"); });

describe("WordbookSpellPage", () => {
  it("types with space to advance, submits with Enter and shows four-outcome results", async () => {
    const mock = page({
      "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [SET] }),
      "POST /api/wordbook/spell/submit": () => json(RESULT),
      "POST /api/wordbook/explain": () => json({ error: "AI explanation unavailable" }, 503),
    });
    const input = await screen.findByLabelText("第 1 空,共 3 空");
    expect(screen.getByText("词典例句")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: S + "tlak " } });
    fireEvent.change(input, { target: { value: S + "used " } });
    fireEvent.change(input, { target: { value: S + "to" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/spell/submit")).toBe(true));
    const body = submitBody(mock);
    expect(body).toMatchObject({ book_id: "junior", set_id: "abc123abc123" });
    expect(body.lines).toEqual([
      { key: "talk", sentence_id: "1".repeat(16), answers: [{ typed: "tlak", hinted: false }] },
      { key: "used to", sentence_id: "2".repeat(16), answers: [{ typed: "used", hinted: false }, { typed: "to", hinted: false }] },
    ]);
    const talk = await screen.findByTestId("spell-result-talk");
    expect(within(talk).getByText("小笔误")).toBeTruthy();
    expect(within(talk).getByLabelText(/正确拼写 talk/)).toBeTruthy();
    expect(within(talk).getByText("拼写接近,注意标出的字母")).toBeTruthy();
    expect(within(screen.getByTestId("spell-result-used to")).getByText("正确")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("75");
    fireEvent.click(within(talk).getByRole("button", { name: "为什么?" }));
    expect(await screen.findByText("AI 讲解暂不可用")).toBeTruthy();
    // 数据讲解照常
    expect(within(screen.getByRole("dialog")).getAllByText(/说话/).length).toBeGreaterThan(0);
  });

  it("first-letter hint marks the blank as hinted", async () => {
    const mock = page({ "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [SET] }),
      "POST /api/wordbook/spell/submit": () => json(RESULT) });
    fireEvent.click(await screen.findByRole("button", { name: "首字母" }));
    const input = screen.getByLabelText("第 1 空,共 3 空");
    expect((input as HTMLInputElement).value).toBe(S + "t");
    fireEvent.change(input, { target: { value: S + "talk " } });
    fireEvent.change(input, { target: { value: S + "used " } });
    fireEvent.change(input, { target: { value: S + "to" } });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname.endsWith("/submit"))).toBe(true));
    expect(submitBody(mock).lines[0].answers[0]).toEqual({ typed: "talk", hinted: true });
  });

  it("hints the first letter of the matching word of a multi-word headword", async () => {
    page({ "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [SET] }) });
    const input = await screen.findByLabelText("第 1 空,共 3 空");
    fireEvent.click(screen.getAllByRole("textbox")[2]);
    fireEvent.click(screen.getByRole("button", { name: "首字母" }));
    expect(input).toHaveAttribute("aria-label", "第 3 空,共 3 空");
    expect((input as HTMLInputElement).value).toBe(S + "t");
  });

  it("explains how to get words when there are no sets", async () => {
    page({ "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [] }) });
    expect(await screen.findByText("先学几个新词再来拼写")).toBeTruthy();
  });

  it("reports a sentence, then finishes the round with a summary", async () => {
    const mock = page({
      "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [SET] }),
      "POST /api/wordbook/spell/submit": () => json(RESULT),
      "POST /api/wordbook/reports": () => json({ id: 7 }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "提交" }));
    const talk = await screen.findByTestId("spell-result-talk");
    fireEvent.click(within(talk).getByRole("button", { name: "举报例句" }));
    fireEvent.click(await screen.findByRole("button", { name: "内容不当" }));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/reports")).toBe(true));
    const report = JSON.parse(String(mock.calls.find((c) => c.url.pathname === "/api/wordbook/reports")!.body));
    expect(report).toEqual({ book_id: "junior", key: "talk", sentence_id: "1".repeat(16), reason: "offensive" });
    expect(await within(talk).findByText("已举报,谢谢")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(await screen.findByText("本轮拼写完成")).toBeTruthy();
    expect(screen.getByText("拼写 2 个词 · 正确 1 个")).toBeTruthy();
  });

  it("shows translated server errors instead of raw messages", async () => {
    page({
      "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [SET] }),
      "POST /api/wordbook/spell/submit": () => json({ error: "Sentence changed" }, 409),
    });
    fireEvent.click(await screen.findByRole("button", { name: "提交" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("Sentence changed");
    expect(screen.getByLabelText("第 1 空,共 3 空")).toBeInTheDocument();
  });
});

describe("LetterDiff stand-in", () => {
  it("marks missing, extra and wrong letters", () => {
    const { container } = render(<LetterDiff expected="talking" diff={[
      { op: "eq", a: "t", b: "t" }, { op: "eq", a: "a", b: "a" }, { op: "eq", a: "l", b: "l" }, { op: "eq", a: "k", b: "k" },
      { op: "del", a: "i", b: "" }, { op: "eq", a: "n", b: "n" }, { op: "eq", a: "g", b: "g" }]} />);
    const ops = [...container.querySelectorAll("[data-op]")].map((n) => `${n.getAttribute("data-op")}:${n.textContent}`);
    expect(ops).toEqual(["eq:t", "eq:a", "eq:l", "eq:k", "del:i", "eq:n", "eq:g"]);
    expect(container.firstElementChild?.getAttribute("aria-label")).toContain("talking");
  });

  it("renders a substitution as typed-then-expected", () => {
    const { container } = render(<LetterDiff expected="cat" diff={[{ op: "eq", a: "c", b: "c" }, { op: "sub", a: "a", b: "u" }, { op: "eq", a: "t", b: "t" }]} />);
    const sub = container.querySelector("[data-op=sub]")!;
    expect(sub.querySelector("s")?.textContent).toBe("u");
    expect(sub.querySelector("u")?.textContent).toBe("a");
  });
});
