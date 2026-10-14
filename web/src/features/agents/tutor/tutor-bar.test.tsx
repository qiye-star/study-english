import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { TutorBar, type TutorBarProps } from "./tutor-bar";
import { rawSession, toSession } from "./tutor-fixtures";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

function props(over: Partial<TutorBarProps> = {}): TutorBarProps {
  return { session: toSession(rawSession()), hint: null, busy: false, onHint: vi.fn(), onSkip: vi.fn(), onListen: vi.fn(),
    onTranslate: vi.fn(), onEnd: vi.fn(), onResume: vi.fn(), ...over };
}

it("shows progress, kind and level; actions call back", () => {
  const p = props();
  renderWithProviders(<TutorBar {...p} />);
  expect(screen.getByTestId("tutor-progress")).toHaveTextContent("第 2 / 5 题");
  expect(screen.getByTestId("tutor-bar")).toHaveTextContent("用词造句");
  expect(screen.getByTestId("tutor-bar")).toHaveTextContent("B1 · 中级");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  fireEvent.click(screen.getByRole("button", { name: "提示" }));
  fireEvent.click(screen.getByRole("button", { name: "跳过" }));
  fireEvent.click(screen.getByRole("button", { name: "听一遍" }));
  fireEvent.click(screen.getByRole("button", { name: "翻译" }));
  expect([p.onHint, p.onSkip, p.onListen, p.onTranslate].map((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1, 1]);
});

it("keeps the question type whole and lets the long level label shrink (full label stays in title)", async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en" }));
  await i18n.changeLanguage("en");
  renderWithProviders(<TutorBar {...props()} />);
  const level = screen.getByTestId("tutor-level");
  expect(level).toHaveTextContent("B1 · Intermediate");
  expect(level).toHaveClass("min-w-0", "truncate");
  expect(level).toHaveAttribute("title");
  expect(level.getAttribute("title")).toContain("B1");
  expect(screen.getByTestId("tutor-kind")).toHaveClass("shrink-0", "whitespace-nowrap");
  expect(screen.getByTestId("tutor-kind")).not.toHaveClass("truncate");
});

it("folds the Chinese hint under the English hint; nothing without it", () => {
  const { unmount } = renderWithProviders(<TutorBar {...props({ hint: "Think about yesterday.", hintZh: "想想昨天" })} />);
  expect(screen.getByTestId("tutor-hint")).toHaveTextContent("Think about yesterday.");
  const toggle = screen.getByTestId("tutor-hint-zh-toggle");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(screen.getByTestId("tutor-hint-zh-text")).toHaveTextContent("想想昨天");
  unmount();
  renderWithProviders(<TutorBar {...props({ hint: "Think about yesterday." })} />);
  expect(screen.queryByTestId("tutor-hint-zh")).toBeNull();
});

it("ending needs a second tap", () => {
  const p = props();
  renderWithProviders(<TutorBar {...p} />);
  fireEvent.click(screen.getByTestId("tutor-end"));
  expect(p.onEnd).not.toHaveBeenCalled();
  expect(screen.getByTestId("tutor-end")).toHaveTextContent("再点结束");
  fireEvent.click(screen.getByTestId("tutor-end"));
  expect(p.onEnd).toHaveBeenCalledTimes(1);
});

it("shows the hint, caps hints and disables actions while busy", () => {
  const { unmount } = renderWithProviders(<TutorBar {...props({ hint: "想想昨天", session: toSession(rawSession({ hints_used: 2 })) })} />);
  expect(screen.getByTestId("tutor-hint")).toHaveTextContent("想想昨天");
  expect(screen.getByTestId("tutor-hint-btn")).toBeDisabled();
  expect(screen.getByTestId("tutor-skip")).toBeEnabled();
  unmount();
  renderWithProviders(<TutorBar {...props({ busy: true })} />);
  for (const id of ["tutor-hint-btn", "tutor-skip", "tutor-listen", "tutor-translate"]) expect(screen.getByTestId(id)).toBeDisabled();
});

it("before the agent has asked, offers 继续 instead of answer actions", () => {
  const p = props({ session: toSession(rawSession({ phase: "ask", step_index: 3 })) });
  renderWithProviders(<TutorBar {...p} />);
  expect(screen.queryByTestId("tutor-skip")).toBeNull();
  fireEvent.click(screen.getByTestId("tutor-resume"));
  expect(p.onResume).toHaveBeenCalledTimes(1);
});

it("keeps English labels short enough for four equal cells at 360 px", async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en" }));
  await i18n.changeLanguage("en");
  renderWithProviders(<TutorBar {...props()} />);
  for (const id of ["tutor-hint-btn", "tutor-skip", "tutor-listen", "tutor-translate"]) {
    expect((screen.getByTestId(id).textContent ?? "").length, id).toBeLessThanOrEqual(9);
  }
  expect(screen.getByTestId("tutor-end").textContent!.length).toBeLessThanOrEqual(10);
});
