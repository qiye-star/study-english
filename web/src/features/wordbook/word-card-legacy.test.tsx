import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { card, normalizeIds } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

/**
 * 「改动前」的 DOM 金标准(计划 2026-10-12-wordbook-definitions-web R-DW12):在加英文释义与短语自动展开之前录制,
 * 之后所有任务都必须让它保持不变——老服务端(没有 defsEn、没有 defLang)渲染得和从前一样。
 * 快照文件只在这个任务里生成并提交;后面的任务不得用 -u 更新它。
 */
const TALK = card("talk", {
  senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }],
  phrases: [{ en: "talk about", zh: "谈论" }, { en: "talk back", zh: "顶嘴" }],
}) as unknown as Card;

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("word card legacy DOM (golden recorded before the definitions work)", () => {
  it.each([
    ["uncovered, with example and phrases", {}],
    ["covered", { covered: true }],
    ["without the example block", { showExample: false }],
  ])("%s", (_name, props) => {
    const { container } = renderWithProviders(<WordCardView card={TALK} {...props} />);
    // 计划 2026-10-15 R-M4:查词标记是后加的属性,比对金标准前去掉,金标准文件不重录
    expect(normalizeIds(container.innerHTML).replaceAll(' data-lookup-context=""', "")).toMatchSnapshot();
  });
});
