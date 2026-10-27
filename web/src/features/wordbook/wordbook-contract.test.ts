import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { DEF_POS_CODES, isDefLang } from "./def-lang";
import type {
  AnswerResult, BlankResult, BonusResult, BookProgress, Card, ClozeLine, DefEn, DayPlan, Enrollment, GoalLimits, ItemState, OptionInfo, Progress, Question,
  FreeItem, FreeSet, LearnedItem, LearnedPage, LearnedSummary, ResetResult, Segment, SpellResult, SpellWordResult, Streak, Today, WordbookBook, WordbookConfig,
} from "./wordbook-api";

/**
 * 契约(计划 P-W5):`server/tests/fixtures/wordbook_contract.json` 由服务端 S6 对真实应用录制;这里逐键核对网页类型。
 * `Record<keyof T, true>` 在编译期把键表绑定到 wordbook-api.ts 的类型;样例文件存在时运行期再与它逐键比对。
 * 各车道已合并,样例必须存在(集成裁定 Z-g:不再 skipIf)。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../../../server/tests/fixtures/wordbook_contract.json");
const contract: Record<string, unknown> | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;

/** goals 计划 Z1:GS5 已用 goals 的键重录样例,Ruling GW2-a 的临时开关已删除,全部键逐一比对。 */
const keys = (r: Record<string, true>) => Object.keys(r).sort();
const cc = <T>(v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as T;
const keysOf = (o: object) => Object.keys(o).sort();

const TODAY: Record<keyof Today, true> = { enrollment: true, book: true, plan: true, progress: true, tomorrowDue: true, paused: true, streak: true };
const PLAN: Record<keyof DayPlan, true> = {
  newTarget: true, newDone: true, newLeft: true, reviewDue: true, reviewDone: true, reviewLeft: true, backlogGuard: true, bonus: true, goalMet: true,
};
const PROGRESS: Record<keyof Progress, true> = { words: true, learned: true, mastered: true, remaining: true };
const ENROLLMENT: Record<keyof Enrollment, true> = {
  bookId: true, status: true, orderMode: true, dailyNew: true, reviewCap: true, startedAt: true, reviewUnlimited: true,
};
const STREAK: Record<keyof Streak, true> = { current: true, todayMet: true };
const LIMITS: Record<keyof GoalLimits, true> = { dailyNew: true, reviewCap: true, reviewUnlimited: true, bonusMax: true };
const BONUS: Record<keyof BonusResult, true> = { plan: true, bonusLeft: true };
const RESET: Record<keyof ResetResult, true> = { removed: true, enrollment: true };
const BOOK: Record<keyof WordbookBook, true> = { id: true, titleZh: true, titleEn: true, level: true, words: true, available: true };
const BOOK_PROGRESS: Record<keyof BookProgress, true> = { id: true, titleZh: true, titleEn: true, level: true, words: true, learned: true, mastered: true, enrolled: true, active: true };
// defsEn 是可选键(缺省 = 没有英文释义):键表不含它,由 expectCard 单独核对(R-DW11)
const CARD: Record<Exclude<keyof Card, "defsEn">, true> = { key: true, word: true, us: true, uk: true, senses: true, phrases: true, examples: true };
const DEF_EN: Record<keyof DefEn, true> = { pos: true, text: true };

/** 卡片形状:基础键相等;若有 defsEn,逐项核对键、词性码、非空文本与每词性 ≤ 2 条。 */
function expectCard(card: Card) {
  expect(keysOf(card).filter((k) => k !== "defsEn")).toEqual(keys(CARD));
  const perPos = new Map<string, number>();
  for (const d of card.defsEn ?? []) {
    expect(keysOf(d)).toEqual(keys(DEF_EN));
    expect(DEF_POS_CODES).toContain(d.pos);
    expect(d.text.trim().length).toBeGreaterThan(0);
    perPos.set(d.pos, (perPos.get(d.pos) ?? 0) + 1);
  }
  for (const n of perPos.values()) expect(n).toBeLessThanOrEqual(2);
}

/**
 * 守卫:这些断言需要服务端按「英英释义」计划重录的夹具(config.def_lang、cards[].defs_en、def_lang_patch)。
 * 服务端合并并重录后 `fixtureHas` 自动变真,断言自动开启(无需再改本文件);此前它们显示为 skipped。
 */
const fixtureHas = (...p: string[]) => {
  let cur: unknown = contract;
  for (const k of p) {
    if (cur === null || typeof cur !== "object" || !(k in (cur as object))) return false;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur !== undefined;
};
const serverHasDefs = fixtureHas("config", "def_lang");
// `clip` is optional (L4 R16: only a review cloze question built from the learner's own library clip carries it)
const QUESTION: Record<Exclude<keyof Question, "clip">, true> = { key: true, qtype: true, prompt: true, options: true, length: true };
// optionInfo / phrases / example 是可选键(spec 2026-10-13-review-after-answer §2.2:缺省 = 没有这项信息):键表不含它们,由 answerKeys 过滤、专门的用例核对
const ANSWER_OPTIONAL = ["optionInfo", "phrases", "example"] as const;
const answerKeys = (a: object) => keysOf(a).filter((k) => !(ANSWER_OPTIONAL as readonly string[]).includes(k));
const OPTION_INFO: Record<keyof OptionInfo, true> = { option: true, word: true, defsZh: true, defsEn: true };
const ANSWER: Record<Exclude<keyof AnswerResult, (typeof ANSWER_OPTIONAL)[number]>, true> = {
  correct: true, outcome: true, grade: true, expected: true, correctOption: true, diff: true, item: true, applied: true,
  rating: true, spotCheck: true, check: true,
};
const LEARN_PREFS: Record<keyof Extract<WordbookConfig, { enabled: true }>["learn"], true> = { autoplay: true, showExample: true };
const ITEM: Record<keyof ItemState, true> = { box: true, dueAt: true };
const LINE: Record<keyof ClozeLine, true> = { key: true, sentenceId: true, segments: true, zh: true };
const BLANK_SEGMENT: Record<keyof Extract<Segment, { t: "blank" }>, true> = { t: true, i: true, len: true, form: true };
const SPELL: Record<keyof SpellResult, true> = { credit: true, counted: true, words: true };
const WORD: Record<keyof SpellWordResult, true> = { key: true, outcome: true, credit: true, blanks: true, card: true, item: true };
const BLANK: Record<keyof BlankResult, true> = { i: true, outcome: true, credit: true, typed: true, expected: true, diff: true };
const LEARNED_SUMMARY_KEYS: Record<keyof LearnedSummary, true> = { total: true, byBox: true, byTier: true, byBook: true, weak: true, yesterday: true, last7: true };
const LEARNED_ITEM: Record<keyof LearnedItem, true> = { bookId: true, key: true, word: true, box: true, tier: true, learnedAt: true, dueAt: true, weak: true };
const LEARNED_PAGE: Record<keyof LearnedPage, true> = { items: true, nextCursor: true };
const FREE_SET_KEYS: Record<keyof FreeSet, true> = { setId: true, scope: true, mode: true, items: true };
const FREE_ITEM: Record<keyof FreeItem, true> = { bookId: true, card: true, question: true };

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
    expectCard(cc<Card>(c.card));
    const q = cc<{ quiz: Question[] }>(c.learn_batch).quiz[0];
    expect(keysOf(q)).toEqual(keys(QUESTION));
    const answer = cc<AnswerResult>(c.answer_typed);
    expect(answerKeys(answer)).toEqual(keys(ANSWER));
    expect(answer.correctOption).toBeNull();
    // 选择题:correct_option 是题目选项里的那一项原文(Ruling Z-e)
    const choice = cc<AnswerResult>(c.answer_choice);
    expect(answerKeys(choice)).toEqual(keys(ANSWER));
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

  it("choice answers carry option info, phrases and an example (spec 2026-10-13-review-after-answer §2.2)", () => {
    const choice = cc<AnswerResult>(c.answer_choice);
    expect(choice.optionInfo?.length).toBeGreaterThan(1);
    for (const info of choice.optionInfo ?? []) {
      expect(keysOf(info)).toEqual(keys(OPTION_INFO));
      for (const d of info.defsZh) expect(keysOf(d)).toEqual(["pos", "text"]);
      for (const d of info.defsEn) {
        expect(keysOf(d)).toEqual(["pos", "text"]);
        expect(DEF_POS_CODES).toContain(d.pos);
      }
    }
    expect((choice.optionInfo ?? []).map((i) => i.option)).toContain(choice.correctOption);
    expect(cc<{ quiz: Question[] }>(c.learn_batch).quiz.find((q) => q.key === "talk")?.options).toEqual((choice.optionInfo ?? []).map((i) => i.option));
    expect(choice.phrases?.length).toBeLessThanOrEqual(3);
    expect(keysOf(choice.phrases?.[0] ?? {})).toEqual(["en", "zh"]);
    expect(keysOf(choice.example ?? {})).toEqual(["en", "id", "zh"]);
    // 非选择题保持旧形状
    expect(keysOf(cc<AnswerResult>(c.answer_typed))).not.toContain("optionInfo");
  });

  it("recall payloads match (spec recall §9)", () => {
    const recall = cc<AnswerResult>(c.answer_recall);
    expect(answerKeys(recall)).toEqual(keys(ANSWER));
    expect(recall.rating).toBe("fuzzy");
    expect(recall.outcome).toBe("fuzzy");
    expect(recall.spotCheck).toBe(false);
    expect(recall.check).toBeNull();
    if (recall.item) expect(keysOf(recall.item)).toEqual(keys(ITEM));
    const pending = cc<AnswerResult>(c.answer_check);
    expect(answerKeys(pending)).toEqual(keys(ANSWER));
    expect(pending.outcome).toBe("pending");
    expect(pending.grade).toBeNull();
    expect(pending.rating).toBe("know");
    expect(pending.spotCheck).toBe(true);
    expect(keysOf(pending.check as Question)).toEqual(keys(QUESTION));
    expect(pending.check?.qtype).toBe("meaning");
    // 抽查题不能提前泄露答案(spec recall §5.5)
    expect(pending.correctOption).toBeNull();
    // 客观题的 answer 样例也带三档自评的键,值为「非自评」
    const typed = cc<AnswerResult>(c.answer_typed);
    expect(typed.rating).toBeNull();
    expect(typed.spotCheck).toBe(false);
    expect(typed.check).toBeNull();
    const batch = cc<{ cards: Card[]; quiz: Question[]; drill: Question[] }>(c.learn_batch);
    expect(batch.drill.length).toBe(batch.cards.length);
    batch.drill.forEach((q, i) => {
      expect(keysOf(q)).toEqual(keys(QUESTION));
      expect(q.qtype).toBe("word");
      expect(q.key).toBe(batch.cards[i].key);
    });
    const config = cc<Extract<WordbookConfig, { enabled: true }>>(c.config);
    expect(keysOf(config.learn)).toEqual(keys(LEARN_PREFS));
  });

  it("goals v2 payloads match (plan 2026-10-11 GW2, recorded by GS5)", () => {
    const limits = cc<Extract<WordbookConfig, { enabled: true }>>(c.config).limits!;
    expect(keysOf(limits)).toEqual(keys(LIMITS));
    expect(keysOf(limits.dailyNew)).toEqual(["max", "min"]);
    expect(keysOf(limits.reviewCap)).toEqual(["max", "min"]);
    expect(keysOf(cc<Enrollment>(c.enrollment))).toEqual(keys(ENROLLMENT));
    expect(keysOf(cc<Today>(c.today).streak)).toEqual(keys(STREAK));
    expect(keysOf(cc<Enrollment>(c.enrollment_patch))).toEqual(keys(ENROLLMENT));
    const bonus = cc<BonusResult>(c.bonus);
    expect(keysOf(bonus)).toEqual(keys(BONUS));
    expect(keysOf(bonus.plan)).toEqual(keys(PLAN));
    expect(cc<Enrollment>(c.pause).status).toBe("paused");
    const paused = cc<Today>(c.today_paused);
    expect(paused.enrollment).toBeNull();
    expect(keysOf(paused.paused as Enrollment)).toEqual(keys(ENROLLMENT));
    expect(keysOf(cc<Enrollment>(c.resume))).toEqual(keys(ENROLLMENT));
    const reset = cc<ResetResult>(c.reset);
    expect(keysOf(reset)).toEqual(keys(RESET));
    expect(keysOf(reset.enrollment)).toEqual(keys(ENROLLMENT));
  });

  it("learned words and free review payloads match", () => {
    const summary = cc<LearnedSummary>(c.learned_summary);
    expect(keysOf(summary)).toEqual(keys(LEARNED_SUMMARY_KEYS));
    expect(summary.byBox).toHaveLength(6);
    expect(Array.isArray(summary.byBook) && summary.byBook[0] && Object.keys(summary.byBook[0]).sort()).toEqual(["bookId", "count"]);
    expect(Object.keys(summary.byTier).sort()).toEqual(["growing", "learning", "mastered"]);
    const page = cc<LearnedPage>(c.learned_list);
    expect(keysOf(page)).toEqual(keys(LEARNED_PAGE));
    expect(typeof page.nextCursor).toBe("string");
    expect(keysOf(page.items[0])).toEqual(keys(LEARNED_ITEM));
    expectCard(cc<Card>(c.learned_card));
    const free = cc<FreeSet>(c.free_start);
    expect(keysOf(free)).toEqual(keys(FREE_SET_KEYS));
    expect(keysOf(free.items[0])).toEqual(keys(FREE_ITEM));
    expectCard(free.items[0].card);
    expect(keysOf(free.items[0].question as Question)).toEqual(keys(QUESTION));
    // 单词拼写出题(计划 2026-10-27 R-W3):与 free_start 同形,题型固定 spell,词只在响应体里
    const wordSpell = cc<{ setId: string; bookId: string; items: FreeItem[] }>(c.word_spell_start);
    expect(wordSpell.bookId).toBe("junior");
    expect(keysOf(wordSpell.items[0])).toEqual(keys(FREE_ITEM));
    expectCard(wordSpell.items[0].card);
    expect(keysOf(wordSpell.items[0].question as Question)).toEqual(keys(QUESTION));
    expect(wordSpell.items[0].question?.qtype).toBe("spell");
    const answer = cc<AnswerResult>(c.answer_free);
    expect(answerKeys(answer)).toEqual(keys(ANSWER));
    expect(answer.applied).toBe(true);
  });

  it("never sends word-keyed maps the client would have to trust (F4-1)", () => {
    // review_batch.cards 是列表(每张卡带 key),reviewBatch 按 key 建映射(review m11)
    const review = c.review_batch as { cards?: unknown } | undefined;
    expect(Array.isArray(review?.cards)).toBe(true);
    const cards = review!.cards as { key?: string }[];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(typeof card.key).toBe("string");
      expectCard(cc<Card>(card));
    }
  });

  // GUARDED (needs the re-recorded server fixture): turns on by itself once config.def_lang exists in the fixture.
  it.skipIf(!serverHasDefs)("definitions: defsEn on cards and defLang in the config (spec 2026-10-12-wordbook-definitions §4)", () => {
    const batch = cc<{ cards: Card[] }>(c.learn_batch);
    for (const card of batch.cards) expectCard(card);
    expect(batch.cards.some((card) => (card.defsEn?.length ?? 0) > 0)).toBe(true);
    const config = cc<Extract<WordbookConfig, { enabled: true }>>(c.config);
    expect(isDefLang(config.defLang)).toBe(true);
    expect(config.defLang).toBe("en");
  });

  // GUARDED (needs the re-recorded server fixture): the PATCH /enrollment {def_lang} response recorded by the server (AD-1).
  it.skipIf(!fixtureHas("def_lang_patch"))("definitions: PATCH enrollment with def_lang echoes def_lang (AD-1)", () => {
    const patch = c.def_lang_patch as Record<string, unknown>;
    expect(isDefLang(patch.def_lang)).toBe(true);
    expect(patch.def_lang).toBe("zh");
  });

  it("the review cloze question with the learner's own clip has the three clip keys (plan L4 R16)", () => {
    const question = cc<{ key: string; qtype: string; clip?: Record<string, unknown> }>(contract?.review_cloze_clip);
    expect(question.qtype).toBe("cloze");
    expect(keysOf(question.clip ?? {})).toEqual(["endMs", "itemId", "startMs"]);
    expect(typeof question.clip?.itemId).toBe("string");
    expect(typeof question.clip?.startMs).toBe("number");
    expect(typeof question.clip?.endMs).toBe("number");
  });
});