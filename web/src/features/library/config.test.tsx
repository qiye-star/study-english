import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { LIBRARY_DISABLED, fetchLibraryConfig, useLibraryConfig } from "./config";
import { CONFIG_RAW } from "./test-fixtures";

const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

describe("library config (spec §9, R-L6)", () => {
  it("camelCases the config", async () => {
    const { api } = client({ "GET /api/library/config": () => json(CONFIG_RAW) });
    const config = await fetchLibraryConfig(api);
    expect(config.enabled).toBe(true);
    expect(config.linkImport).toBe(true);
    expect(config.ai).toBe(true);
    expect(config.limits?.chunkBytes).toBe(8388608);
    expect(config.limits?.usedBytes).toBe(10 * 1024 * 1024);
  });

  it("treats a 404 (server without the library) as disabled and rethrows other errors", async () => {
    expect(await fetchLibraryConfig(client({}).api)).toEqual(LIBRARY_DISABLED);
    const { api } = client({ "GET /api/library/config": () => json({ error: "boom" }, 500) });
    await expect(fetchLibraryConfig(api)).rejects.toMatchObject({ status: 500 });
  });

  it("caches one successful answer per ApiClient", async () => {
    const { mock, api } = client({ "GET /api/library/config": () => json(CONFIG_RAW) });
    const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
    const first = renderHook(() => useLibraryConfig(), { wrapper });
    await waitFor(() => expect(first.result.current?.enabled).toBe(true));
    const second = renderHook(() => useLibraryConfig(), { wrapper });
    await waitFor(() => expect(second.result.current?.enabled).toBe(true));
    expect(mock.calls).toHaveLength(1);
  });
});
