import { screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { SessionSummary } from "./session-summary";

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

it("shows the rating split and spot checks when present", () => {
  renderWithProviders(<SessionSummary onHome={vi.fn()} stats={{ kind: "learn", total: 5, firstTry: 4, points: null, missed: [],
    ratings: { know: 2, fuzzy: 2, unknown: 1 }, checks: { total: 1, passed: 1 } }} />);
  const summary = screen.getByTestId("session-summary");
  expect(screen.getByTestId("summary-ratings")).toHaveTextContent("认识 2 · 模糊 2 · 不认识 1");
  expect(summary).toHaveTextContent("抽查 1 · 通过 1");
});

it("leaves the spot-check part out when nothing was checked", () => {
  renderWithProviders(<SessionSummary onHome={vi.fn()} stats={{ kind: "learn", total: 2, firstTry: 2, points: null, missed: [],
    ratings: { know: 2, fuzzy: 0, unknown: 0 }, checks: { total: 0, passed: 0 } }} />);
  expect(screen.getByTestId("summary-ratings")).toHaveTextContent("认识 2 · 模糊 0 · 不认识 0");
  expect(screen.getByTestId("session-summary")).not.toHaveTextContent("抽查");
});

it("says nothing about ratings for a v1-style session", () => {
  renderWithProviders(<SessionSummary onHome={vi.fn()} stats={{ kind: "review", total: 3, firstTry: 3, points: null, missed: [] }} />);
  expect(screen.queryByTestId("summary-ratings")).toBeNull();
  expect(screen.getByTestId("session-summary")).not.toHaveTextContent("抽查");
});
