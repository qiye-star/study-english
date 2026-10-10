import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookSpellPage } from "./spell-page";

const play = vi.fn();
vi.mock("~/api/server-config", () => ({
  loadServerAiConfig: () => Promise.resolve({ llmModels: [], defaultLlmModel: "", ttsModels: ["tts-1"], voices: [], defaultTts: { model: "tts-1", voice: "alloy" } }),
}));
vi.mock("~/features/chat", () => ({
  useTtsPlayer: () => ({ states: {}, play, playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
  ttsErrorMessage: () => "tts error",
}));

const SET = { set_id: "abc123abc123", lines: [
  { key: "talk", sentence_id: "1".repeat(16), zh: "经过一次长谈后,我们决定离婚。", segments: [{ t: "text", v: "After a long " }, { t: "blank", i: 0, len: 4, form: "talk" }, { t: "text", v: ", we decided on divorce." }] },
  { key: "used to", sentence_id: "2".repeat(16), zh: "我以前住在海边的一个小镇。", segments: [{ t: "text", v: "I " }, { t: "blank", i: 1, len: 4, form: "used" }, { t: "text", v: " " }, { t: "blank", i: 2, len: 2, form: "to" }, { t: "text", v: " live in a small town by the sea." }] },
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
    // 用 web-core 的 LetterDiff(role="img",逐字母 data-op),不是拼写目录里的替身
    const diff = within(talk).getByRole("img", { name: /正确拼写 talk/ });
    expect([...diff.querySelectorAll("[data-op]")].map((n) => n.getAttribute("data-op"))).toEqual(["eq", "sub", "sub", "eq"]);
    expect(within(talk).getByText("拼写接近,注意标出的字母")).toBeTruthy();
    expect(within(screen.getByTestId("spell-result-used to")).getByText("正确")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("75");
    fireEvent.click(within(talk).getByRole("button", { name: "为什么?" }));
    expect(await screen.findByText("AI 讲解暂不可用")).toBeTruthy();
    // 数据讲解照常
    expect(within(screen.getByRole("dialog")).getAllByText(/说话/).length).toBeGreaterThan(0);
  });

  it("handles beforeinput on the real page: backspace on an empty blank goes back, a line break submits", async () => {
    const mock = page({ "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [SET] }),
      "POST /api/wordbook/spell/submit": () => json(RESULT) });
    const input = await screen.findByLabelText("第 1 空,共 3 空");
    fireEvent.change(input, { target: { value: S + "talk " } });
    expect(input).toHaveAttribute("aria-label", "第 2 空,共 3 空");
    const back = new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(back); });
    expect(back.defaultPrevented).toBe(true);
    expect(input).toHaveAttribute("aria-label", "第 1 空,共 3 空");
    const enter = new InputEvent("beforeinput", { inputType: "insertLineBreak", bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(enter); });
    expect(enter.defaultPrevented).toBe(true);
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname.endsWith("/submit"))).toBe(true));
  });

  it("composition keeps the active blank until it ends, then applies the final value", async () => {
    page({ "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [SET] }) });
    const input = await screen.findByLabelText("第 1 空,共 3 空");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: S + "talk " } });
    expect(input).toHaveAttribute("aria-label", "第 1 空,共 3 空");
    fireEvent.compositionEnd(input, { target: { value: S + "talk " } });
    expect(input).toHaveAttribute("aria-label", "第 2 空,共 3 空");
    expect(screen.getAllByRole("textbox")[0].textContent).toBe("talk");
  });

  describe("keeps the active blank visible above the keyboard and the submit bar", () => {
    const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
    const scrolled: { el: Element; arg: unknown }[] = [];
    let vv: EventTarget;
    beforeEach(() => {
      vv = new EventTarget();
      Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
      HTMLElement.prototype.scrollIntoView = function (this: Element, arg?: unknown) { scrolled.push({ el: this, arg }); };
      scrolled.length = 0;
    });
    afterEach(() => {
      if (original) Object.defineProperty(window, "visualViewport", original);
      else delete (window as { visualViewport?: unknown }).visualViewport;
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it("scrolls again when the keyboard resizes the visual viewport, and on a tap of the current blank", async () => {
      page({ "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [SET] }) });
      const input = await screen.findByLabelText("第 1 空,共 3 空");
      const blanks = screen.getAllByRole("textbox");
      // the blank leaves room for the page header and the sticky submit bar when scrolled into view
      expect(blanks[2].className).toMatch(/scroll-mb-/);
      expect(blanks[2].className).toMatch(/scroll-mt-/);
      fireEvent.click(blanks[2]);
      expect(document.activeElement).toBe(input);
      await waitFor(() => expect(scrolled.some((s) => s.el === blanks[2])).toBe(true));
      scrolled.length = 0;
      act(() => { vv.dispatchEvent(new Event("resize")); }); // the keyboard finished opening
      await waitFor(() => expect(scrolled).toContainEqual({ el: blanks[2], arg: { block: "nearest" } }));
      scrolled.length = 0;
      fireEvent.click(blanks[2]); // already the current blank: no state change, still revealed
      await waitFor(() => expect(scrolled.some((s) => s.el === blanks[2])).toBe(true));
    });

    it("pins the hidden input to the top of the viewport, not behind the keyboard", async () => {
      page({ "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [SET] }) });
      const input = await screen.findByLabelText("第 1 空,共 3 空");
      expect(input.className).toMatch(/\btop-0\b/);
      expect(input.className).not.toMatch(/\bbottom-0\b/);
      expect(input.className).toMatch(/pointer-events-none/);
    });
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

  it("hints and reads the sentence's actual form of an irregular word (go → went)", async () => {
    const GO = { set_id: "def456def456", lines: [
      { key: "go", sentence_id: "3".repeat(16), zh: "她早早回家了。", segments: [{ t: "text", v: "She " }, { t: "blank", i: 0, len: 4, form: "went" }, { t: "text", v: " home early." }] },
    ] };
    page({
      "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [GO] }),
    });
    const input = await screen.findByLabelText("第 1 空,共 1 空");
    expect(screen.queryByText(/went/)).toBeNull(); // 提交前不显示答案
    fireEvent.click(screen.getByRole("button", { name: "首字母" }));
    expect((input as HTMLInputElement).value).toBe(S + "w");
    const listen = screen.getByRole("button", { name: "听这句" });
    await waitFor(() => expect(listen).not.toBeDisabled());
    fireEvent.click(listen);
    expect(play).toHaveBeenCalledWith(expect.any(String), "She went home early.", "tts-1", "alloy");
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
    // web-core 的会话小结(WC3 SessionSummary),不是拼写目录里的本地卡片
    const summary = await screen.findByTestId("session-summary");
    expect(within(summary).getByText("本轮拼写完成")).toBeTruthy();
    expect(within(summary).getByRole("status").textContent).toBe("拼写 2 个词 · 一次答对 1");
    expect(within(summary).getByText("talk")).toBeTruthy(); // 需要再看看
    fireEvent.click(screen.getByRole("button", { name: "再来一轮" }));
    await waitFor(() => expect(mock.calls.filter((c) => c.url.pathname.endsWith("/spell/sets"))).toHaveLength(2));
  });

  it("再练一遍 does not count the set twice in the summary and keeps its reports", async () => {
    let submits = 0;
    page({
      "POST /api/wordbook/spell/sets": () => json({ book_id: "junior", sets: [SET] }),
      "POST /api/wordbook/spell/submit": () => { submits += 1; return json({ ...RESULT, counted: submits === 1 }); },
      "POST /api/wordbook/reports": () => json({ id: 7 }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "提交" }));
    const talk = await screen.findByTestId("spell-result-talk");
    fireEvent.click(within(talk).getByRole("button", { name: "举报例句" }));
    fireEvent.click(await screen.findByRole("button", { name: "内容不当" }));
    expect(await within(talk).findByText("已举报,谢谢")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "再练一遍" }));
    fireEvent.click(await screen.findByRole("button", { name: "提交" }));
    const again = await screen.findByTestId("spell-result-talk");
    await waitFor(() => expect(submits).toBe(2));
    expect(within(again).getByText("已举报,谢谢")).toBeTruthy(); // the retry cannot report the sentence again
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    const summary = await screen.findByTestId("session-summary");
    expect(within(summary).getByRole("status").textContent).toBe("拼写 2 个词 · 一次答对 1");
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
