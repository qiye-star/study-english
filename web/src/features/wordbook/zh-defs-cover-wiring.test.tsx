import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { AfterAnswerPanel } from "./after-answer-panel";
import { RecallCard } from "./recall-card";
import { DEFS_EN, card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card, DefLang, OptionInfo, Question } from "./wordbook-api";

const BASE = { senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }], phrases: [{ en: "talk about", zh: "谈论" }] };
const PLAIN = card("talk", BASE) as unknown as Card;
const WITH_EN = { ...card("talk", BASE), defsEn: DEFS_EN } as unknown as Card;
const OTHER = { ...card("walk", { senses: [{ pos: "v", text: "走路" }] }), defsEn: DEFS_EN } as unknown as Card;

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("WordCardView · Chinese definitions on tap", () => {
  it("covers the Chinese rows in place for both, keeps English visible, reveals on tap and hides again for the next card", () => {
    const { rerender } = render(<WordCardView card={WITH_EN} defLang="both" zhCover />);
    expect(screen.getByTestId("zh-defs-cover")).toHaveAttribute("data-state", "hidden");
    expect(screen.getByRole("button", { name: "显示中文释义" })).toBeInTheDocument();
    expect(screen.getByText("说话；谈话")).not.toBeVisible();
    expect(screen.getByTestId("word-defs-en")).toBeVisible();
    fireEvent.click(screen.getByTestId("zh-defs-reveal"));
    expect(screen.getByText("说话；谈话")).toBeVisible();
    expect(screen.queryByTestId("zh-defs-reveal")).toBeNull();
    rerender(<WordCardView card={OTHER} defLang="both" zhCover />);
    expect(screen.getByTestId("zh-defs-cover")).toHaveAttribute("data-state", "hidden");
    expect(screen.getByText("走路")).not.toBeVisible();
  });

  it("also covers zh-only", () => {
    render(<WordCardView card={WITH_EN} defLang="zh" zhCover />);
    expect(screen.getByTestId("zh-defs-cover")).toBeInTheDocument();
  });

  it("en with English definitions is unchanged: no cover, the 中 chip still brings Chinese back without a second control", () => {
    render(<WordCardView card={WITH_EN} defLang="en" zhCover />);
    expect(screen.queryByTestId("zh-defs-cover")).toBeNull();
    expect(screen.queryByText("说话；谈话")).toBeNull();
    fireEvent.click(screen.getByTestId("def-peek"));
    expect(screen.getByText("说话；谈话")).toBeVisible();
    expect(screen.queryByTestId("zh-defs-cover")).toBeNull();
  });

  it("en without English definitions falls back to Chinese, which is covered", () => {
    render(<WordCardView card={PLAIN} defLang="en" zhCover />);
    expect(screen.getByTestId("zh-defs-cover")).toBeInTheDocument();
  });

  it("the learn-page mask comes first: no cover while covered, cover once revealed", () => {
    const { rerender } = render(<WordCardView card={PLAIN} defLang="both" zhCover covered onReveal={() => {}} />);
    expect(screen.queryByTestId("zh-defs-cover")).toBeNull();
    rerender(<WordCardView card={PLAIN} defLang="both" zhCover onReveal={() => {}} />);
    expect(screen.getByTestId("zh-defs-cover")).toBeInTheDocument();
  });

  it("without zhCover nothing is wrapped", () => {
    render(<WordCardView card={PLAIN} defLang="both" />);
    expect(screen.queryByTestId("zh-defs-cover")).toBeNull();
    expect(screen.getByText("说话；谈话")).toBeVisible();
  });
});

describe("RecallCard back · Chinese definitions on tap", () => {
  const question: Question = { key: "talk", qtype: "recall", prompt: { word: "talk" }, options: null, length: null };
  it("passes zhCover to the back face", () => {
    render(<RecallCard question={question} card={PLAIN} face="back" rating={null} defLang="both" zhCover />);
    expect(screen.getByTestId("zh-defs-cover")).toBeInTheDocument();
  });
});

describe("AfterAnswerPanel · Chinese definitions on tap", () => {
  const OPT = "v. 说话；谈话；n. 交谈";
  const meaningQ: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk" }, options: [OPT, "n. 事故"], length: null };
  const wordQ: Question = { key: "talk", qtype: "word", prompt: { meaning: OPT }, options: ["talk", "stop"], length: null };
  const result = { correctOption: OPT, optionInfo: [] as OptionInfo[] };
  const panel = (q: Question, defLang: DefLang) =>
    render(<AfterAnswerPanel question={q} result={result} card={WITH_EN} defLang={defLang} peek={false} onPeek={() => {}} zhCover canListen />);

  it("meaning question: the Chinese rows are covered with the mt-2 offset", () => {
    panel(meaningQ, "both");
    expect(screen.getByTestId("zh-defs-cover")).toBeInTheDocument();
    expect(screen.getByTestId("zh-defs-reveal").className).toContain("mt-2");
    expect(screen.getByText("说话；谈话")).not.toBeVisible();
  });

  it("other question types go through WordCardView and are covered too", () => {
    panel(wordQ, "both");
    expect(screen.getByTestId("zh-defs-cover")).toBeInTheDocument();
  });

  it("en: only the 中文 button, no cover", () => {
    panel(meaningQ, "en");
    expect(screen.queryByTestId("zh-defs-cover")).toBeNull();
    expect(screen.getByTestId("after-zh")).toBeInTheDocument();
  });
});
