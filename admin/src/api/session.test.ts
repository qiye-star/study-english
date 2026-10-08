import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSession, getSession, getToken, saveSession } from "./session";

const future = () => new Date(Date.now() + 3600_000).toISOString();

afterEach(() => {
  vi.restoreAllMocks();
  clearSession();
});

describe("session storage", () => {
  it("round-trips a session through sessionStorage", () => {
    saveSession({ token: "abc", expires_at: future() });
    expect(getToken()).toBe("abc");
    expect(JSON.parse(sessionStorage.getItem("admin.session")!).token).toBe("abc");
    clearSession();
    expect(getSession()).toBeNull();
    expect(sessionStorage.getItem("admin.session")).toBeNull();
  });

  it("treats an expired session as logged out", () => {
    saveSession({ token: "abc", expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(getToken()).toBeNull();
  });

  it("ignores corrupt stored values", () => {
    clearSession();
    sessionStorage.setItem("admin.session", "{not json");
    expect(getSession()).toBeNull();
    sessionStorage.setItem("admin.session", JSON.stringify({ token: 1 }));
    expect(getSession()).toBeNull();
  });

  it("survives a throwing sessionStorage by keeping the session in memory", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    saveSession({ token: "mem", expires_at: future() });
    expect(getToken()).toBe("mem");
  });
});
