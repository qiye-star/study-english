import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { PracticePage, formatClock } from "./practice-page";

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

function setup(routes: Parameters<typeof createFetchMock>[0], envOverrides = {}) {
  const mock = createFetchMock(routes);
  const fake = createFakeRecorderEnv(envOverrides);
  renderWithProviders(<PracticePage recorderEnv={fake.env} />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: "/practice",
  });
  return { mock, fake };
}

describe("PracticePage", () => {
  beforeEach(() => localStorage.clear());

  it("formats the timer", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65_400)).toBe("01:05");
  });

  it("needs reference text before recording", async () => {
    setup({});
    expect(screen.getByTestId("record-toggle")).toBeDisabled();
    await userEvent.type(screen.getByTestId("reference-input"), "Hello world");
    expect(screen.getByTestId("record-toggle")).toBeEnabled();
    expect(JSON.parse(localStorage.getItem("enjoy-web.practice.reference")!)).toBe("Hello world");
  });

  it("records, uploads with save=true and opens the result", async () => {
    const { mock } = setup({ "POST /api/speech/assessments": () => json({ pronunciation_score: 88, assessment_id: "a1" }) });
    await userEvent.type(screen.getByTestId("reference-input"), "  Hello world  ");
    await userEvent.click(screen.getByTestId("record-toggle"));
    expect(screen.getByTestId("practice-status")).toHaveAttribute("data-state", "recording");
    await userEvent.click(screen.getByTestId("record-toggle"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice/assessments/a1"));
    const form = mock.calls[0].body as FormData;
    expect(form.get("reference")).toBe("Hello world");
    expect(form.get("language")).toBe("en-US");
    expect(form.get("save")).toBe("true");
  });

  it("shows translated server errors", async () => {
    setup({ "POST /api/speech/assessments": () => json({ error: "Reference text is required" }, 400) });
    await userEvent.type(screen.getByTestId("reference-input"), "Hi");
    await userEvent.click(screen.getByTestId("record-toggle"));
    await userEvent.click(screen.getByTestId("record-toggle"));
    expect(await screen.findByTestId("practice-error")).toHaveTextContent("Please enter the reference text first.");
  });

  it("explains microphone permission problems", async () => {
    setup({}, { getUserMedia: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } });
    await userEvent.type(screen.getByTestId("reference-input"), "Hi");
    await userEvent.click(screen.getByTestId("record-toggle"));
    expect(await screen.findByTestId("practice-error")).toHaveTextContent("Microphone access was denied");
  });

  it("keeps audio recorded before going to the background", async () => {
    const { mock, fake } = setup({ "POST /api/speech/assessments": () => json({ assessment_id: "a2" }) });
    await userEvent.type(screen.getByTestId("reference-input"), "Hi");
    await userEvent.click(screen.getByTestId("record-toggle"));
    await act(async () => fake.setHidden());
    await waitFor(() => expect(screen.getByTestId("practice-status")).toHaveAttribute("data-state", "kept"));
    await userEvent.click(screen.getByTestId("practice-assess-kept"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice/assessments/a2"));
    expect(mock.calls).toHaveLength(1);
  });

  it("can discard the kept audio", async () => {
    const { mock, fake } = setup({});
    await userEvent.type(screen.getByTestId("reference-input"), "Hi");
    await userEvent.click(screen.getByTestId("record-toggle"));
    await act(async () => fake.setHidden());
    await userEvent.click(await screen.findByTestId("practice-discard"));
    expect(screen.getByTestId("practice-status")).toHaveAttribute("data-state", "idle");
    expect(mock.calls).toHaveLength(0);
  });
});
