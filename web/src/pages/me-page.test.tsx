import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { MePage } from "./me-page";

const ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1", "azure/speech"], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

describe("MePage", () => {
  beforeEach(() => { resetServerAiConfigCache(); localStorage.clear(); });
  it("shows the account, server services and logs out", async () => {
    const mock = createFetchMock(ROUTES);
    const logout = vi.fn();
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), logout });
    expect(screen.getByTestId("me-username")).toHaveTextContent("alice");
    await waitFor(() => expect(screen.getByTestId("me-services")).toHaveTextContent("openai/tts-1, azure/speech"));
    expect(screen.getByTestId("me-services")).toHaveTextContent("alloy");
    await userEvent.click(screen.getByTestId("me-logout"));
    expect(logout).toHaveBeenCalled();
  });
  it("changes the language", async () => {
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    await userEvent.selectOptions(screen.getByTestId("me-language"), "zh-CN");
    expect(await screen.findByText("退出登录")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("me-language"), "en");
  });
  it("shows a translated error with a retry button when the server config fails", async () => {
    let fail = true;
    const mock = createFetchMock({ ...ROUTES, "GET /api/config/gpt_providers": () => (fail ? json({ error: "boom" }, 500) : json({ enjoyai: { models: ["gpt-4o"] } })) });
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(await screen.findByTestId("me-ai-error")).toHaveTextContent("Something went wrong.");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("me-services")).toHaveTextContent("openai/tts-1"));
    expect(screen.queryByTestId("me-ai-error")).toBeNull();
  });
});
