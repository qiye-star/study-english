import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth, saveAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { createFetchMock, json } from "~/test/fetch-mock";
import { BindingBanner } from "./lazy";

function setup(binding: { state: "none" | "pending" | "enforced"; deadline?: string }) {
  const mock = createFetchMock({
    "GET /api/me": () => json({ id: "1", name: "alice", created_at: "t", email_verified: false, email_binding: binding }),
  });
  render(
    <MemoryRouter>
      <AuthProvider fetchImpl={mock.fetch}>
        <BindingBanner />
      </AuthProvider>
    </MemoryRouter>,
  );
  return mock;
}

describe("BindingBanner (X26, W6)", () => {
  beforeEach(() => {
    clearAuth();
    localStorage.clear();
    saveAuth({ token: "tok", user: { id: "1", name: "alice" } });
  });

  it("shows the deadline and a link to the bind page while pending", async () => {
    setup({ state: "pending", deadline: "2026-11-01T10:00:00+08:00" });
    const banner = await screen.findByTestId("binding-banner");
    expect(banner).toHaveTextContent("2026");
    expect(screen.getByRole("link", { name: "Bind now" })).toHaveAttribute("href", "/account/email");
  });

  it("renders nothing when no binding is pending", async () => {
    const mock = setup({ state: "none" });
    await vi.waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/me")).toBe(true));
    expect(screen.queryByTestId("binding-banner")).toBeNull();
  });
});
