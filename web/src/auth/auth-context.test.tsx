import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAuth, loadAuth, saveAuth } from "~/api/auth-storage";
import { createFetchMock, json } from "~/test/fetch-mock";
import { AuthProvider, useAuth } from "./auth-context";

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider fetchImpl={mock.fetch}>{children}</AuthProvider>;
  const hook = renderHook(() => useAuth(), { wrapper });
  return { ...hook, mock };
}

const ignore = (): void => undefined;

describe("AuthProvider account actions", () => {
  beforeEach(() => {
    clearAuth();
    saveAuth({ token: "old-token", user: { id: "12345678", name: "alice" } });
  });

  it("user logout tells the server to end this session, even when the network fails", async () => {
    const { result, mock } = setup({
      "DELETE /api/sessions/current": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    act(() => result.current.logout(true));
    expect(result.current.user).toBeNull();
    expect(loadAuth()).toBeNull();
    await waitFor(() => expect(mock.calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(mock.calls[0].headers.get("Authorization")).toBe("Bearer old-token");
  });

  it("a forced sign-out (expired token) clears locally without calling the server again", () => {
    const { result, mock } = setup({});
    act(() => result.current.logout());
    expect(result.current.user).toBeNull();
    expect(mock.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });

  it("changePassword swaps the stored token for the rotated one and uses it on the next request", async () => {
    const { result, mock } = setup({
      "POST /api/me/password": () => json({ access_token: "rotated-token" }),
      "GET /api/me": () => json({ id: "12345678", name: "alice", created_at: "t" }),
    });
    await act(async () => {
      await result.current.changePassword!("old-password", "new-password1");
    });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ current_password: "old-password", new_password: "new-password1" });
    expect(loadAuth()?.token).toBe("rotated-token");
    expect(loadAuth()?.user).toEqual({ id: "12345678", name: "alice" });
    await result.current.api.me();
    expect(mock.calls[1].headers.get("Authorization")).toBe("Bearer rotated-token");
  });
  it("a 401 answering the user's own logout keeps the signed-out-by-user state", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { result, mock } = setup({
      "DELETE /api/sessions/current": async () => {
        await gate;
        return json({ error: "Unauthorized" }, 401);
      },
    });
    act(() => result.current.logout(true));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "DELETE")).toBe(true));
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current.signedOutByUser).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it("a 401 for a request sent before a password change does not sign the user out", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { result } = setup({
      "GET /api/me": async () => {
        await gate;
        return json({ error: "Unauthorized" }, 401);
      },
      "POST /api/me/password": () => json({ access_token: "rotated-token" }),
    });
    let stale: Promise<unknown> = Promise.resolve();
    act(() => {
      stale = result.current.api.me().then(ignore, ignore);
    });
    await act(async () => {
      await result.current.changePassword!("old-password", "new-password1");
    });
    await act(async () => {
      release();
      await stale;
    });
    expect(result.current.user).not.toBeNull();
    expect(loadAuth()?.token).toBe("rotated-token");
  });

  it("updateDisplayName stores the new display name without changing the token", async () => {
    const { result } = setup({});
    act(() => result.current.updateDisplayName!("Emma Lee"));
    expect(loadAuth()).toEqual({ token: "old-token", user: { id: "12345678", name: "alice", displayName: "Emma Lee" } });
    expect(result.current.user?.displayName).toBe("Emma Lee");
    act(() => result.current.updateDisplayName!(undefined));
    expect(loadAuth()?.user).toEqual({ id: "12345678", name: "alice" });
  });
});
