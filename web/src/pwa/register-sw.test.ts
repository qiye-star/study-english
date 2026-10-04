import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./register-sw";

describe("registerServiceWorker", () => {
  it("does nothing in development or without support", () => {
    expect(registerServiceWorker({ prod: false })).toBe(false);
    expect(registerServiceWorker({ prod: true }, {} as Navigator)).toBe(false);
  });
  it("registers /sw.js after load in production", () => {
    const register = vi.fn(() => Promise.resolve());
    const nav = { serviceWorker: { register } } as unknown as Navigator;
    const win = { addEventListener: (_: string, fn: () => void) => fn() } as unknown as Window;
    expect(registerServiceWorker({ prod: true }, nav, win)).toBe(true);
    expect(register).toHaveBeenCalledWith("/sw.js");
  });
});
