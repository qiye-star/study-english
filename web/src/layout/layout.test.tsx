import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { describe, expect, it } from "vitest";
import { ThemedToaster } from "~/app";
import { AppShell } from "./app-shell";
import { BottomNav } from "./bottom-nav";
import { initColorScheme, useIsDark } from "./color-scheme";
import { renderWithProviders } from "~/test/render";
import { PageHeader } from "./page-header";
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

  it("the sticky header owns the safe-area inset and the shell main does not double it", () => {
    const { container } = render(
      <MemoryRouter><PageHeader title="T" /></MemoryRouter>,
    );
    const header = container.querySelector("header")!;
    expect(header.className).toMatch(/(^| )top-0( |$)/);
    expect(header.className).toContain("pt-[env(safe-area-inset-top)]");
    const shell = renderWithProviders(<AppShell />);
    expect(shell.container.querySelector("main")!.className).not.toContain("safe-area-inset-top");
  });

  it("useIsDark follows the html.dark class and ThemedToaster uses it", async () => {
    function Probe() { return <span data-testid="dark">{String(useIsDark())}</span>; }
    document.documentElement.classList.remove("dark");
    render(<><Probe /><ThemedToaster /></>);
    expect(screen.getByTestId("dark")).toHaveTextContent("false");
    await act(async () => { document.documentElement.classList.add("dark"); });
    expect(screen.getByTestId("dark")).toHaveTextContent("true");
    await act(async () => { toast("hello"); });
    await waitFor(() => expect(document.querySelector("[data-sonner-toaster]")?.getAttribute("data-theme")).toBe("dark"));
    document.documentElement.classList.remove("dark");
  });
});
