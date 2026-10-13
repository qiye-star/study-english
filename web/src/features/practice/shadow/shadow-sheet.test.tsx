import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import type { ShadowRequest } from "./shadow-context";
import { ShadowSheet } from "./shadow-sheet";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

const CONFIG_ROUTES: Record<string, Handler> = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

const REFERENCE = "Could I get a medium latte, please?";
const LIST = ["Try saying it politely.", "It sounds natural.", "Make it oat milk, if possible."];
const ASSESSED = {
  pronunciation_score: 88, accuracy_score: 80, fluency_score: 85, completeness_score: 100, assessment_id: "a1",
  detail_result: {
    words: [
      { word: "Could", pronunciation_assessment: { accuracy_score: 95, error_type: "None" } },
      { word: "I", pronunciation_assessment: { accuracy_score: 95, error_type: "None" } },
      { word: "get", pronunciation_assessment: { accuracy_score: 75, error_type: "None" } },
      { word: "a", pronunciation_assessment: { accuracy_score: 95, error_type: "None" } },
      { word: "medium", pronunciation_assessment: { accuracy_score: 40, error_type: "Mispronunciation" } },
      { word: "latte", pronunciation_assessment: { accuracy_score: 50, error_type: "Mispronunciation" } },
      { word: "please", pronunciation_assessment: { accuracy_score: 90, error_type: "None" } },
    ],
  },
};

function setup(options: {
  request?: Partial<ShadowRequest>; routes?: Record<string, Handler>; env?: Parameters<typeof createFakeRecorderEnv>[0]; onClose?: () => void;
} = {}) {
  const mock = createFetchMock({ ...CONFIG_ROUTES, ...options.routes });
  const fake = createFakeRecorderEnv(options.env);
  const onClose = options.onClose ?? vi.fn();
  const request: ShadowRequest = { id: 1, items: [REFERENCE], index: 0, source: "chat", ...options.request };
  const view = renderWithProviders(<ShadowSheet request={request} onClose={onClose} recorderEnv={fake.env} />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1",
  });
  return { mock, fake, onClose, view };
}

const assessCalls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname === "/api/speech/assessments");
const ASSESS_OK: Record<string, Handler> = { "POST /api/speech/assessments": () => json(ASSESSED) };

async function recordAndStop() {
  await userEvent.click(screen.getByTestId("shadow-record"));
  await userEvent.click(await screen.findByTestId("shadow-stop"));
}

