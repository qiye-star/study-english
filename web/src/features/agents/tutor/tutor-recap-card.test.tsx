import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { TutorRecapCard } from "./tutor-recap-card";
import { RAW_RECAP, rawSession, toSession } from "./tutor-fixtures";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

const recap = () => toSession(rawSession({ recap: RAW_RECAP })).recap!;

it("shows counts, score distribution, level change, strengths and weaknesses", () => {
  renderWithProviders(<TutorRecapCard recap={recap()} />);
  expect(screen.getByTestId("tutor-recap-count")).toHaveTextContent("答了 4 / 5 题");
  expect(screen.getByTestId("tutor-score-good")).toHaveTextContent("很好 2");
  expect(screen.getByTestId("tutor-score-skip")).toHaveTextContent("跳过 1");
  expect(screen.getByTestId("tutor-recap")).toHaveTextContent("难度 B1 → B2");
  expect(screen.getByTestId("tutor-strengths")).toHaveTextContent("用词造句 · 今日词");
  expect(screen.getByTestId("tutor-weaknesses")).toHaveTextContent("听写 · 今日词");
});

it("offers each suggested word through the WordActions slot (core: add to vocabulary)", () => {
  renderWithProviders(<TutorRecapCard recap={recap()} />);
  const words = screen.getByRole("region", { name: "建议加入生词本" });
  expect(within(words).getByText("abandon")).toBeInTheDocument();
  expect(screen.getByTestId("tutor-word-abandon")).toHaveAttribute("data-state", "idle");
  expect(screen.getByTestId("tutor-word-resilient")).toBeInTheDocument();
});

it("hides the word section when there are no words and shows 暂无 for empty lists", () => {
  renderWithProviders(<TutorRecapCard recap={{ ...recap(), words: [], strengths: [] }} />);
  expect(screen.queryByRole("region", { name: "建议加入生词本" })).toBeNull();
  expect(screen.getByTestId("tutor-strengths")).toHaveTextContent("暂无");
});
