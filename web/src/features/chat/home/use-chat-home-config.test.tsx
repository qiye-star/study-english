import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { CONFIG_WAIT_MS, useChatHomeConfig } from "./use-chat-home-config";

function Probe() {
  return <p data-testid="status">{useChatHomeConfig().status}</p>;
}
function mount(handler: Handler) {
  const mock = createFetchMock({ "GET /api/chat-home/config": handler });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  renderWithProviders(<Probe />, { api });
  return { mock, api };
}

afterEach(() => vi.useRealTimers());

describe("useChatHomeConfig", () => {
  it("is loading, then on when the server flag is on", async () => {
    mount(() => json({ enabled: true, llm: false }));
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("on"));
  });

  it.each([
    ["the flag is off", () => json({ enabled: false, llm: false })],
    ["the endpoint is 404", () => json({ error: "Not Found" }, 404)],
    ["the request fails", () => json({ error: "x" }, 500)],
  ] as Array<[string, Handler]>)("is off when %s", async (_name, handler) => {
    mount(handler);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("off"));
  });

  describe("slow server", () => {
    beforeEach(() => vi.useFakeTimers());
    it("falls back to off after 3 s and stays off for this mount even if the answer arrives later", async () => {
      let release: (r: Response) => void = () => undefined;
      mount(() => new Promise<Response>((resolve) => { release = resolve; }));
      expect(screen.getByTestId("status")).toHaveTextContent("loading");
      await act(async () => { await vi.advanceTimersByTimeAsync(CONFIG_WAIT_MS + 1); });
      expect(screen.getByTestId("status")).toHaveTextContent("off");
      await act(async () => { release(json({ enabled: true, llm: true })); await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByTestId("status")).toHaveTextContent("off");
    });
  });
});
