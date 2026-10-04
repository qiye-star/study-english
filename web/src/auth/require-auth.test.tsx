import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAuth, saveAuth } from "~/api/auth-storage";
import { createFetchMock, json } from "~/test/fetch-mock";
import { AuthProvider, useAuth } from "./auth-context";
import { RequireAuth } from "./require-auth";

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
          <Route path="/login" element={<div>login page</div>} />
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
    expect(screen.getByText("login page")).toBeInTheDocument();
  });
  it("renders protected routes for a stored session", () => {
    saveAuth({ token: "tok", user: { id: "1", name: "a" } });
    setup({ "GET /api/me": () => json({ id: "1", name: "a", created_at: "t" }) });
    expect(screen.getByText("protected")).toBeInTheDocument();
  });
  it("logs out and returns to /login on any 401", async () => {
    saveAuth({ token: "expired", user: { id: "1", name: "a" } });
    setup({ "GET /api/me": () => json({ error: "Unauthorized" }, 401) });
    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(localStorage.getItem("enjoy-web.auth")).toBeNull();
  });
});
