import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { usePosterUrl } from "./use-poster";

let observed: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
class FakeIO {
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { observed = cb; }
  observe() {}
  disconnect() {}
}
const original = { IO: globalThis.IntersectionObserver, create: URL.createObjectURL, revoke: URL.revokeObjectURL };

beforeEach(() => {
  observed = null;
  globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;
  URL.createObjectURL = vi.fn(() => "blob:poster-1");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup(); // 先卸载组件(它的清理会调 URL.revokeObjectURL),再还原全局;否则 RTL 的自动清理晚于本钩子,会碰到已还原成 undefined 的 revokeObjectURL
  globalThis.IntersectionObserver = original.IO;
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
});

function setup(enabled: boolean, withTarget: boolean) {
  const mock = createFetchMock({ "GET /api/library/items/i1/poster": () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/jpeg" } }) });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  const target = createRef<HTMLDivElement>();
  if (withTarget) (target as { current: HTMLDivElement | null }).current = document.createElement("div");
  return { mock, ...renderHook(() => usePosterUrl("i1", enabled, withTarget ? target : undefined), { wrapper }) };
}

describe("usePosterUrl (R-L18)", () => {
  it("fetches with Bearer at once without a target and revokes on unmount", async () => {
    const { mock, result, unmount } = setup(true, false);
    await waitFor(() => expect(result.current).toBe("blob:poster-1"));
    expect(mock.calls[0].headers.get("Authorization")).toBe("Bearer t");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:poster-1");
  });

  it("waits until the card scrolls into view", async () => {
    const { mock, result } = setup(true, true);
    expect(mock.calls).toHaveLength(0);
    act(() => observed?.([{ isIntersecting: true }]));
    await waitFor(() => expect(result.current).toBe("blob:poster-1"));
  });

  it("does nothing when disabled", () => {
    const { mock, result } = setup(false, false);
    expect(result.current).toBeNull();
    expect(mock.calls).toHaveLength(0);
  });
});