describe("ShadowSheet", () => {
  beforeEach(() => {
    localStorage.clear();
    resetServerAiConfigCache();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mine"), revokeObjectURL: vi.fn() });
    Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
  });

  it("shows the sentence as a lookup context, with no neighbours for a single sentence", () => {
    setup();
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "idle");
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent(REFERENCE);
    expect(screen.getByTestId("shadow-reference")).toHaveAttribute("data-lookup-context");
    expect(screen.queryByTestId("shadow-position")).toBeNull();
    expect(screen.queryByTestId("shadow-prev")).toBeNull();
    expect(screen.queryByTestId("shadow-next")).toBeNull();
    expect(screen.getByTestId("shadow-hint")).toBeInTheDocument();
  });

  it("walks a sentence list with position, previous and next", async () => {
    setup({ request: { items: LIST, index: 0 } });
    expect(screen.getByTestId("shadow-position")).toHaveTextContent("1 / 3");
    expect(screen.getByTestId("shadow-prev")).toBeDisabled();
    await userEvent.click(screen.getByTestId("shadow-next"));
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent(LIST[1]);
    expect(screen.getByTestId("shadow-position")).toHaveTextContent("2 / 3");
    await userEvent.click(screen.getByTestId("shadow-next"));
    expect(screen.getByTestId("shadow-next")).toBeDisabled();
    await userEvent.click(screen.getByTestId("shadow-prev"));
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent(LIST[1]);
  });

  it("records, assesses with save=true and no source, and shows the result in place", async () => {
    const { mock } = setup({ routes: ASSESS_OK });
    await userEvent.click(screen.getByTestId("shadow-record"));
    expect(await screen.findByTestId("shadow-stop")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "recording");
    expect(screen.getByTestId("shadow-recording")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-timer")).toHaveTextContent("00:00");
    await userEvent.click(screen.getByTestId("shadow-stop"));
    expect(await screen.findByTestId("shadow-result")).toBeInTheDocument();
    const form = assessCalls(mock)[0].body as FormData;
    expect(form.get("reference")).toBe(REFERENCE);
    expect(form.get("language")).toBe("en-US");
    expect(form.get("save")).toBe("true");
    expect(form.get("source")).toBeNull();
    expect(screen.getByTestId("shadow-ring")).toHaveAttribute("data-score", "88");
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "result");
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1"); // 没有导航
  });

  it("pauses the selection bar and the sentence list while recording and assessing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setup({ request: { items: LIST, index: 1 }, routes: { "POST /api/speech/assessments": async () => { await gate; return json(ASSESSED); } } });
    await userEvent.click(screen.getByTestId("shadow-record"));
    await screen.findByTestId("shadow-stop");
    expect(screen.getByTestId("shadow-reference")).not.toHaveAttribute("data-lookup-context");
    expect(screen.getByTestId("shadow-prev")).toBeDisabled();
    expect(screen.getByTestId("shadow-next")).toBeDisabled();
    expect(screen.getByTestId("shadow-listen")).toBeDisabled();
    await userEvent.click(screen.getByTestId("shadow-stop"));
    expect(await screen.findByTestId("shadow-assessing")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "assessing");
    expect(screen.getByTestId("shadow-busy")).toBeDisabled();
    expect(screen.getByTestId("shadow-reference")).not.toHaveAttribute("data-lookup-context");
    await act(async () => { release(); });
    await screen.findByTestId("shadow-result");
  });

  it("explains microphone permission problems and offers to record again", async () => {
    setup({ env: { getUserMedia: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } } });
    await userEvent.click(screen.getByTestId("shadow-record"));
    expect(await screen.findByTestId("shadow-error")).toHaveTextContent("Microphone access was denied");
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "error");
    expect(screen.getByTestId("shadow-record")).toHaveTextContent("Try recording again");
  });

  it("keeps the recording after a failed upload (translated error) and retries it", async () => {
    let attempt = 0;
    const { mock } = setup({
      routes: { "POST /api/speech/assessments": () => (++attempt === 1 ? json({ error: "Upstream unavailable" }, 502) : json(ASSESSED)) },
    });
    await recordAndStop();
    expect(await screen.findByTestId("shadow-error")).toHaveTextContent("assessment service is unavailable");
    expect(screen.getByTestId("shadow-error")).not.toHaveTextContent("Upstream");
    expect(screen.getByTestId("shadow-error")).toHaveTextContent("Your last recording was kept.");
    await userEvent.click(await screen.findByTestId("shadow-assess-kept"));
    expect(await screen.findByTestId("shadow-result")).toBeInTheDocument();
    expect(assessCalls(mock)).toHaveLength(2);
  });

  it("keeps audio recorded before going to the background and can discard it", async () => {
    const { mock, fake } = setup({ routes: ASSESS_OK });
    await userEvent.click(screen.getByTestId("shadow-record"));
    await screen.findByTestId("shadow-stop");
    await act(async () => fake.setHidden());
    expect(await screen.findByTestId("shadow-kept")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-error")).toHaveTextContent("went to the background");
    await userEvent.click(screen.getByTestId("shadow-discard"));
    expect(screen.queryByTestId("shadow-kept")).toBeNull();
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "idle");
    expect(assessCalls(mock)).toHaveLength(0);
  });

  it("reads the sentence with the server default voice, and stops the reading when recording starts", async () => {
    const { mock } = setup({
      request: { items: ["Listen test sentence one."] },
      routes: { "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) },
    });
    await waitFor(() => expect(screen.getByTestId("shadow-listen")).toBeEnabled());
    await userEvent.click(screen.getByTestId("shadow-listen"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(); // 静音解锁先于合成完成
    await waitFor(() => expect(screen.getByTestId("shadow-listen")).toHaveAttribute("data-state", "playing"));
    const body = JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/ai/audio/speech")!.body as string);
    expect(body).toEqual({ input: "Listen test sentence one.", model: "openai/tts-1", voice: "alloy" });
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    await userEvent.click(screen.getByTestId("shadow-record"));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("shadow-listen")).toHaveAttribute("data-state", "idle"));
  });

  it("explains when the voice settings cannot load, and still records", async () => {
    setup({
      routes: {
        "GET /api/config/gpt_providers": () => json({ error: "x" }, 500),
        "GET /api/config/default_gpt_preset": () => json({ error: "x" }, 500),
        "GET /api/config/tts_providers_v2": () => json({ error: "x" }, 500),
        "GET /api/config/default_tts_preset": () => json({ error: "x" }, 500),
        ...ASSESS_OK,
      },
    });
    expect(await screen.findByTestId("shadow-listen-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-listen")).toBeDisabled();
    await recordAndStop();
    expect(await screen.findByTestId("shadow-result")).toBeInTheDocument();
  });

  it("shows a translated toast, never the raw text, when the speech request fails", async () => {
    setup({ request: { items: ["Toast test sentence."] }, routes: { "POST /api/ai/audio/speech": () => json({ error: "boom" }, 500) } });
    await waitFor(() => expect(screen.getByTestId("shadow-listen")).toBeEnabled());
    await userEvent.click(screen.getByTestId("shadow-listen"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).not.toMatch(/^web\./);
    expect(vi.mocked(toast.error).mock.calls[0][0]).not.toContain("boom");
  });

  it("the result actions: save, standard voice, my recording, try again", async () => {
    const { mock } = setup({
      request: { source: "grammar" },
      routes: {
        ...ASSESS_OK,
        "POST /api/practice-items": () => json({ id: "p1", text: REFERENCE, source: "grammar", created_at: "t" }),
        "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])),
      },
    });
    await recordAndStop();
    await screen.findByTestId("shadow-result");

    await userEvent.click(screen.getByTestId("shadow-fav"));
    await waitFor(() => expect(screen.getByTestId("shadow-fav")).toBeDisabled());
    expect(screen.getByTestId("shadow-fav")).toHaveTextContent("Saved");
    const saved = mock.calls.find((c) => c.url.pathname === "/api/practice-items")!;
    expect(JSON.parse(saved.body as string)).toEqual({ text: REFERENCE, source: "grammar" });
    expect(toast.success).toHaveBeenCalledWith("Saved to your practice list.");

    await userEvent.click(screen.getByTestId("shadow-mine"));
    expect(screen.getByTestId("shadow-mine")).toHaveAttribute("data-state", "playing");
    await userEvent.click(screen.getByTestId("shadow-mine"));
    expect(screen.getByTestId("shadow-mine")).toHaveAttribute("data-state", "idle");

    await userEvent.click(screen.getByTestId("shadow-standard"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/ai/audio/speech")).toBe(true));

    await userEvent.click(screen.getByTestId("shadow-again"));
    expect(screen.queryByTestId("shadow-result")).toBeNull();
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "idle");
    expect(assessCalls(mock)).toHaveLength(1);
  });

  it("continues to the next sentence of a list and finishes on the last one", async () => {
    const { onClose } = setup({ request: { items: LIST, index: 1 }, routes: ASSESS_OK });
    await recordAndStop();
    await screen.findByTestId("shadow-result");
    expect(screen.getByTestId("shadow-continue")).toHaveAttribute("data-kind", "next");
    await userEvent.click(screen.getByTestId("shadow-continue"));
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent(LIST[2]);
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "idle");
    await recordAndStop();
    await screen.findByTestId("shadow-result");
    expect(screen.getByTestId("shadow-continue")).toHaveAttribute("data-kind", "done");
    await userEvent.click(screen.getByTestId("shadow-continue"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a single sentence finishes with Done", async () => {
    const { onClose } = setup({ routes: ASSESS_OK });
    await recordAndStop();
    await screen.findByTestId("shadow-result");
    expect(screen.getByTestId("shadow-continue")).toHaveTextContent("Done");
    await userEvent.click(screen.getByTestId("shadow-continue"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the full detail page after closing the sheet", async () => {
    const { onClose } = setup({ routes: ASSESS_OK });
    await recordAndStop();
    await screen.findByTestId("shadow-result");
    await userEvent.click(screen.getByTestId("shadow-details"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/practice/assessments/a1");
  });

  it("moving to another sentence drops the previous result", async () => {
    setup({ request: { items: LIST, index: 0 }, routes: ASSESS_OK });
    await recordAndStop();
    await screen.findByTestId("shadow-result");
    await userEvent.click(screen.getByTestId("shadow-continue"));
    expect(screen.queryByTestId("shadow-result")).toBeNull();
    expect(screen.getByTestId("shadow-record")).toBeInTheDocument();
  });

  it("puts the aurora inside the scrim while open, and nowhere once closed", () => {
    const { view } = setup();
    const scrim = screen.getByTestId("shadow-scrim");
    const aurora = screen.getByTestId("shadow-aurora");
    expect(scrim).toContainElement(aurora);
    expect(aurora).toHaveAttribute("aria-hidden");
    expect(aurora.querySelectorAll("i")).toHaveLength(3);
    view.unmount();
    expect(screen.queryByTestId("shadow-scrim")).toBeNull();
    expect(screen.queryByTestId("shadow-aurora")).toBeNull();
  });

  it("releases the microphone when unmounted mid-recording, and never leaks the text into the URL", async () => {
    const { fake, view, mock } = setup();
    await userEvent.click(screen.getByTestId("shadow-record"));
    await screen.findByTestId("shadow-stop");
    expect(fake.track.stop).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(fake.track.stop).toHaveBeenCalled());
    expect(mock.calls.every((c) => !decodeURIComponent(c.url.href).includes("latte"))).toBe(true);
  });
});
