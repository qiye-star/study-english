import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { ThemedToaster } from "~/app";
import i18n from "~/i18n";
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

function AppShellWith({ page }: { page: ReactElement }) {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="*" element={page} />
      </Route>
    </Routes>
  );
}

describe("layout", () => {
  it("bottom nav has three 56px targets with test ids", () => {
    render(<MemoryRouter initialEntries={["/chat"]}><BottomNav /></MemoryRouter>);
    for (const id of ["nav-practice", "nav-chat", "nav-me"]) {
      expect(screen.getByTestId(id).className).toMatch(/\bmin-h-14\b/);
    }
    expect(screen.getByTestId("nav-chat")).toHaveAttribute("aria-current", "page");
  });

  it("bottom nav is an always-on glass bar with the active tab in blue", () => {
    render(<MemoryRouter initialEntries={["/me"]}><BottomNav /></MemoryRouter>);
    const nav = screen.getByRole("navigation");
    expect(nav.className).toMatch(/\bglass\b/);
    expect(nav.className).toContain("glass-edge-t");
    expect(nav.className).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(screen.getByTestId("nav-me").className).toMatch(/\btext-blue\b/);
    expect(screen.getByTestId("nav-chat").className).toMatch(/\btext-ink-2\b/);
  });

  it("page header is transparent at rest and turns to glass once the shell scrolls", () => {
    const shell = renderWithProviders(<AppShell />, { route: "/x" });
    const main = shell.container.querySelector("main")!;
    // 内容从玻璃底栏下穿过:滚动区为底栏留出空间
    expect(main.className).toContain("pb-[calc(3.5rem+env(safe-area-inset-bottom))]");
    shell.unmount();

    function Page() {
      return <PageHeader title="练习" />;
    }
    const { container } = renderWithProviders(<AppShellWith page={<Page />} />);
    const header = container.querySelector("header")!;
    expect(header.className).not.toContain("glass-bar");
    act(() => {
      const scroller = container.querySelector("main")!;
      scroller.scrollTop = 120;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(header.className).toContain("glass-bar");
  });

  it("page header back button is a 44px labelled target", () => {
    render(<MemoryRouter><PageHeader title="T" back="/me" /></MemoryRouter>);
    const back = screen.getByRole("button", { name: i18n.t("web.common.back") });
    expect(back.className).toMatch(/\bh-tap\b/);
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
