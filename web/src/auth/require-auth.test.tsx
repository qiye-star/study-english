import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAuth, saveAuth } from "~/api/auth-storage";
import { PRACTICE_DRAFT_KEY } from "~/auth/device-data";
import { kvGet, kvSet } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { AuthProvider, useAuth } from "./auth-context";
import { RequireAuth } from "./require-auth";

function LoginProbe() {
  const state = useLocation().state as { from?: string } | null;
  return <div>login from={state?.from ?? "none"}</div>;
}

function LogoutButton() {
  const { logout } = useAuth();
  return <button onClick={() => logout(true)}>sign out</button>;
}

function CallsMe() {
  const { api } = useAuth();
  useEffect(() => { api.me().catch((): void => undefined); }, [api]);
  return <div>protected</div>;
}

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  render(
    <MemoryRouter initialEntries={["/chat"]}>
      <AuthProvider fetchImpl={mock.fetch}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route element={<RequireAuth />}>
            <Route path="/chat" element={<CallsMe />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  beforeEach(() => { clearAuth(); localStorage.clear(); });
  it("redirects anonymous users to /login", () => {
    setup({});
    expect(screen.getByText(/^login from=/)).toBeInTheDocument();
  });
  it("renders protected routes for a stored session", () => {
    saveAuth({ token: "tok", user: { id: "1", name: "a" } });
    setup({ "GET /api/me": () => json({ id: "1", name: "a", created_at: "t" }) });
    expect(screen.getByText("protected")).toBeInTheDocument();
  });
  it("logs out and returns to /login on any 401", async () => {
    saveAuth({ token: "expired", user: { id: "1", name: "a" } });
    localStorage.setItem(PRACTICE_DRAFT_KEY, JSON.stringify("draft"));
    await kvSet("lookup", 1);
    setup({ "GET /api/me": () => json({ error: "Unauthorized" }, 401) });
    expect(await screen.findByText(/^login from=/)).toBeInTheDocument();
    expect(localStorage.getItem("enjoy-web.auth")).toBeNull();
    expect(localStorage.getItem(PRACTICE_DRAFT_KEY)).toBeNull();
    await waitFor(async () => expect(await kvGet("lookup")).toBeUndefined());
  });
  it("remembers the page on session expiry", async () => {
    saveAuth({ token: "expired", user: { id: "1", name: "a" } });
    setup({ "GET /api/me": () => json({ error: "Unauthorized" }, 401) });
    expect(await screen.findByText("login from=/chat")).toBeInTheDocument();
  });
  it("does not remember the page after a user-initiated logout", async () => {
    saveAuth({ token: "tok", user: { id: "1", name: "a" } });
    const mock = createFetchMock({});
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AuthProvider fetchImpl={mock.fetch}>
          <Routes>
            <Route path="/login" element={<LoginProbe />} />
            <Route element={<RequireAuth />}>
              <Route path="/chat" element={<LogoutButton />} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    localStorage.setItem(PRACTICE_DRAFT_KEY, JSON.stringify("draft"));
    await kvSet("lookup", 1);
    screen.getByText("sign out").click();
    expect(await screen.findByText("login from=none")).toBeInTheDocument();
    expect(localStorage.getItem(PRACTICE_DRAFT_KEY)).toBeNull();
    await waitFor(async () => expect(await kvGet("lookup")).toBeUndefined());
  });
});
