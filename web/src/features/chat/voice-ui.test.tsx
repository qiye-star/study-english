import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import good from "~/test/fixtures/assessment-good.json";
import { resetPlaybackRateForTests, setPlaybackRate } from "~/lib/playback-rate";
import { claimAudio } from "~/audio/audio-focus";
import { MessageBubble } from "./message-bubble";
import { ApiError } from "~/api/client";
import { GrammarBadge, PronunciationBadge } from "./result-badges";
import { TurnDetailSheet } from "./turn-detail-sheet";
import type { UiMessage } from "./ui-message";
import { VoicePlayButton, formatDuration } from "./voice-play-button";

const apiFor = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};
function Switcher() {
  const [id, setId] = useState("a1");
  return <><button data-testid="switch" onClick={() => setId("a2")}>s</button><VoicePlayButton assessmentId={id} /></>;
}
const SCORES = { pronunciationScore: 72.6, accuracyScore: 70, fluencyScore: 80, completenessScore: 90 };

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:fetched"), revokeObjectURL: vi.fn() });
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});

describe("voice UI", () => {
  it("formats durations", () => {
    expect(formatDuration(7_400)).toBe("0:07");
    expect(formatDuration(65_000)).toBe("1:05");
  });

  it("keeps its own error message when another player claims the audio", async () => {
    const { api } = apiFor({});
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => Promise.reject(new Error("blocked")));
    renderWithProviders(<VoicePlayButton audioUrl="blob:local" />, { api });
    await userEvent.click(screen.getByTestId("voice-play"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    act(() => claimAudio(vi.fn())); // another player starts
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("voice-play")).toHaveAttribute("data-state", "error");
  });

  it("plays a local clip directly", async () => {
    const { api, mock } = apiFor({});
    renderWithProviders(<VoicePlayButton audioUrl="blob:local" />, { api });
    await userEvent.click(screen.getByTestId("voice-play"));
    await waitFor(() => expect(screen.getByTestId("voice-play")).toHaveAttribute("data-state", "playing"));
    expect(mock.calls).toHaveLength(0);
  });

  it("fetches the authenticated recording once, unlocking audio inside the tap, and revokes it on unmount", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { api, mock } = apiFor({ "GET /api/assessments/a1/audio": async () => { await gate; return new Response(new Uint8Array([1])); } });
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    const view = renderWithProviders(<VoicePlayButton assessmentId="a1" />, { api });
    await userEvent.click(screen.getByTestId("voice-play"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1); // 同步阶段的静音解锁
    expect(screen.getByTestId("voice-play")).toHaveAttribute("data-state", "loading");
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId("voice-play")).toHaveAttribute("data-state", "playing"));
    await userEvent.click(screen.getByTestId("voice-play")); // 暂停
    await userEvent.click(screen.getByTestId("voice-play")); // 再播:不再请求
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].headers.get("authorization")).toBe("Bearer t");
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fetched");
  });

  it.each([
    [{ status: "pending" }, "Assessing…"],
    [{ status: "done", scores: SCORES }, "Pronunciation 73"],
    [{ status: "skipped", reason: "non-english" }, "Not assessed (not English)"],
    [{ status: "skipped", reason: "too-long" }, "Not assessed (too long)"],
    [{ status: "error" }, "Assessment failed"],
  ] as const)("badge %o", (view, label) => {
    renderWithProviders(<PronunciationBadge view={view as never} onOpen={vi.fn()} />);
    expect(screen.getByTestId("badge-pronunciation")).toHaveTextContent(label);
    expect(screen.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", view.status);
  });

  it.each([
    [new ApiError(413, "Recording storage quota exceeded"), "Your recording storage is full. Delete some old recordings."],
    [new ApiError(503, "Pronunciation assessment is not configured"), "Pronunciation assessment is not configured on the server."],
  ])("explains a failed assessment through the badge title (%o)", (error, reason) => {
    renderWithProviders(<PronunciationBadge view={{ status: "error", error }} onOpen={vi.fn()} />);
    const badge = screen.getByTestId("badge-pronunciation");
    expect(badge).toHaveAttribute("title", reason);
    expect(badge).toHaveAttribute("aria-label", `Assessment failed: ${reason}`);
  });

  it("falls back to the generic reason for unknown assessment errors and shows no title when there is none", () => {
    const { unmount } = renderWithProviders(<PronunciationBadge view={{ status: "error", error: new ApiError(500, "weird") }} onOpen={vi.fn()} />);
    expect(screen.getByTestId("badge-pronunciation").getAttribute("title")).toMatch(/\S/);
    expect(screen.getByTestId("badge-pronunciation").getAttribute("title")).not.toContain("weird");
    unmount();
    renderWithProviders(<PronunciationBadge view={{ status: "done", scores: SCORES }} onOpen={vi.fn()} />);
    expect(screen.getByTestId("badge-pronunciation")).not.toHaveAttribute("title");
  });

  it("disables the voice-bubble play button while playback is not allowed", async () => {
    const message: UiMessage = { key: "u1", role: "user", status: "done", content: "Hello", assessmentId: "a1", voice: { phase: "sent", durationMs: 3000, audioUrl: "blob:local" } };
    const first = renderWithProviders(<MessageBubble message={message} playbackDisabled />);
    expect(screen.getByTestId("voice-play")).toBeDisabled();
    await userEvent.click(screen.getByTestId("voice-play"));
    expect(screen.getByTestId("voice-play")).toHaveAttribute("data-state", "idle");
    first.unmount();
    renderWithProviders(<MessageBubble message={message} />);
    expect(screen.getByTestId("voice-play")).toBeEnabled();
  });

  it("renders a sent voice message with highlighted poor words and its footer", () => {
    const message: UiMessage = {
      key: "u1", role: "user", status: "done", content: "Hello, nice to meet you.", assessmentId: "a1",
      voice: { phase: "sent", durationMs: 3000, audioUrl: "blob:local" },
      assessment: { status: "done", scores: SCORES, words: [{ word: "meet", accuracyScore: 40, errorType: "Mispronunciation" }] },
    };
    renderWithProviders(<MessageBubble message={message} footer={<span data-testid="footer">F</span>} />);
    expect(screen.getByTestId("message-user")).toHaveAttribute("data-voice", "sent");
    expect(screen.getByTestId("voice-word-poor")).toHaveTextContent("meet");
    expect(screen.getByTestId("message-user")).toHaveTextContent("0:03");
    expect(screen.getByTestId("footer")).toBeInTheDocument();
    expect(screen.queryByTestId("message-retry")).toBeNull();
  });

  it("renders draft states with their actions", async () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    const failed: UiMessage = { key: "v1", role: "user", status: "error", content: "", voice: { phase: "failed", durationMs: 2000, note: "Network error." } };
    const view = renderWithProviders(<MessageBubble message={failed} voiceDraft={{ onRetry, onDiscard }} />);
    expect(screen.getByTestId("voice-error")).toHaveTextContent("Network error.");
    await userEvent.click(screen.getByTestId("voice-retry-transcribe"));
    await userEvent.click(screen.getByTestId("voice-discard"));
    expect(onRetry).toHaveBeenCalled();
    expect(onDiscard).toHaveBeenCalled();
    view.unmount();
    renderWithProviders(<MessageBubble message={{ ...failed, status: "error", voice: { phase: "kept", durationMs: 4000, note: "kept 4 s" } }} voiceDraft={{ onRetry, onDiscard }} />);
    await userEvent.click(screen.getByTestId("voice-send-kept"));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("detail sheet loads the full result and opens practice with the sentence", async () => {
    const { api } = apiFor({ "GET /api/assessments/a1": () => json({ id: "a1", reference_text: "Hello", language: "en-US", duration_ms: 1, scores: good, result: good, created_at: "t" }) });
    const onClose = vi.fn();
    const message: UiMessage = { key: "u1", role: "user", status: "done", content: "Hello, nice to meet you.", assessmentId: "a1" };
    renderWithProviders(<TurnDetailSheet message={message} onClose={onClose} />, { api });
    await waitFor(() => expect(screen.getByTestId("assessment-scores")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("detail-practice"));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent("/practice");
  });
  it("plays a voice bubble at the global speed and applies a change immediately", async () => {
    localStorage.clear();
    resetPlaybackRateForTests();
    setPlaybackRate(0.75);
    let element: HTMLMediaElement | null = null;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(function (this: HTMLMediaElement) {
      element = this;
      return Promise.resolve();
    });
    const { api } = apiFor({});
    renderWithProviders(<VoicePlayButton audioUrl="blob:local" />, { api });
    await userEvent.click(screen.getByTestId("voice-play"));
    await waitFor(() => expect(screen.getByTestId("voice-play")).toHaveAttribute("data-state", "playing"));
    expect(element!.playbackRate).toBe(0.75);
    expect((element as unknown as { preservesPitch?: boolean }).preservesPitch).toBe(true);
    act(() => setPlaybackRate(1.25));
    expect(element!.playbackRate).toBe(1.25);
    setPlaybackRate(1);
  });
});

describe("voice UI extras", () => {
  it("plays one clip at a time across buttons and with the app-wide audio focus", async () => {
    const { api } = apiFor({});
    renderWithProviders(<><VoicePlayButton audioUrl="blob:a" /><VoicePlayButton audioUrl="blob:b" /></>, { api });
    const [a, b] = screen.getAllByTestId("voice-play");
    await userEvent.click(a);
    expect(a).toHaveAttribute("data-state", "playing");
    await userEvent.click(b);
    expect(a).toHaveAttribute("data-state", "idle");
    expect(b).toHaveAttribute("data-state", "playing");
    act(() => claimAudio(vi.fn())); // e.g. TTS starts
    expect(b).toHaveAttribute("data-state", "idle");
  });

  it("shows a translated error and does not fetch before the tap", async () => {
    const { api, mock } = apiFor({ "GET /api/assessments/a1/audio": () => json({ error: "Network error" }, 500) });
    renderWithProviders(<VoicePlayButton assessmentId="a1" />, { api });
    expect(mock.calls).toHaveLength(0);
    await userEvent.click(screen.getByTestId("voice-play"));
    await waitFor(() => expect(screen.getByTestId("voice-play")).toHaveAttribute("data-state", "error"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("revokes the fetched url when the assessment changes", async () => {
    const { api } = apiFor({ "GET /api/assessments/a1/audio": () => new Response(new Uint8Array([1])), "GET /api/assessments/a2/audio": () => new Response(new Uint8Array([1])) });
    renderWithProviders(<Switcher />, { api });
    await userEvent.click(screen.getByTestId("voice-play"));
    await waitFor(() => expect(screen.getByTestId("voice-play")).toHaveAttribute("data-state", "playing"));
    vi.mocked(URL.revokeObjectURL).mockClear();
    await userEvent.click(screen.getByTestId("switch"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fetched");
  });

  it("detail sheet reserves the result height while loading and releases it once loaded", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { api } = apiFor({ "GET /api/assessments/a1": async () => { await gate; return json({ id: "a1", reference_text: "Hello", language: "en-US", duration_ms: 1, scores: good, result: good, created_at: "t" }); } });
    const message: UiMessage = { key: "u1", role: "user", status: "done", content: "Hello, nice to meet you.", assessmentId: "a1" };
    renderWithProviders(<TurnDetailSheet message={message} onClose={vi.fn()} />, { api });
    expect(screen.getByTestId("turn-detail-assessment")).toHaveClass("min-h-72");
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId("assessment-scores")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("turn-detail-assessment")).not.toHaveClass("min-h-72"));
  });

  it("detail sheet shows summary scores and weak words without a request, then saves", async () => {
    const { api, mock } = apiFor({
      "GET /api/assessments/a1": () => new Promise<Response>(() => undefined),
      "POST /api/practice-items": () => json({ id: "p1" }, 201),
    });
    const message: UiMessage = {
      key: "u1", role: "user", status: "done", content: "Hello, nice to meet you.", assessmentId: "a1",
      assessment: { status: "done", scores: SCORES, words: [{ word: "meet", accuracyScore: 40, errorType: "Mispronunciation" }] },
    };
    renderWithProviders(<TurnDetailSheet message={message} onClose={vi.fn()} />, { api });
    expect(screen.getByTestId("assessment-scores")).toBeInTheDocument();
    expect(screen.getByTestId("detail-weak-words")).toHaveTextContent("meet");
    await userEvent.click(screen.getByTestId("detail-save"));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "POST" && c.url.pathname === "/api/practice-items")).toBe(true));
  });

  it.each([
    [{ status: "pending" }, "Checking grammar…", undefined],
    [{ status: "done", result: { hasErrors: false, corrected: "x", errors: [] } }, "Grammar ✓", "0"],
    [{ status: "done", result: { hasErrors: true, corrected: "x", errors: [{ original: "a", corrected: "b", category: "tense", explanation: "" }] } }, "Grammar: 1 to fix", "1"],
    [{ status: "error" }, "Grammar check failed (tap to retry)", undefined],
  ] as const)("grammar badge %o", (view, label, errors) => {
    renderWithProviders(<GrammarBadge view={view as never} onOpen={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByTestId("badge-grammar")).toHaveTextContent(label);
    if (errors) expect(screen.getByTestId("badge-grammar")).toHaveAttribute("data-errors", errors);
  });

  it("hides the grammar badge for skipped checks", () => {
    renderWithProviders(<GrammarBadge view={{ status: "skipped" }} onOpen={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.queryByTestId("badge-grammar")).toBeNull();
  });
});

describe("mixed voices hint (plan 2026-10-07 R10)", () => {
  const words = ["the", "bus", "is", "late"].map((word) => ({ word }) as never);
  it("shows a note for a low score that heard different words", () => {
    renderWithProviders(<PronunciationBadge view={{ status: "done", scores: { ...SCORES, pronunciationScore: 30 }, words }} transcript="I want a coffee please" onOpen={vi.fn()} />);
    expect(screen.getByTestId("voice-mixed-hint")).toHaveAttribute("role", "note");
  });
  it("stays quiet for a good score", () => {
    renderWithProviders(<PronunciationBadge view={{ status: "done", scores: { ...SCORES, pronunciationScore: 80 }, words }} transcript="I want a coffee please" onOpen={vi.fn()} />);
    expect(screen.queryByTestId("voice-mixed-hint")).toBeNull();
  });
});
