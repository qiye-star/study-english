import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { ApiClient } from "~/api/client";
import { AuthContext, type AuthContextValue } from "~/auth/auth-context";
import { SettingsProvider } from "~/settings/settings-context";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location" data-state={JSON.stringify(location.state ?? null)}>{location.pathname}</div>;
}

export interface RenderOptions {
  api?: ApiClient;
  user?: AuthContextValue["user"];
  route?: string | { pathname: string; state?: unknown };
  path?: string;
  logout?: () => void;
}

/** 与 renderWithProviders 同一组 Provider(鉴权、设置、路由),供 renderHook 的 wrapper 使用。 */
export function TestProviders({ api = new ApiClient({ getToken: () => "test-token" }), user = { id: "12345678", name: "alice" }, children }: {
  api?: ApiClient; user?: AuthContextValue["user"]; children: ReactNode;
}) {
  const value: AuthContextValue = { user, api, login: vi.fn(), register: vi.fn(), logout: vi.fn() };
  return (
    <AuthContext.Provider value={value}>
      <SettingsProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </SettingsProvider>
    </AuthContext.Provider>
  );
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const {
    api = new ApiClient({ getToken: () => "test-token" }),
    user = { id: "12345678", name: "alice" },
    route = "/",
    path = "*",
    logout = vi.fn(),
  } = options;
  const value: AuthContextValue = { user, api, login: vi.fn(), register: vi.fn(), logout };
  return render(
    <AuthContext.Provider value={value}>
      <SettingsProvider>
        <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
      </SettingsProvider>
    </AuthContext.Provider>,
  );
}
