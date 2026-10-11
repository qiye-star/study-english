import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ReportPersonaSheet } from "./report-persona-sheet";

describe("ReportPersonaSheet (spec §9.1)", () => {
  it("sends only a reason (server forbids extra fields), then thanks the user and closes", async () => {
    const success = vi.spyOn(toast, "success");
    const mock = createFetchMock({ "POST /api/agents/personas/p%3A1/report": () => json({ ok: true }) });
    const onClose = vi.fn();
    renderWithProviders(<ReportPersonaSheet persona={{ id: "p:1", name: "Quiz" }} onClose={onClose} />,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(screen.getByTestId("agent-report-submit")).toBeDisabled();
    await userEvent.click(screen.getByTestId("agent-report-reason-offensive"));
    await userEvent.click(screen.getByTestId("agent-report-submit"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ reason: "offensive" });
    expect(mock.calls[0].url.search).toBe("");
    expect(success).toHaveBeenCalledWith("Report sent. An admin will review it.");
  });

  it("keeps the sheet open with an error when sending fails", async () => {
    const mock = createFetchMock({ "POST /api/agents/personas/p1/report": () => json({ error: "x" }, 500) });
    const onClose = vi.fn();
    renderWithProviders(<ReportPersonaSheet persona={{ id: "p1", name: "Quiz" }} onClose={onClose} />,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await userEvent.click(screen.getByTestId("agent-report-reason-spam"));
    await userEvent.click(screen.getByTestId("agent-report-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not send the report.");
    expect(onClose).not.toHaveBeenCalled();
  });
});
