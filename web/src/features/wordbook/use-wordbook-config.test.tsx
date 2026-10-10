import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookSpellPage } from "./index";
import { useWordbookConfig, useWordbookEnabled } from "./use-wordbook-config";

function Probe() {
  return <p data-testid="wb">{String(useWordbookEnabled())}</p>;
}

function ConfigProbe() {
  const config = useWordbookConfig();
  return <p data-testid="cfg">{config === null ? "null" : config.enabled ? config.books.map((b) => b.titleZh).join(",") : "off"}</p>;
}

describe("useWordbookEnabled", () => {
  it("is false until the config says enabled, and caches per client", async () => {
    let calls = 0;
    const mock = createFetchMock({
      "GET /api/wordbook/config": () => {
        calls += 1;
        return json({ enabled: true, ai_available: false, defaults: { daily_new: 20, review_cap: 100 }, books: [] });
      },
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const first = renderWithProviders(<Probe />, { api });
    expect(screen.getByTestId("wb").textContent).toBe("false");
    await waitFor(() => expect(screen.getByTestId("wb").textContent).toBe("true"));
    first.unmount();
    renderWithProviders(<Probe />, { api });
    await waitFor(() => expect(screen.getByTestId("wb").textContent).toBe("true"));
    expect(calls).toBe(1);
  });

  it("treats a disabled server as off", async () => {
    const mock = createFetchMock({ "GET /api/wordbook/config": () => json({ enabled: false }) });
    renderWithProviders(<Probe />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(screen.getByTestId("wb").textContent).toBe("false");
  });

  it("treats a failed request as off and retries on the next mount", async () => {
    let fail = true;
    const mock = createFetchMock({
      "GET /api/wordbook/config": () =>
        fail ? json({ error: "boom" }, 500)
          : json({ enabled: true, ai_available: true, defaults: { daily_new: 20, review_cap: 100 },
            books: [{ id: "cet4", title_zh: "四级", title_en: "CET-4", level: 3, words: 4544, available: true }] }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const first = renderWithProviders(<ConfigProbe />, { api });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(screen.getByTestId("cfg").textContent).toBe("null");
    first.unmount();
    fail = false;
    renderWithProviders(<ConfigProbe />, { api });
    await waitFor(() => expect(screen.getByTestId("cfg").textContent).toBe("四级"));
    expect(mock.calls).toHaveLength(2);
  });
});

describe("WordbookSpellPage stub", () => {
  it("renders the placeholder until WS3 replaces it", () => {
    renderWithProviders(<WordbookSpellPage />);
    expect(screen.getByTestId("wordbook-spell-page")).toBeTruthy();
  });
});
