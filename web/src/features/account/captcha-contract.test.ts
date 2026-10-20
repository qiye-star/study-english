import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { createFetchMock, json } from "~/test/fetch-mock";
import { useCaptchaGate } from "~/components/captcha";

/**
 * 跨计划契约(INDEX X34–X37):server/tests/fixtures/captcha_contract.json 由服务端录制(分支 feat/cap-s)。
 * 这里只按键读取,核对 web 的解析器、错误映射与门的行为能处理夹具里的每个形状。
 *
 * 夹具记录的是测试设置:`challenge.parameters.cost` 为 1(生产远大于此)。因此这里只断言形状与键名,
 * 从不断言 `cost`、`expiresAt` 或任何随机值(它们在夹具里都是 REDACTED 占位)。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const C: Record<string, Record<string, unknown>> = JSON.parse(
  readFileSync(path.resolve(here, "../../../../server/tests/fixtures/captcha_contract.json"), "utf8"),
);

const KEYS = ["config_off", "config_adaptive", "challenge", "error_required", "error_invalid", "error_not_configured", "error_off"];

/** 挑战参数的键与类型(与 altcha 3.4.1 的 Challenge 形状一致)。 */
const CHALLENGE_PARAM_TYPES: Record<string, "string" | "number"> = {
  algorithm: "string",
  cost: "number",
  keyLength: "number",
  keyPrefix: "string",
  keySignature: "string",
  nonce: "string",
  salt: "string",
  expiresAt: "number",
};

const keysOf = (value: unknown) => Object.keys(value as Record<string, unknown>).sort();
const passthroughT = ((key: string) => key) as unknown as TFunction;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

function clientWith(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  return new ApiClient({ getToken: () => null, fetchImpl: mock.fetch });
}

describe("captcha contract fixture (INDEX X34–X37)", () => {
  it("records exactly the keys the web mirrors", () => {
    expect(Object.keys(C).sort()).toEqual([...KEYS].sort());
  });

  it("config_off / config_adaptive: GET /api/captcha/config parses to CaptchaConfig and the gate reads the mode", async () => {
    expect(keysOf(C.config_off)).toEqual(["mode"]);
    expect(keysOf(C.config_adaptive)).toEqual(["mode"]);

    const off = clientWith({ "GET /api/captcha/config": () => json(C.config_off) });
    await expect(off.captchaConfig()).resolves.toEqual({ mode: "off" });

    const adaptive = clientWith({ "GET /api/captcha/config": () => json(C.config_adaptive) });
    await expect(adaptive.captchaConfig()).resolves.toEqual({ mode: "adaptive" });

    const offGate = renderHook(() => useCaptchaGate(off, "register"));
    await flush();
    expect(offGate.result.current.needed).toBe(false);

    const adaptiveGate = renderHook(() => useCaptchaGate(adaptive, "register"));
    await flush();
    expect(adaptiveGate.result.current.needed).toBe(true);

    const adaptiveLogin = renderHook(() => useCaptchaGate(adaptive, "login"));
    await flush();
    expect(adaptiveLogin.result.current.needed).toBe(false);
  });

  it("challenge: parameters have exactly the altcha keys with the right types, plus a string signature", () => {
    const challenge = C.challenge as { parameters: Record<string, unknown>; signature: unknown };
    expect(keysOf(challenge)).toEqual(["parameters", "signature"]);
    expect(keysOf(challenge.parameters)).toEqual(Object.keys(CHALLENGE_PARAM_TYPES).sort());
    for (const [key, type] of Object.entries(CHALLENGE_PARAM_TYPES)) {
      expect(typeof challenge.parameters[key], key).toBe(type);
    }
    expect(typeof challenge.signature).toBe("string");
  });

  it("error_required / error_invalid: a 428 with that body is an ApiError the gate treats as a server-side captcha demand", async () => {
    for (const key of ["error_required", "error_invalid"] as const) {
      expect(keysOf(C[key])).toEqual(["error"]);
      const api = clientWith({ "POST /api/email/code": () => json(C[key], 428) });
      const err = await api.request("POST", "/api/email/code", { json: { email: "a@example.com", purpose: "register" }, auth: false }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(428);
      expect((err as ApiError).message).toBe(C[key].error);
      expect(translateServerError(passthroughT, err)).toBe(
        key === "error_required" ? "web.errors.captchaRequired" : "web.errors.captchaInvalid",
      );

      const gate = renderHook(() => useCaptchaGate(api, "login"));
      await flush();
      expect(gate.result.current.needed).toBe(false);
      let handled = false;
      act(() => {
        handled = gate.result.current.onServerError(err);
      });
      expect(handled).toBe(true);
      expect(gate.result.current.needed).toBe(true);
    }
  });

  it("error_not_configured: a 503 with that body maps to the not-configured message and is not a 428", async () => {
    expect(keysOf(C.error_not_configured)).toEqual(["error"]);
    const api = clientWith({ "POST /api/email/code": () => json(C.error_not_configured, 503) });
    const err = await api.request("POST", "/api/email/code", { json: {}, auth: false }).catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).message).toBe(C.error_not_configured.error);
    expect(translateServerError(passthroughT, err)).toBe("web.errors.captchaNotConfigured");

    const gate = renderHook(() => useCaptchaGate(api, "register"));
    let handled = true;
    act(() => {
      handled = gate.result.current.onServerError(err);
    });
    expect(handled).toBe(false);
  });

  it("error_off: a 404 with that body is an ApiError with the server message and is not a 428", async () => {
    expect(keysOf(C.error_off)).toEqual(["error"]);
    const api = clientWith({ "GET /api/captcha/challenge": () => json(C.error_off, 404) });
    const err = await api.request("GET", "/api/captcha/challenge", { auth: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe(C.error_off.error);

    const gate = renderHook(() => useCaptchaGate(api, "register"));
    let handled = true;
    act(() => {
      handled = gate.result.current.onServerError(err);
    });
    expect(handled).toBe(false);
  });
});
