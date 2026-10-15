import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ApiClient } from "~/api/client";
import { AuthContext } from "~/auth/auth-context";
import i18n from "~/i18n";
import { GlassRoutePin } from "~/layout/glass-route-pin";
import { GLASS_ATTR } from "~/lib/glass-flag";
import { resetGlassThemeMemory } from "~/settings/glass-theme-store";
import { SettingsProvider } from "~/settings/settings-context";
import { setLiquid } from "~/test/glass";
import { AppearancePage } from "./appearance-page";

let go: (to: string) => void = () => {};
function Probe() {
  const navigate = useNavigate();
  go = (to) => navigate(to);
  return <div data-testid="where">{useLocation().pathname}</div>;
}

describe("AppearancePage entry from a pinned route", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
    resetGlassThemeMemory();
    setLiquid(true);
  });
  afterEach(async () => {
    setLiquid(false);
    await i18n.changeLanguage("en");
    resetGlassThemeMemory();
  });

  function setup(initial: string) {
    const api = new ApiClient({ getToken: () => "t" });
    return render(
      <AuthContext.Provider value={{ user: { id: "12345678", name: "alice" }, api, login: async () => {}, register: async () => {}, logout: () => {} } as never}>
        <SettingsProvider>
          <MemoryRouter initialEntries={[initial]}>
            <GlassRoutePin />
            <Probe />
            <Routes>
              <Route path="/me" element={<div>me-home</div>} />
              <Route path="/library" element={<div>library</div>} />
              <Route path="/practice/changelog" element={<div>changelog</div>} />
              <Route path="/me/appearance" element={<AppearancePage />} />
            </Routes>
          </MemoryRouter>
        </SettingsProvider>
      </AuthContext.Provider>,
    );
  }

  it.each(["/library", "/practice/changelog"])("navigating from %s lands on the page, not /me", (from) => {
    setup(from);
    expect(document.documentElement.getAttribute(GLASS_ATTR)).toBe("pin");
    act(() => go("/me/appearance"));
    expect(screen.getByTestId("where")).toHaveTextContent("/me/appearance");
    expect(screen.queryByText("me-home")).toBeNull();
    expect(document.documentElement.getAttribute(GLASS_ATTR)).toBe("v2");
  });

  it("still redirects when the app-wide switch is absent", () => {
    setLiquid(false);
    setup("/me/appearance");
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/me$/);
  });
});
