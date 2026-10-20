import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "~/api/client";
import type { CaptchaMode } from "~/api/types";
import type { CaptchaHandle } from "./captcha-widget";
import { useCaptchaGate, type CaptchaScope } from "./use-captcha-gate";

/** 只用到 captchaConfig 的假 ApiClient(测试替身,不发网络请求)。 */
function fakeApi(result: CaptchaMode | Error) {
  const captchaConfig = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve({ mode: result }),
  );
  return { api: { captchaConfig } as unknown as ApiClient, captchaConfig };
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

function setup(mode: CaptchaMode | Error, scope: CaptchaScope) {
  const { api, captchaConfig } = fakeApi(mode);
  const hook = renderHook(({ s }: { s: CaptchaScope }) => useCaptchaGate(api, s), { initialProps: { s: scope } });
  return { ...hook, captchaConfig };
}

describe("useCaptchaGate", () => {
  it("reads the mode once on mount", async () => {
    const { captchaConfig, rerender } = setup("adaptive", "register");
    await flush();
    rerender({ s: "register" });
    expect(captchaConfig).toHaveBeenCalledTimes(1);
  });

  it("off: nothing is needed for any scope", async () => {
    const { result } = setup("off", "register");
    await flush();
    expect(result.current.needed).toBe(false);
    expect(result.current.ready).toBe(true);
  });

  it("adaptive: register, email_code and reset need a captcha; login does not until the server asks", async () => {
    for (const scope of ["register", "email_code", "reset"] as const) {
      const { result, unmount } = setup("adaptive", scope);
      await flush();
      expect(result.current.needed, scope).toBe(true);
      unmount();
    }
    const login = setup("adaptive", "login");
    await flush();
    expect(login.result.current.needed).toBe(false);
  });

  it("always: login needs a captcha too", async () => {
    const { result } = setup("always", "login");
    await flush();
    expect(result.current.needed).toBe(true);
  });

  it("a failed mode request is treated as off and does not throw", async () => {
    const { result } = setup(new Error("network down"), "register");
    await flush();
    expect(result.current.needed).toBe(false);
  });

  it("onServerError turns a 428 into a needed captcha, clears the payload and returns true", async () => {
    const { result } = setup("adaptive", "login");
    await flush();
    act(() => result.current.setPayload("P"));
    let handled = false;
    act(() => {
      handled = result.current.onServerError(new ApiError(428, "captcha_required"));
    });
    expect(handled).toBe(true);
    expect(result.current.needed).toBe(true);
    expect(result.current.payload).toBeNull();
    expect(result.current.ready).toBe(false);
  });

  it("onServerError ignores other errors: returns false and changes nothing", async () => {
    const { result } = setup("adaptive", "login");
    await flush();
    act(() => result.current.setPayload("P"));
    let handled = true;
    act(() => {
      handled = result.current.onServerError(new ApiError(403, "Account disabled"));
    });
    expect(handled).toBe(false);
    expect(result.current.needed).toBe(false);
    expect(result.current.payload).toBe("P");
  });

  it("consumed() drops the payload and resets the widget, starting a new solve when still needed", async () => {
    const { result } = setup("adaptive", "register");
    await flush();
    const reset = vi.fn();
    (result.current.handleRef as { current: CaptchaHandle | null }).current = { reset };
    act(() => result.current.setPayload("P"));
    act(() => result.current.consumed());
    expect(result.current.payload).toBeNull();
    expect(reset).toHaveBeenCalledWith({ again: true });
  });

  it("consumed() without a needed captcha resets without starting a solve", async () => {
    const { result } = setup("off", "register");
    await flush();
    const reset = vi.fn();
    (result.current.handleRef as { current: CaptchaHandle | null }).current = { reset };
    act(() => result.current.consumed());
    expect(reset).toHaveBeenCalledWith({ again: false });
  });

  it("ready is true only when the captcha is not needed or a payload is present", async () => {
    const { result } = setup("adaptive", "register");
    await flush();
    expect(result.current.ready).toBe(false);
    act(() => result.current.setPayload("P"));
    expect(result.current.ready).toBe(true);
  });
});
