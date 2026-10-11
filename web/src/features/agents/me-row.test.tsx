import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { AgentsMeRow } from "./me-row";

const ON = { enabled: true, available: true, tutor: true, memory: true, rooms: true, tools_mode: "prefetch",
  limits: { personas_max: 10, prompt_max_chars: 800, history_max: 20, text_max_chars: 2000 } };
const render = (response: () => Response) => renderWithProviders(<AgentsMeRow />, {
  api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock({ "GET /api/agents/config": response }).fetch }),
});

describe("AgentsMeRow", () => {
  it("links to /me/agents when agents are on", async () => {
    render(() => json(ON));
    expect(await screen.findByTestId("me-agents")).toHaveAttribute("href", "/me/agents");
  });
  it("renders nothing when the server says disabled ({enabled:false}) or is old (404)", async () => {
    render(() => json({ enabled: false }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("me-agents")).toBeNull();
    render(() => json({ error: "Not Found" }, 404));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("me-agents")).toBeNull();
  });
});
