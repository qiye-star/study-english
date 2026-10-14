import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { AfterAnswerPanel } from "./after-answer-panel";
import { card, defsCard } from "./test-fixtures";
import type { AnswerResult, Card, OptionInfo, Question } from "./wordbook-api";

const OPT = "v. 说话；谈话；n. 交谈";
const meaningQ: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk" }, options: [OPT, "n. 事故"], length: null };
const wordQ: Question = { key: "talk", qtype: "word", prompt: { meaning: OPT }, options: ["talk", "stop"], length: null };
const TALK_INFO: OptionInfo = {
  option: OPT, word: "talk", defsZh: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }],
  defsEn: [{ pos: "v", text: "speak to someone" }],
};

const toCard = (raw: Record<string, unknown>): Card => ({
  key: String(raw.key), word: String(raw.word), us: String(raw.us), uk: String(raw.uk),
  senses: raw.senses as Card["senses"], phrases: raw.phrases as Card["phrases"], examples: raw.examples as Card["examples"],
  defsEn: (raw.defs_en as Card["defsEn"]) ?? undefined,
});
const talkCard = (extra: Record<string, unknown> = {}) => toCard(defsCard("talk", {
  senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }],
  defs_en: [{ pos: "v", text: "speak to someone" }, { pos: "n", text: "a conversation between people" }],
  phrases: [{ en: "talk about", zh: "谈论" }, { en: "talk to", zh: "对…说" }, { en: "talk back", zh: "顶嘴" }, { en: "talk down", zh: "贬低" }],
  ...extra,
}));

const result = (extra: Partial<AnswerResult> = {}): Pick<AnswerResult, "optionInfo" | "correctOption" | "phrases" | "example"> =>
  ({ correctOption: OPT, optionInfo: [TALK_INFO], ...extra });
type Extra = { defLang?: "en" | "zh" | "both"; peek?: boolean; result?: ReturnType<typeof result>; onPeek?: () => void };
const view = (q: Question, c: Card | undefined, extra: Extra = {}) => {
  const onListen = vi.fn();
  const onPeek = extra.onPeek ?? vi.fn();
  render(<AfterAnswerPanel question={q} result={extra.result ?? result()} card={c} defLang={extra.defLang ?? "en"} peek={extra.peek ?? false}
    onPeek={onPeek} onListen={onListen} canListen />);
  return { onListen, onPeek };
};

