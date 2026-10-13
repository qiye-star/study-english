import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { CONFIG_OFF_RAW, CONFIG_RAW } from "./test-fixtures";
import { useLibraryEnabled } from "./use-library-enabled";

function Probe() {
  return <p data-testid="enabled">{String(useLibraryEnabled())}</p>;
}
const api = (mock: ReturnType<typeof createFetchMock>) => new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });

describe("useLibraryEnabled (spec E9)", () => {
  it("is false until the config says the library is on, then true", async () => {
    const mock = createFetchMock({ "GET /api/library/config": () => json(CONFIG_RAW) });
    renderWithProviders(<Probe />, { api: api(mock) });
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
    await waitFor(() => expect(screen.getByTestId("enabled")).toHaveTextContent("true"));
  });

  it.each([
    ["switched off", { "GET /api/library/config": () => json(CONFIG_OFF_RAW) }],
    ["an old server (404)", {}],
  ] as const)("stays false when %s", async (_name, routes) => {
    const mock = createFetchMock(routes);
    renderWithProviders(<Probe />, { api: api(mock) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
  });

  it("asks once per client and retries on the next mount after a transient failure", async () => {
    let calls = 0;
    const mock = createFetchMock({
      "GET /api/library/config": () => (++calls === 1 ? json({ error: "Upstream unavailable" }, 502) : json(CONFIG_RAW)),
    });
    const client = api(mock);
    const first = renderWithProviders(<Probe />, { api: client });
    await waitFor(() => expect(calls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
    first.unmount();
    renderWithProviders(<Probe />, { api: client });
    await waitFor(() => expect(screen.getByTestId("enabled")).toHaveTextContent("true"));
    expect(calls).toBe(2);
  });
});
