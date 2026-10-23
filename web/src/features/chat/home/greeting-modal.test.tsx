import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { GreetingModal, type GreetingExitTargets, type GreetingModalProps } from "./greeting-modal";
import type { GreetingLine } from "./greeting-types";

const LINES: GreetingLine[] = [
  { en: "Good morning! You're on a *23-day streak* — lovely.", zh: "早上好!你已经连续学习 *23 天*。" },
  { en: "You have *12 words* to review, and *went* should be *gone*.", zh: "有 12 个词待复习。" },
  { en: "Let's spend 10 minutes on the present perfect.", zh: "今天先练 10 分钟现在完成时。" },
];
const ZH_LINES: GreetingLine[] = LINES.map((l) => ({ zh: l.zh }));
const EN_LINES: GreetingLine[] = LINES.map((l) => ({ en: l.en }));

function stubMedia(matching: string[]) {
  window.matchMedia = ((query: string) => ({
    matches: matching.some((m) => query.includes(m)), media: query, onchange: null as null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const baseProps = (over: Partial<GreetingModalProps> = {}): GreetingModalProps => ({
  lines: LINES, language: "bilingual", localDate: "2026-10-23", facts: {}, onClose: vi.fn(), ...over,
});
const open = (over: Partial<GreetingModalProps> = {}) => {
  const props = baseProps(over);
  return { props, ...render(<GreetingModal {...props} />) };
};
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

let originalMatchMedia: typeof window.matchMedia;
beforeEach(() => {
  originalMatchMedia = window.matchMedia;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  void i18n.changeLanguage("en");
});

describe("GreetingModal content", () => {
  it("is a modal dialog with exactly three lines, a lead first line, and no assistant name or avatar", () => {
    open();
    const dialog = screen.getByRole("dialog", { name: "Today's greeting" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const lines = screen.getAllByTestId("greeting-line");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveClass("greet-lead");
    expect(lines[1]).not.toHaveClass("greet-lead");
    expect(dialog.querySelector("img, [role=img], [class*=avatar]")).toBeNull();
  });

  it("renders emphasis as <em> and gives screen readers the full line without stars", () => {
    open();
    const first = screen.getAllByTestId("greeting-line")[0];
    expect([...first.querySelectorAll("em")].map((e) => e.textContent)).toContain("23-day");
    expect(first.querySelector("[aria-hidden=true]")).not.toBeNull();
    const sr = first.querySelector(".sr-only")!;
    expect(sr.textContent).toBe("Good morning! You're on a 23-day streak — lovely.");
    expect(screen.getByRole("dialog").textContent).not.toContain("*");
  });

  it("hides every per-word span from assistive tech", () => {
    open();
    const words = screen.getByTestId("greeting-lines").querySelectorAll("[data-tk]");
    expect(words.length).toBeGreaterThan(10);
    for (const w of words) expect(w.closest("[aria-hidden=true]")).not.toBeNull();
  });

  it("shows the English line with a Chinese sub-line in bilingual mode", () => {
    open();
    const first = screen.getAllByTestId("greeting-line")[0];
    expect(first.querySelector(".greet-sub")?.textContent).toContain("早上好");
    expect(first.textContent).toContain("Good morning");
  });

  it("shows only Chinese in zh mode (no sub-line)", () => {
    open({ lines: ZH_LINES, language: "zh" });
    const first = screen.getAllByTestId("greeting-line")[0];
    expect(first.querySelector(".greet-sub")).toBeNull();
    expect(first.textContent).toContain("早上好");
    expect(first.textContent).not.toMatch(/Good/);
  });

  it("shows only English in en mode (no sub-line)", () => {
    open({ lines: EN_LINES, language: "en" });
    expect(document.querySelectorAll(".greet-sub")).toHaveLength(0);
    expect(screen.getAllByTestId("greeting-line")[1].textContent).toContain("12 words");
  });

  it("shows the localised date and no stats row for empty facts", () => {
    open();
    expect(screen.getByTestId("greeting-date").textContent).toContain("Oct 23");
    expect(screen.queryByTestId("greeting-stats")).toBeNull();
  });

  it("formats the date in Chinese when the UI is Chinese", async () => {
    await i18n.changeLanguage("zh-CN");
    open();
    expect(screen.getByTestId("greeting-date").textContent).toContain("10月23日");
    expect(screen.getByRole("dialog", { name: "今日问候" })).toBeInTheDocument();
  });

  it("shows only the facts that exist, with a full screen-reader sentence", () => {
    open({ facts: { streak: 23, due: 12 } });
    const stats = screen.getByTestId("greeting-stats");
    expect(stats.querySelector(".sr-only")?.textContent).toBe("23-day study streak, 12 words to review");
    expect(stats.querySelectorAll(".greet-q")).toHaveLength(2);
  });

  it("calls onShown once and records the mode", () => {
    const onShown = vi.fn();
    open({ onShown, mode: "replay" });
    expect(onShown).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("greeting-modal")).toHaveAttribute("data-mode", "replay");
  });

  it("copes with the longest allowed greeting (structure only; layout is checked on devices)", () => {
    const long = (n: number, ch: string) => ch.repeat(n);
    const lines: GreetingLine[] = [0, 1, 2].map(() => ({ en: `${long(130, "word ")}`.slice(0, 140), zh: long(43, "字") }));
    open({ lines });
    const box = screen.getByTestId("greeting-lines");
    const gs = Number(box.style.getPropertyValue("--gs"));
    expect(gs).toBeGreaterThanOrEqual(0.72);
    expect(gs).toBeLessThanOrEqual(1);
  });
});

describe("GreetingModal timing, skip and keys", () => {
  it("starts the 5 s countdown when the last line appears, then closes once", () => {
    const { props } = open();
    const ring = screen.getByTestId("greeting-ring");
    advance(2249);
    expect(ring).not.toHaveClass("greet-ring-run");
    advance(1);
    expect(ring).toHaveClass("greet-ring-run");
    advance(4999);
    expect(props.onClose).not.toHaveBeenCalled();
    advance(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledWith("timeout");
    advance(20000);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes immediately from the skip button, once even though the click bubbles", () => {
    const { props } = open();
    fireEvent.click(screen.getByRole("button", { name: /Skip the greeting/ }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledWith("skip");
  });

  it("closes on a tap anywhere", () => {
    const { props } = open();
    fireEvent.click(screen.getByTestId("greeting-lines"));
    expect(props.onClose).toHaveBeenCalledWith("tap");
  });

  it.each([["Enter"], [" "]])("closes on %j", (key) => {
    const { props } = open();
    fireEvent.keyDown(screen.getByTestId("greeting-modal"), { key });
    expect(props.onClose).toHaveBeenCalledWith("key");
  });

  it("closes on Escape", () => {
    const { props } = open();
    fireEvent.keyDown(screen.getByTestId("greeting-modal"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledWith("esc");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("pauses while the pointer hovers the skip button and resumes after", () => {
    stubMedia(["hover: hover"]);
    const { props } = open();
    advance(2250);
    advance(2000);
    const skip = screen.getByTestId("greeting-skip");
    fireEvent.pointerEnter(skip);
    expect(screen.getByTestId("greeting-ring")).toHaveStyle({ animationPlayState: "paused" });
    advance(60000);
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.pointerLeave(skip);
    advance(2999);
    expect(props.onClose).not.toHaveBeenCalled();
    advance(1);
    expect(props.onClose).toHaveBeenCalledWith("timeout");
  });

  it("does not pause on touch devices (no hover)", () => {
    stubMedia([]);
    const { props } = open();
    advance(2250);
    fireEvent.pointerEnter(screen.getByTestId("greeting-skip"));
    advance(5000);
    expect(props.onClose).toHaveBeenCalledWith("timeout");
  });

  it("pauses while the page is hidden", () => {
    const { props } = open();
    advance(2250);
    advance(1000);
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    advance(60000);
    expect(props.onClose).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    advance(4000);
    expect(props.onClose).toHaveBeenCalledWith("timeout");
  });

  it("waits for a custom exit animation before calling onClose", async () => {
    let finish!: () => void;
    const playExit = vi.fn((_targets: GreetingExitTargets) => new Promise<void>((r) => { finish = r; }));
    const { props } = open({ playExit });
    fireEvent.click(screen.getByTestId("greeting-skip"));
    expect(playExit).toHaveBeenCalledTimes(1);
    expect(playExit.mock.calls[0][0].lines).toHaveLength(3);
    expect(playExit.mock.calls[0][0].lines[2]).toHaveAttribute("data-gl", "2");
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(props.onClose).toHaveBeenCalledWith("skip");
  });

  it("does not start a second countdown or close twice after closing", () => {
    const { props } = open();
    fireEvent.click(screen.getByTestId("greeting-skip"));
    advance(30000);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("GreetingModal reduced motion", () => {
  it("shows all text at once, starts the countdown by 600 ms and still gives a full 5 s", () => {
    stubMedia(["prefers-reduced-motion"]);
    const { props } = open({ facts: { streak: 3 } });
    expect(screen.getAllByTestId("greeting-line")).toHaveLength(3);
    expect(screen.getByTestId("greeting-stats").textContent).toContain("3");
    const ring = screen.getByTestId("greeting-ring");
    advance(599);
    expect(ring).not.toHaveClass("greet-ring-run");
    advance(1);
    expect(ring).toHaveClass("greet-ring-run");
    advance(4999);
    expect(props.onClose).not.toHaveBeenCalled();
    advance(1);
    expect(props.onClose).toHaveBeenCalledWith("timeout");
  });
});

describe("GreetingModal focus and background", () => {
  function Host() {
    const [shown, setShown] = useState(false);
    return (
      <>
        <button onClick={() => setShown(true)}>opener</button>
        <p data-testid="behind">behind</p>
        {shown ? <GreetingModal {...baseProps({ onClose: () => setShown(false) })} /> : null}
      </>
    );
  }

  it("moves focus into the dialog, traps Tab on the skip button and returns focus on close", async () => {
    vi.useRealTimers();
    render(<Host />);
    const opener = screen.getByText("opener");
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(document.getElementById("root") ?? document.body).toBeTruthy();
    // 其余内容被 Radix 标为 aria-hidden,背后不可操作
    await waitFor(() => expect(opener.closest("[aria-hidden=true]")).not.toBeNull());

    const skip = screen.getByTestId("greeting-skip");
    skip.focus();
    expect(document.activeElement).toBe(skip);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe("greeting.css", () => {
  const css = readFileSync(path.resolve(process.cwd(), "src/features/chat/home/greeting.css"), "utf8");

  it("covers the notch and home bar and has a small-viewport rule", () => {
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toMatch(/@media \(max-height: 680px\)\s*\{\s*\.greet-lines/);
  });

  it("sits above the sheets and uses no backdrop-filter or inner HTML", () => {
    expect(css).toMatch(/\.greet \{[^}]*z-index: 70/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/backdrop-filter/);
  });

  it("keeps the skip target at 44px and honours reduced motion", () => {
    expect(css).toMatch(/\.greet-skip \{[^}]*height: 44px/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*animation: none/);
  });
});