beforeEach(() => { localStorage.clear(); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { void i18n.changeLanguage("en"); });

describe("AfterAnswerPanel · meaning (spec D1)", () => {
  it("shows the English definitions, at most three phrases and a read-aloud button; Chinese stays hidden under English-only", async () => {
    const { onListen } = view(meaningQ, talkCard());
    const panel = screen.getByTestId("after-answer-panel");
    expect(panel).toHaveTextContent("学习内容");
    expect(within(panel).getByTestId("word-defs-en")).toHaveTextContent("speak to someone");
    expect(panel).not.toHaveTextContent("说话；谈话");
    const phrases = within(panel).getAllByRole("listitem").filter((li) => li.closest("details"));
    expect(phrases).toHaveLength(3);
    expect(phrases[0]).toHaveTextContent("talk about");
    expect(phrases[0]).not.toHaveTextContent("谈论"); // 短语译文跟着「中文」(R-Z3)
    await userEvent.click(within(panel).getByRole("button", { name: "播放读音" }));
    expect(onListen).toHaveBeenCalledWith("talk:after", "talk", undefined);
  });

  it("shows Chinese instead when the preference is 'zh'", () => {
    view(meaningQ, talkCard(), { defLang: "zh" });
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("说话；谈话");
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
  });

  it("shows both lines under 'both'", () => {
    view(meaningQ, talkCard(), { defLang: "both" });
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("说话；谈话");
    expect(screen.getByTestId("word-defs-en")).toBeTruthy();
  });

  it("brings the Chinese lines and the phrase translations back with peek; the chip stays, pressed", () => {
    view(meaningQ, talkCard(), { peek: true });
    const panel = screen.getByTestId("after-answer-panel");
    expect(panel).toHaveTextContent("说话；谈话");
    expect(panel).toHaveTextContent("talk about 谈论");
    expect(screen.getByTestId("word-defs-en")).toBeTruthy();
    expect(screen.getByTestId("after-zh")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a visible 中文 chip under English-only that asks the page to reveal Chinese", async () => {
    const { onPeek } = view(meaningQ, talkCard());
    const chip = screen.getByTestId("after-zh");
    expect(chip).toHaveTextContent("中文");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip.className).toMatch(/\bmin-h-tap\b/);
    await userEvent.click(chip);
    expect(onPeek).toHaveBeenCalledTimes(1);
  });

  it("has no chip under 'zh' / 'both' or for a word that fell back to Chinese", () => {
    for (const defLang of ["zh", "both"] as const) {
      const { unmount } = render(<AfterAnswerPanel question={meaningQ} result={result()} card={talkCard()} defLang={defLang} peek={false} onPeek={vi.fn()} onListen={vi.fn()} />);
      expect(screen.queryByTestId("after-zh")).toBeNull();
      expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("talk about 谈论");
      unmount();
    }
    view(meaningQ, talkCard({ defs_en: undefined }));
    expect(screen.queryByTestId("after-zh")).toBeNull();
  });

  it("falls back to Chinese for a word that has no English definition", () => {
    view(meaningQ, talkCard({ defs_en: undefined }));
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("说话；谈话");
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
  });

  it("does not show the example sentence for meaning questions (spec D1)", () => {
    view(meaningQ, talkCard());
    expect(screen.getByTestId("after-answer-panel")).not.toHaveTextContent("They talk a lot.");
  });
});

describe("AfterAnswerPanel · cloze", () => {
  it("renders the correct word's card like word", () => {
    const clozeQ: Question = { key: "talk", qtype: "cloze", prompt: { sentence: "They _____ a lot.", zh: "他们聊得很多。" }, options: ["talk", "stop"], length: null };
    view(clozeQ, talkCard(), { defLang: "en" });
    const wc = screen.getByTestId("word-card");
    expect(wc).toHaveTextContent("talk");
    expect(wc).toHaveTextContent("speak to someone");
    expect(within(wc).getByTestId("after-zh")).toBeTruthy();
  });
});

describe("AfterAnswerPanel · word (spec D3)", () => {
  it("renders the correct word's card: senses or definitions per preference, example, folded phrases, listen buttons", () => {
    view(wordQ, talkCard(), { defLang: "both" });
    const wc = screen.getByTestId("word-card");
    expect(wc).toHaveTextContent("talk");
    expect(wc).toHaveTextContent("说话；谈话");
    expect(within(wc).getByTestId("word-defs-en")).toHaveTextContent("speak to someone");
    expect(wc).toHaveTextContent("They talk a lot.");
    expect(wc.querySelector("details")).not.toHaveAttribute("open");
    expect(wc).toHaveTextContent("学习内容");
    expect(within(wc).getAllByRole("button", { name: /朗读|播放/ }).length).toBeGreaterThan(0);
  });

  it("uses the same 中文 chip instead of the card's small 中 switch, driven by the page", async () => {
    const { onPeek } = view(wordQ, talkCard(), { defLang: "en" });
    const wc = screen.getByTestId("word-card");
    expect(wc).not.toHaveTextContent("说话；谈话");
    expect(screen.queryByTestId("def-peek")).toBeNull();
    await userEvent.click(within(wc).getByTestId("after-zh"));
    expect(onPeek).toHaveBeenCalledTimes(1);
  });

  it("shows the card's Chinese senses when peek is on", () => {
    view(wordQ, talkCard(), { defLang: "en", peek: true });
    expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话");
    expect(screen.getByTestId("after-zh")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("AfterAnswerPanel · no batch card (R-A11)", () => {
  it("builds the card from the correct option's info plus the server's phrases and example", () => {
    view(meaningQ, undefined, { result: result({ phrases: [{ en: "talk about", zh: "谈论" }], example: { id: "e", en: "We talk.", zh: "我们聊天。" } }) });
    const panel = screen.getByTestId("after-answer-panel");
    expect(panel).toHaveTextContent("speak to someone");
    expect(panel).toHaveTextContent("talk about");
  });

  it("renders nothing when there is neither a card nor info for the correct option", () => {
    view(meaningQ, undefined, { result: result({ optionInfo: undefined }) });
    expect(screen.queryByTestId("after-answer-panel")).toBeNull();
    expect(screen.queryByTestId("word-card")).toBeNull();
  });
});

describe("AfterAnswerPanel · plain card fixtures", () => {
  it("works with the shared test card (Chinese only, no English definition) too", () => {
    view(meaningQ, toCard(card("talk", { senses: [{ pos: "v", text: "说话" }] })));
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("说话");
  });
});
