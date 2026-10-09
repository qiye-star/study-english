import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { useRoomsEnabled } from "./use-rooms-enabled";

function Probe() {
  return <p data-testid="rooms-enabled">{String(useRoomsEnabled())}</p>;
}

describe("useRoomsEnabled", () => {
  it("retries on the next mount after a transient config failure", async () => {
    let calls = 0;
    const mock = createFetchMock({
      "GET /api/rooms/config": () => (++calls === 1 ? json({ error: "Upstream unavailable" }, 502) : json({ enabled: true, ai_available: false, max_members: 8, max_text: 500 })),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const first = renderWithProviders(<Probe />, { api });
    await waitFor(() => expect(calls).toBe(1));
    expect(screen.getByTestId("rooms-enabled").textContent).toBe("false");
    first.unmount();
    renderWithProviders(<Probe />, { api });
    await waitFor(() => expect(screen.getByTestId("rooms-enabled").textContent).toBe("true"));
    expect(calls).toBe(2);
  });
});
