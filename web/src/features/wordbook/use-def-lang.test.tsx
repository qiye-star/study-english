import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { CONFIG } from "./test-fixtures";
import { useDefLangSetting, useDefLangValue } from "./use-def-lang";

const PATCH = "PATCH /api/wordbook/enrollment"; // AD-1: the preference rides on the enrollment endpoint

function setup(config: unknown = CONFIG, extra: Record<string, Handler> = {}) {
  const mock = createFetchMock({ "GET /api/wordbook/config": () => json(config), ...extra });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  return { mock, api, wrapper };
}

describe("useDefLang", () => {
  it("defaults to en until the config arrives, then follows config.def_lang", async () => {
    const { wrapper } = setup({ ...CONFIG, def_lang: "zh" });
    const { result } = renderHook(() => useDefLangValue(), { wrapper });
    expect(result.current).toBe("en");
    await waitFor(() => expect(result.current).toBe("zh"));
  });

  it("stays English only on an old server without def_lang", async () => {
    const { wrapper, mock } = setup(CONFIG);
    const { result } = renderHook(() => useDefLangValue(), { wrapper });
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/config")).toBe(true));
    expect(result.current).toBe("en");
  });

  it("applies a change at once, sends it, and every reader of the same ApiClient sees it", async () => {
    let release!: () => void;
    const { wrapper, mock } = setup(CONFIG, {
      [PATCH]: () => new Promise<Response>((resolve) => { release = () => resolve(json({ def_lang: "en" })); }),
    });
    const setting = renderHook(() => useDefLangSetting(), { wrapper });
    const reader = renderHook(() => useDefLangValue(), { wrapper });
    let pending!: Promise<boolean>;
    act(() => { pending = setting.result.current.setDefLang("en"); });
    expect(setting.result.current.defLang).toBe("en"); // optimistic: the request has not returned
    expect(reader.result.current).toBe("en");
    expect(setting.result.current.saving).toBe(true);
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "PATCH")!.body))).toEqual({ def_lang: "en" });
    await act(async () => { release(); await pending; });
    expect(await pending).toBe(true);
    expect(setting.result.current.saving).toBe(false);
    expect(setting.result.current.error).toBeNull();
    expect(reader.result.current).toBe("en");
  });

  it("rolls back and explains when the save fails", async () => {
    const { wrapper } = setup({ ...CONFIG, def_lang: "zh" }, { [PATCH]: () => json({ error: "nope" }, 500) });
    const { result } = renderHook(() => useDefLangSetting(), { wrapper });
    await waitFor(() => expect(result.current.defLang).toBe("zh"));
    let ok = true;
    await act(async () => { ok = await result.current.setDefLang("en"); });
    expect(ok).toBe(false);
    expect(result.current.defLang).toBe("zh");
    expect(result.current.error).toBeTruthy();
  });

  it("a newer save wins over an older failing one", async () => {
    const fails: Array<() => void> = [];
    let calls = 0;
    const { wrapper } = setup(CONFIG, {
      [PATCH]: () => {
        calls += 1;
        if (calls === 1) return new Promise<Response>((resolve) => { fails.push(() => resolve(json({ error: "late" }, 500))); });
        return json({ def_lang: "zh" });
      },
    });
    const { result } = renderHook(() => useDefLangSetting(), { wrapper });
    act(() => { void result.current.setDefLang("en"); });
    await act(async () => { await result.current.setDefLang("zh"); });
    await act(async () => { fails[0](); });
    expect(result.current.defLang).toBe("zh");
    expect(result.current.error).toBeNull();
  });
});
