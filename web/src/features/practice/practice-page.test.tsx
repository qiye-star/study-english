import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { createFetchMock, json } from "~/test/fetch-mock";
import { contribute } from "~/lib/extension-points";
import { blurLayers, setLiquid } from "~/test/glass";
import { renderWithProviders } from "~/test/render";
import { toast } from "sonner";
import { PracticePage } from "./practice-page";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

function setup(routes: Parameters<typeof createFetchMock>[0], envOverrides = {}) {
  const mock = createFetchMock(routes);
  const fake = createFakeRecorderEnv(envOverrides);
  const view = renderWithProviders(<PracticePage recorderEnv={fake.env} />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: "/practice",
  });
  return { mock, fake, unmount: view.unmount };
}

const assessCalls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname === "/api/speech/assessments");

describe("PracticePage", () => {
  beforeEach(() => localStorage.clear());

  it("shows the wordbook card under the rank card when the wordbook is on", async () => {
    setup({
      "GET /api/wordbook/config": () => json({ enabled: true, ai_available: false, defaults: { daily_new: 20, review_cap: 100 }, books: [] }),
      "GET /api/wordbook/today": () => json({ enrollment: null, book: null, plan: null, progress: null, tomorrow_due: 0 }),
    });
    expect(await screen.findByTestId("wordbook-card")).toBeInTheDocument();
  });

  it("has no wordbook card when the wordbook is off", async () => {
    const { mock } = setup({ "GET /api/wordbook/config": () => json({ enabled: false }) });
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/config")).toBe(true));
    expect(screen.queryByTestId("wordbook-card")).toBeNull();
  });

  it("renders contributions of the practiceHeaderActions point left of the practice list link", () => {
    contribute({ point: "practiceHeaderActions", id: "test.header", component: () => <button type="button" data-testid="test-header">x</button> });
    setup({});
    const mine = screen.getByTestId("test-header");
    const list = screen.getByTestId("practice-list");
    expect(mine.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the changelog entry left of the practice list when something is published", async () => {
    setup({ "GET /api/changelog": () => json({ entries: [], next: null, unread: 2, latest_id: 5 }) });
    const entry = await screen.findByTestId("changelog-entry", {}, { timeout: 10_000 });
    expect(entry).toHaveAttribute("href", "/practice/changelog");
    expect(entry.compareDocumentPosition(screen.getByTestId("practice-list")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, 20_000);

  it("has no changelog entry when nothing is published", async () => {
    const { mock } = setup({ "GET /api/changelog": () => json({ entries: [], next: null, unread: 0, latest_id: null }) });
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/changelog")).toBe(true), { timeout: 10_000 });
    expect(screen.queryByTestId("changelog-entry")).toBeNull();
  }, 20_000);

  it("links to the progress page", () => {
    setup({});
    const link = screen.getByTestId("practice-progress");
    expect(link).toHaveAttribute("href", "/progress");
    expect(link).toHaveAccessibleName("Learning progress");
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
    const form = assessCalls(mock)[0].body as FormData;
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
    expect(assessCalls(mock)).toHaveLength(1);
  });

  it("can discard the kept audio", async () => {
    const { mock, fake } = setup({});
    await userEvent.type(screen.getByTestId("reference-input"), "Hi");
    await userEvent.click(screen.getByTestId("record-toggle"));
    await act(async () => fake.setHidden());
    await userEvent.click(await screen.findByTestId("practice-discard"));
    expect(screen.getByTestId("practice-status")).toHaveAttribute("data-state", "idle");
    expect(assessCalls(mock)).toHaveLength(0);
  });

  const recordOnce = async () => {
    await userEvent.type(screen.getByTestId("reference-input"), "Hi");
    await userEvent.click(screen.getByTestId("record-toggle"));
  };

  it("shows a generic localized message for unknown server errors", async () => {
    setup({ "POST /api/speech/assessments": () => json({ error: "pq: relation exploded" }, 500) });
    await recordOnce();
    await userEvent.click(screen.getByTestId("record-toggle"));
    const err = await screen.findByTestId("practice-error");
    expect(err).toHaveTextContent("Something went wrong.");
    expect(err).not.toHaveTextContent("exploded");
  });

  it("shows a translated save error when no assessment id comes back", async () => {
    setup({ "POST /api/speech/assessments": () => json({ pronunciation_score: 80 }) });
    await recordOnce();
    await userEvent.click(screen.getByTestId("record-toggle"));
    expect(await screen.findByTestId("practice-error")).toHaveTextContent("The recording could not be saved. Please try again.");
  });

  it("keeps the recording after a failed upload and retries", async () => {
    let attempt = 0;
    const { mock } = setup({
      "POST /api/speech/assessments": () => (++attempt === 1 ? json({ error: "Upstream unavailable" }, 502) : json({ assessment_id: "a3" })),
    });
    await recordOnce();
    await userEvent.click(screen.getByTestId("record-toggle"));
    expect(await screen.findByTestId("practice-error")).toHaveTextContent("assessment service is unavailable");
    await userEvent.click(await screen.findByTestId("practice-assess-kept"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice/assessments/a3"));
    expect(assessCalls(mock)).toHaveLength(2);
  });

  it("uploads automatically when the 5-minute limit is reached", async () => {
    const { mock, fake } = setup({ "POST /api/speech/assessments": () => json({ assessment_id: "a4" }) });
    await recordOnce();
    await act(async () => { fake.advance(300_000); fake.fireTimer(); });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice/assessments/a4"));
    expect(assessCalls(mock)).toHaveLength(1);
  });

  it("does not submit twice on a double click", async () => {
    const { mock, fake } = setup({ "POST /api/speech/assessments": () => json({ assessment_id: "a5" }) });
    await recordOnce();
    await act(async () => fake.setHidden());
    const button = await screen.findByTestId("practice-assess-kept");
    await act(async () => { button.click(); button.click(); });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice/assessments/a5"));
    expect(assessCalls(mock)).toHaveLength(1);
  });

  it("releases the microphone when unmounted mid-recording", async () => {
    const { fake, unmount } = setup({});
    await recordOnce();
    expect(fake.track.stop).not.toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(fake.track.stop).toHaveBeenCalled());
  });

  it("aborts the upload when unmounted mid-upload", async () => {
    const { mock, unmount } = setup({ "POST /api/speech/assessments": () => new Promise<Response>(() => {}) });
    await recordOnce();
    await userEvent.click(screen.getByTestId("record-toggle"));
    await waitFor(() => expect(assessCalls(mock)).toHaveLength(1));
    expect(assessCalls(mock)[0].signal?.aborted).toBe(false);
    unmount();
    expect(assessCalls(mock)[0].signal?.aborted).toBe(true);
  });
});

describe("PracticePage header", () => {
  it("links to the practice list", () => {
    setup({});
    const link = screen.getByTestId("practice-list");
    expect(link).toHaveAttribute("href", "/practice/list");
  });
});

const CONFIG_ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

describe("PracticePage listen first", () => {
  beforeEach(() => {
    localStorage.clear();
    resetServerAiConfigCache();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
  });

  it("reads the reference with the server default voice, unlocking audio inside the tap", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { mock } = setup({ ...CONFIG_ROUTES, "POST /api/ai/audio/speech": async () => { await gate; return new Response(new Uint8Array([1])); } });
    expect(screen.getByTestId("practice-listen")).toBeDisabled();
    await userEvent.type(screen.getByTestId("reference-input"), "Hello world");
    await waitFor(() => expect(screen.getByTestId("practice-listen")).toBeEnabled());
    await userEvent.click(screen.getByTestId("practice-listen"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(); // 静音解锁先于合成完成
    expect(screen.getByTestId("practice-listen")).toHaveAttribute("data-state", "loading");
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId("practice-listen")).toHaveAttribute("data-state", "playing"));
    const body = JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/ai/audio/speech")!.body as string);
    expect(body).toEqual({ input: "Hello world", model: "openai/tts-1", voice: "alloy" });
  });

  it("stops the reading when recording starts", async () => {
    setup({ ...CONFIG_ROUTES, "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    await userEvent.type(screen.getByTestId("reference-input"), "Hello world");
    await waitFor(() => expect(screen.getByTestId("practice-listen")).toBeEnabled());
    await userEvent.click(screen.getByTestId("practice-listen"));
    await waitFor(() => expect(screen.getByTestId("practice-listen")).toHaveAttribute("data-state", "playing"));
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    await userEvent.click(screen.getByTestId("record-toggle"));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(screen.getByTestId("practice-listen")).toHaveAttribute("data-state", "idle");
  });

  it("stops the reading when the reference text changes", async () => {
    setup({ ...CONFIG_ROUTES, "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    await userEvent.type(screen.getByTestId("reference-input"), "Hello");
    await waitFor(() => expect(screen.getByTestId("practice-listen")).toBeEnabled());
    await userEvent.click(screen.getByTestId("practice-listen"));
    await waitFor(() => expect(screen.getByTestId("practice-listen")).toHaveAttribute("data-state", "playing"));
    await userEvent.type(screen.getByTestId("reference-input"), "!");
    expect(screen.getByTestId("practice-listen")).toHaveAttribute("data-state", "idle");
  });

  it("stops the reading on unmount", async () => {
    const { unmount } = setup({ ...CONFIG_ROUTES, "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    await userEvent.type(screen.getByTestId("reference-input"), "Hello");
    await waitFor(() => expect(screen.getByTestId("practice-listen")).toBeEnabled());
    await userEvent.click(screen.getByTestId("practice-listen"));
    await waitFor(() => expect(screen.getByTestId("practice-listen")).toHaveAttribute("data-state", "playing"));
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    unmount();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  async function typeAndWait(text = "Hello") {
    await userEvent.type(screen.getByTestId("reference-input"), text);
    await waitFor(() => expect(screen.getByTestId("practice-listen")).toBeEnabled());
  }

  it("is disabled while the microphone is starting, so the reading is never captured", async () => {
    let grant!: () => void;
    const gate = new Promise<void>((r) => (grant = r));
    const base = createFakeRecorderEnv();
    const env = { ...base.env, getUserMedia: async (c: MediaStreamConstraints) => { await gate; return base.env.getUserMedia(c); } };
    const mock = createFetchMock({ ...CONFIG_ROUTES, "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    renderWithProviders(<PracticePage recorderEnv={env} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice" });
    await typeAndWait();
    await userEvent.click(screen.getByTestId("record-toggle"));
    expect(screen.getByTestId("practice-listen")).toBeDisabled();
    await userEvent.click(screen.getByTestId("practice-listen"));
    expect(mock.calls.some((c) => c.url.pathname === "/api/ai/audio/speech")).toBe(false);
    await act(async () => grant());
  });

  it("is disabled while recording and while uploading", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setup({ ...CONFIG_ROUTES, "POST /api/speech/assessments": async () => { await gate; return json({ assessment_id: "a1" }); } });
    await typeAndWait();
    await userEvent.click(screen.getByTestId("record-toggle"));
    expect(screen.getByTestId("practice-listen")).toBeDisabled();
    await userEvent.click(screen.getByTestId("record-toggle"));
    await waitFor(() => expect(screen.getByTestId("practice-status")).toHaveAttribute("data-state", "processing"));
    expect(screen.getByTestId("practice-listen")).toBeDisabled();
    await act(async () => release());
  });

  it("shows a translated toast when the speech request fails, and clears the error look on edit", async () => {
    setup({ ...CONFIG_ROUTES, "POST /api/ai/audio/speech": () => json({ error: "boom" }, 500) });
    vi.mocked(toast.error).mockClear();
    await typeAndWait("Uncached sentence"); // 共享缓存按文本命中,换一句避免命中前面的成功音频
    await userEvent.click(screen.getByTestId("practice-listen"));
    await waitFor(() => expect(screen.getByTestId("practice-listen")).toHaveAttribute("data-state", "error"));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).not.toMatch(/^web\./);
    await userEvent.type(screen.getByTestId("reference-input"), "!");
    expect(screen.getByTestId("practice-listen")).toHaveAttribute("data-state", "idle");
  });

  it("explains when the voice settings cannot load, and still records and assesses", async () => {
    setup({
      "GET /api/config/gpt_providers": () => json({ error: "x" }, 500),
      "GET /api/config/default_gpt_preset": () => json({ error: "x" }, 500),
      "GET /api/config/tts_providers_v2": () => json({ error: "x" }, 500),
      "GET /api/config/default_tts_preset": () => json({ error: "x" }, 500),
      "POST /api/speech/assessments": () => json({ assessment_id: "a9" }),
    });
    await userEvent.type(screen.getByTestId("reference-input"), "Hello");
    expect(await screen.findByTestId("practice-listen-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("practice-listen")).toBeDisabled();
    await userEvent.click(screen.getByTestId("record-toggle"));
    await userEvent.click(screen.getByTestId("record-toggle"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice/assessments/a9"));
  });
});

describe("practice home in the liquid skin (plan 2026-10-15-liquid-glass L4)", () => {
  afterEach(() => setLiquid(false));

  it("large title, studio hero first, one accent pill, recent scores, no own blur", async () => {
    setLiquid(true);
    setup({
      "GET /api/wordbook/config": () => json({ enabled: false }),
      "GET /api/assessments": () => json({ assessments: [], next: null }),
    });
    expect(await screen.findByRole("heading", { level: 1, name: /练习|Read aloud/ })).toHaveClass("text-large");
    const hero = screen.getByTestId("reference-input").closest(".mat-surface-strong")!;
    expect(hero).not.toBeNull();
    expect(hero.parentElement!.closest(".liquid\\:order-first")).not.toBeNull();
    expect(screen.getByTestId("record-toggle").className).toContain("liquid:shadow-accent");
    expect(screen.getByTestId("practice-listen").className).toContain("liquid:bg-wash");
    expect(blurLayers(document.body).length).toBeLessThanOrEqual(2);
  });
});
