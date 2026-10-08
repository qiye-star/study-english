import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./app";
import { clearSession, saveSession } from "./api/session";

vi.mock("./api/endpoints", () => ({
  getOverview: vi.fn(async () => ({
    totals: { users: 3, conversations: 4, messages: 5, assessments: 6, vocabulary: 7, practice_items: 8, recording_bytes: 5 * 1024 * 1024 },
    daily: [{ date: "2026-10-08", new_users: 1, messages: 2, assessments: 3 }],
  })),
  login: vi.fn(),
}));

afterEach(() => clearSession());

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
const session = () => saveSession({ token: "t", expires_at: new Date(Date.now() + 60_000).toISOString() });

describe("route guard", () => {
  it("redirects anonymous visitors to the login page", () => {
    open("/users");
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("lets an authenticated session through and shows the overview", async () => {
    session();
    open("/");
    expect(await screen.findByText("5.00 MB")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
  });

  it("kicks the user back to login when the session is cleared (e.g. after a 401)", async () => {
    session();
    open("/");
    await screen.findByText("5.00 MB");
    act(() => clearSession());
    expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();
  });
});
