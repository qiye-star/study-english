import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyColorScheme, initColorScheme, resolveDark } from "./color-scheme";

const html = document.documentElement;

/** 假的 window:系统是否深色、以及触发「系统主题变了」。 */
function fakeWindow(systemDark: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches: systemDark,
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  };
  const win = Object.assign(Object.create(window), { matchMedia: () => mq, document }) as Window;
  return { win, mq, fire: () => listeners.forEach((f) => f()), listeners };
}

const metas = () => [...document.querySelectorAll("meta[name='theme-color']")];

beforeEach(() => {
  document.head.innerHTML =
    '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">' +
    '<meta name="theme-color" content="#0F1013" media="(prefers-color-scheme: dark)">';
});
afterEach(() => {
  html.classList.remove("dark");
  document.head.innerHTML = "";
});

describe("resolveDark (D12)", () => {
  it.each([
    ["system", true, true], ["system", false, false], ["light", true, false], ["light", false, false],
    ["dark", true, true], ["dark", false, true],
  ] as const)("%s with a dark system = %s → %s", (scheme, systemDark, expected) => {
    expect(resolveDark(scheme, systemDark)).toBe(expected);
  });
});

describe("applyColorScheme / initColorScheme", () => {
  it("follows the system while the scheme is system, including live changes", () => {
    const { win, mq, fire } = fakeWindow(true);
    const stop = initColorScheme(win, "system");
    expect(html.classList.contains("dark")).toBe(true);
    mq.matches = false;
    fire();
    expect(html.classList.contains("dark")).toBe(false);
    stop();
  });

  it("ignores the system when the scheme is fixed, and a later choice wins over earlier ones", () => {
    const { win, mq, fire } = fakeWindow(false);
    const stop = initColorScheme(win, "dark");
    expect(html.classList.contains("dark")).toBe(true);
    mq.matches = false;
    fire();
    expect(html.classList.contains("dark")).toBe(true);
    mq.matches = true;
    applyColorScheme("light", win);
    expect(html.classList.contains("dark")).toBe(false);
    fire(); // 系统主题变化后仍保持「浅色」(偏好是模块级的,不是 init 时的快照)
    expect(html.classList.contains("dark")).toBe(false);
    applyColorScheme("system", win);
    expect(html.classList.contains("dark")).toBe(true);
    stop();
  });

  it("reads the stored preference at start-up when none is passed", () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ colorScheme: "dark" }));
    const { win } = fakeWindow(false);
    const stop = initColorScheme(win);
    expect(html.classList.contains("dark")).toBe(true);
    stop();
    localStorage.removeItem("enjoy-web.settings");
  });

  it("stops listening to the system once cleaned up", () => {
    const { win, listeners } = fakeWindow(false);
    const stop = initColorScheme(win, "system");
    expect(listeners.size).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });

  it("gives both theme-color metas one colour while fixed and restores them for system", () => {
    const { win } = fakeWindow(false);
    applyColorScheme("dark", win);
    expect(metas().map((m) => m.getAttribute("content"))).toEqual(["#0F1013", "#0F1013"]);
    expect(metas().every((m) => !m.hasAttribute("media"))).toBe(true);
    applyColorScheme("light", win);
    expect(metas().map((m) => m.getAttribute("content"))).toEqual(["#ffffff", "#ffffff"]);
    applyColorScheme("system", win);
    expect(metas().map((m) => m.getAttribute("content"))).toEqual(["#ffffff", "#0F1013"]);
    expect(metas().map((m) => m.getAttribute("media"))).toEqual(["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"]);
  });

  it("works on a page without theme-color metas and on a window without matchMedia", () => {
    document.head.innerHTML = "";
    const bare = Object.assign(Object.create(window), { matchMedia: undefined, document }) as Window;
    expect(() => applyColorScheme("dark", bare)).not.toThrow();
    expect(html.classList.contains("dark")).toBe(true);
    expect(() => applyColorScheme("system", bare)).not.toThrow();
    expect(html.classList.contains("dark")).toBe(false);
  });
});
