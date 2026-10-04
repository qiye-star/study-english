import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth, loadAuth, saveAuth } from "./auth-storage";

const AUTH = { token: "tok", user: { id: "12345678", name: "alice" } };

describe("auth storage", () => {
  beforeEach(() => { clearAuth(); localStorage.clear(); });
  afterEach(() => vi.restoreAllMocks());
  it("persists to localStorage under enjoy-web.auth", () => {
    saveAuth(AUTH);
    expect(JSON.parse(localStorage.getItem("enjoy-web.auth")!)).toEqual(AUTH);
    expect(loadAuth()).toEqual(AUTH);
  });
  it("ignores invalid stored values", () => {
    localStorage.setItem("enjoy-web.auth", JSON.stringify({ token: "", user: {} }));
    expect(loadAuth()).toBeNull();
  });
  it("falls back to memory when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("private mode"); });
    saveAuth(AUTH);
    expect(loadAuth()).toEqual(AUTH);
  });
  it("clear removes both copies", () => {
    saveAuth(AUTH);
    clearAuth();
    expect(loadAuth()).toBeNull();
    expect(localStorage.getItem("enjoy-web.auth")).toBeNull();
  });
});
