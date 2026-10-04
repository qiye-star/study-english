import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BottomNav } from "./bottom-nav";
import { initColorScheme } from "./color-scheme";
import { useAppHeight } from "./use-app-height";

function HeightProbe({ win }: { win: Window }): null {
  useAppHeight(win);
  return null;
}

describe("layout", () => {
  it("bottom nav has three 56px targets with test ids", () => {
    render(<MemoryRouter initialEntries={["/chat"]}><BottomNav /></MemoryRouter>);
    for (const id of ["nav-practice", "nav-chat", "nav-me"]) {
      expect(screen.getByTestId(id).className).toMatch(/\bmin-h-14\b/);
    }
    expect(screen.getByTestId("nav-chat")).toHaveAttribute("aria-current", "page");
  });

  it("writes the visual viewport height to --app-height and follows resizes", () => {
    const listeners: Record<string, () => void> = {};
    const visualViewport = { height: 600, addEventListener: (t: string, f: () => void) => (listeners[t] = f), removeEventListener: () => {} };
    const fakeWindow = Object.assign(Object.create(window), { visualViewport, document, addEventListener: () => {}, removeEventListener: () => {} });
    render(<HeightProbe win={fakeWindow} />);
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("600px");
    visualViewport.height = 420;
    listeners.resize();
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("420px");
  });

  it("toggles the dark class from prefers-color-scheme", () => {
    let handler: () => void = () => {};
    const mq = { matches: true, addEventListener: (_: string, f: () => void) => (handler = f), removeEventListener: () => {} };
    const fakeWindow = Object.assign(Object.create(window), { matchMedia: () => mq, document });
    const stop = initColorScheme(fakeWindow);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    mq.matches = false;
    handler();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    stop();
  });
});
