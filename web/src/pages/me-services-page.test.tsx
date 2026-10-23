import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { MeServicesPage } from "./me-services-page";

const ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1", "azure/speech"], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

describe("MeServicesPage (/me/services)", () => {
  beforeEach(() => resetServerAiConfigCache());

  it("shows the server speech services read-only", async () => {
    renderWithProviders(<MeServicesPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    await waitFor(() => expect(screen.getByTestId("services-info")).toHaveTextContent("openai/tts-1, azure/speech"));
    expect(screen.getByTestId("services-info")).toHaveTextContent("alloy");
  });

  it("shows a translated error with a retry button when the server config fails", async () => {
    let fail = true;
    const mock = createFetchMock({ ...ROUTES, "GET /api/config/gpt_providers": () => (fail ? json({ error: "boom" }, 500) : json({ enjoyai: { models: ["gpt-4o"] } })) });
    renderWithProviders(<MeServicesPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(await screen.findByTestId("services-error")).toHaveTextContent("Something went wrong.");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("services-info")).toHaveTextContent("openai/tts-1"));
    expect(screen.queryByTestId("services-error")).toBeNull();
  });
});
