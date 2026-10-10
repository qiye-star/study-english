import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import type {
  AnswerResult, BlankResult, BookProgress, Card, ClozeLine, DayPlan, Enrollment, ItemState, Progress, Question, Segment, SpellResult,
  SpellWordResult, Today, WordbookBook,
} from "./wordbook-api";

/**
 * 契约(计划 P-W5):`server/tests/fixtures/wordbook_contract.json` 由服务端 S6 对真实应用录制;这里逐键核对网页类型。
 * `Record<keyof T, true>` 在编译期把键表绑定到 wordbook-api.ts 的类型;样例文件存在时运行期再与它逐键比对。
 * 各车道已合并,样例必须存在(集成裁定 Z-g:不再 skipIf)。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../../../server/tests/fixtures/wordbook_contract.json");
const contract: Record<string, unknown> | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;

const keys = (r: Record<string, true>) => Object.keys(r).sort();
const cc = <T>(v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as T;
const keysOf = (o: object) => Object.keys(o).sort();

const TODAY: Record<keyof Today, true> = { enrollment: true, book: true, plan: true, progress: true, tomorrowDue: true };
const PLAN: Record<keyof DayPlan, true> = { newTarget: true, newDone: true, newLeft: true, reviewDue: true, reviewDone: true, reviewLeft: true, backlogGuard: true };
const PROGRESS: Record<keyof Progress, true> = { words: true, learned: true, mastered: true, remaining: true };
const ENROLLMENT: Record<keyof Enrollment, true> = { bookId: true, status: true, orderMode: true, dailyNew: true, reviewCap: true, startedAt: true };
const BOOK: Record<keyof WordbookBook, true> = { id: true, titleZh: true, titleEn: true, level: true, words: true, available: true };
const BOOK_PROGRESS: Record<keyof BookProgress, true> = { id: true, titleZh: true, titleEn: true, level: true, words: true, learned: true, mastered: true, enrolled: true, active: true };
const CARD: Record<keyof Card, true> = { key: true, word: true, us: true, uk: true, senses: true, phrases: true, examples: true };
const QUESTION: Record<keyof Question, true> = { key: true, qtype: true, prompt: true, options: true, length: true };
const ANSWER: Record<keyof AnswerResult, true> = { correct: true, outcome: true, grade: true, expected: true, correctOption: true, diff: true, item: true, applied: true };
const ITEM: Record<keyof ItemState, true> = { box: true, dueAt: true };
const LINE: Record<keyof ClozeLine, true> = { key: true, sentenceId: true, segments: true, zh: true };
const BLANK_SEGMENT: Record<keyof Extract<Segment, { t: "blank" }>, true> = { t: true, i: true, len: true, form: true };
const SPELL: Record<keyof SpellResult, true> = { credit: true, counted: true, words: true };
const WORD: Record<keyof SpellWordResult, true> = { key: true, outcome: true, credit: true, blanks: true, card: true, item: true };
const BLANK: Record<keyof BlankResult, true> = { i: true, outcome: true, credit: true, typed: true, expected: true, diff: true };

describe("wordbook client types (spec §7)", () => {
  it("match the documented response shapes", () => {
    expect(keys(TODAY)).toEqual(["book", "enrollment", "plan", "progress", "tomorrowDue"]);
    expect(keys(PLAN)).toEqual(["backlogGuard", "newDone", "newLeft", "newTarget", "reviewDone", "reviewDue", "reviewLeft"]);
    expect(keys(CARD)).toEqual(["examples", "key", "phrases", "senses", "uk", "us", "word"]);
    expect(keys(QUESTION)).toEqual(["key", "length", "options", "prompt", "qtype"]);
    expect(keys(ANSWER)).toEqual(["applied", "correct", "correctOption", "diff", "expected", "grade", "item", "outcome"]);
    expect(keys(LINE)).toEqual(["key", "segments", "sentenceId", "zh"]);
    expect(keys(WORD)).toEqual(["blanks", "card", "credit", "item", "key", "outcome"]);
    expect(keys(BLANK)).toEqual(["credit", "diff", "expected", "i", "outcome", "typed"]);
  });
});

describe("wordbook contract (server fixture)", () => {
  const c = contract ?? {};
  it("has the server-recorded fixture (lanes merged; never skipped)", () => {
    expect(contract).not.toBeNull();
  });

  it("today/plan/books match the client types", () => {
    const today = cc<Today>(c.today);
    expect(keysOf(today)).toEqual(keys(TODAY));
    expect(keysOf(today.plan as DayPlan)).toEqual(keys(PLAN));
    if (today.progress) expect(keysOf(today.progress)).toEqual(keys(PROGRESS));
    if (today.enrollment) expect(keysOf(today.enrollment)).toEqual(keys(ENROLLMENT));
    if (today.book) expect(keysOf(today.book)).toEqual(keys(BOOK));
    if (c.books) expect(keysOf(cc<{ books: BookProgress[] }>(c.books).books[0])).toEqual(keys(BOOK_PROGRESS));
  });

  it("cards, questions, answers and spelling payloads match", () => {
    expect(keysOf(cc<Card>(c.card))).toEqual(keys(CARD));
    const q = cc<{ quiz: Question[] }>(c.learn_batch).quiz[0];
    expect(keysOf(q)).toEqual(keys(QUESTION));
    const answer = cc<AnswerResult>(c.answer_typed);
    expect(keysOf(answer)).toEqual(keys(ANSWER));
    expect(answer.correctOption).toBeNull();
    // 选择题:correct_option 是题目选项里的那一项原文(Ruling Z-e)
    const choice = cc<AnswerResult>(c.answer_choice);
    expect(keysOf(choice)).toEqual(keys(ANSWER));
    expect(cc<{ quiz: Question[] }>(c.learn_batch).quiz.find((q) => q.key === "talk")?.options).toContain(choice.correctOption);
    if (answer.item) expect(keysOf(answer.item)).toEqual(keys(ITEM));
    const set = cc<{ sets: { lines: ClozeLine[] }[] }>(c.spell_sets).sets[0];
    expect(keysOf(set.lines[0])).toEqual(keys(LINE));
    const blank = set.lines[0].segments.find((seg) => seg.t === "blank") as Extract<Segment, { t: "blank" }>;
    expect(keysOf(blank)).toEqual(keys(BLANK_SEGMENT));
    expect(typeof blank.form).toBe("string");
    const result = cc<SpellResult>(c.spell_submit);
    expect(keysOf(result)).toEqual(keys(SPELL));
    expect(keysOf(result.words[0])).toEqual(keys(WORD));
    expect(keysOf(result.words[0].blanks[0])).toEqual(keys(BLANK));
    expect(c.explain_unavailable).toEqual({ error: "AI explanation unavailable" });
  });

  it("never sends word-keyed maps the client would have to trust (F4-1)", () => {
    // reviewBatch 按每张卡自己的 key 重建 cards;这里确认每张卡都带 key
    const review = c.review_batch as { cards?: Record<string, { key?: string }> } | undefined;
    for (const card of Object.values(review?.cards ?? {})) expect(typeof card.key).toBe("string");
  });
});
