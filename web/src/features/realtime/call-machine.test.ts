import { describe, expect, it } from "vitest";
import { INITIAL_CALL, MAX_CAPTIONS, callReducer, type CallAction, type CallModel } from "./call-machine";
import type { ServerEvent } from "./protocol";

const run = (actions: CallAction[], from: CallModel = INITIAL_CALL) => actions.reduce(callReducer, from);
const ev = (event: ServerEvent): CallAction => ({ type: "event", event });

describe("callReducer", () => {
  it("follows the server's phases", () => {
    const m = run([{ type: "connect" }, ev({ type: "ready", asr: "buffered" }), ev({ type: "state", state: "thinking" })]);
    expect(m.phase).toBe("thinking");
  });

  it("builds captions from transcripts and streamed replies", () => {
    const m = run([
      ev({ type: "transcript_partial", text: "hel" }),
      ev({ type: "transcript_final", text: "hello", messageId: "m1" }),
      ev({ type: "reply_delta", turnId: 1, text: "Hi " }),
      ev({ type: "reply_delta", turnId: 1, text: "there." }),
      ev({ type: "reply_done", turnId: 1, messageId: "m2", interrupted: false }),
      ev({ type: "assessment", messageId: "m1", status: "done", result: { pronunciationScore: 81.6 } }),
    ]);
    expect(m.partial).toBe("");
    expect(m.captions).toEqual([
      { key: "u-m1", role: "user", text: "hello", messageId: "m1", score: 82 },
      { key: "a-1", role: "assistant", text: "Hi there.", turnId: 1, messageId: "m2", interrupted: false },
    ]);
  });

  it("shows the partial transcript until the final one arrives", () => {
    expect(run([ev({ type: "transcript_partial", text: "hel" })]).partial).toBe("hel");
  });

  it("failed or quota assessments leave no score", () => {
    const m = run([
      ev({ type: "transcript_final", text: "hello", messageId: "m1" }),
      ev({ type: "assessment", messageId: "m1", status: "quota" }),
    ]);
    expect(m.captions[0].score).toBeNull();
  });

  it("marks interruptions locally and from the server", () => {
    const local = run([ev({ type: "reply_delta", turnId: 1, text: "One." }), ev({ type: "state", state: "speaking" }), { type: "local-interrupt" }]);
    expect(local.captions[0].interrupted).toBe(true);
    expect(local.phase).toBe("listening");
    const server = run([ev({ type: "reply_delta", turnId: 2, text: "Two." }), ev({ type: "reply_done", turnId: 2, messageId: "m3", interrupted: true })]);
    expect(server.captions[0]).toMatchObject({ interrupted: true, messageId: "m3" });
  });

  it("a barge-in while thinking never marks the previous, finished reply as interrupted", () => {
    const m = run([
      ev({ type: "reply_delta", turnId: 1, text: "Sure." }),
      ev({ type: "reply_done", turnId: 1, messageId: "m2", interrupted: false }),
      ev({ type: "transcript_final", text: "and also", messageId: "m3" }),
      ev({ type: "state", state: "thinking" }),
      { type: "local-interrupt" },
      // 服务端随后可能补发上一轮的 reply_done(interrupted 仍是 false)
      ev({ type: "reply_done", turnId: 1, messageId: "m2", interrupted: false }),
    ]);
    expect(m.captions.find((c) => c.turnId === 1)!.interrupted).toBe(false);
    expect(m.phase).toBe("listening");
  });

  it("a local interrupt marks only the reply that is still streaming", () => {
    const m = run([
      ev({ type: "reply_delta", turnId: 1, text: "One." }),
      ev({ type: "reply_done", turnId: 1, messageId: null, interrupted: false }),
      ev({ type: "reply_delta", turnId: 2, text: "Two" }),
      { type: "local-interrupt" },
    ]);
    expect(m.captions.map((c) => !!c.interrupted)).toEqual([false, true]);
  });

  it("empty transcripts and errors become notices; degraded is sticky", () => {
    let m = run([ev({ type: "transcript_final", text: "", messageId: null })]);
    expect(m.notice).toBe("web.realtime.noSpeech");
    expect(m.captions).toHaveLength(0);
    m = run([ev({ type: "error", code: "tts_failed" }), ev({ type: "degraded", reason: "asr" })]);
    expect(m.notice).toBe("web.realtime.errors.tts_failed");
    expect(m.degraded).toBe(true);
  });

  it("user captions without a message id still get unique keys", () => {
    const m = run([
      ev({ type: "transcript_final", text: "a", messageId: null }),
      ev({ type: "transcript_final", text: "b", messageId: null }),
    ]);
    expect(new Set(m.captions.map((c) => c.key)).size).toBe(2);
  });

  it("ends with a translated close reason and ignores events afterwards", () => {
    const m = run([{ type: "closed", code: 4008 }, ev({ type: "state", state: "speaking" })]);
    expect(m.phase).toBe("ended");
    expect(m.error).toBe("web.realtime.errors.idle_timeout");
    expect(run([{ type: "closed", code: 1000 }]).error).toBeNull();
    expect(run([{ type: "fail", errorKey: "web.realtime.errors.micLost" }]).error).toBe("web.realtime.errors.micLost");
    expect(run([{ type: "fail", errorKey: "x" }, { type: "closed", code: 4008 }]).error).toBe("x");
  });

  it("toggles mute and the input mode; a mode change always ends a hold", () => {
    expect(INITIAL_CALL).toMatchObject({ inputMode: "auto", holding: false });
    let m = run([{ type: "mute", muted: true }, { type: "input-mode", mode: "ptt" }, { type: "notice", key: "k" }]);
    expect(m).toMatchObject({ muted: true, inputMode: "ptt", notice: "k" });
    m = run([{ type: "holding", on: true }], m);
    expect(m.holding).toBe(true);
    m = run([{ type: "input-mode", mode: "auto" }], m);
    expect(m).toMatchObject({ inputMode: "auto", holding: false });
    expect(Object.keys(m)).not.toContain("pushToTalk");
  });

  it("speaker (hands-free) is part of the model", () => {
    expect(run([{ type: "speaker", on: true }]).speaker).toBe(true);
    expect(run([{ type: "speaker", on: true }, { type: "speaker", on: false }]).speaker).toBe(false);
  });

  it("a missing Silero model switches to basic detection: hands-free stays on and the mode is not locked", () => {
    const m = run([{ type: "vad-unavailable" }]);
    expect(m).toMatchObject({ inputMode: "auto", vadUnavailable: true, notice: "web.realtime.vadUnavailable" });
    expect(run([{ type: "input-mode", mode: "ptt" }, { type: "input-mode", mode: "auto" }], m).inputMode).toBe("auto");
    expect(INITIAL_CALL.vadUnavailable).toBe(false);
  });

  it("keeps at most 50 captions", () => {
    const actions = Array.from({ length: 60 }, (_, i) => ev({ type: "transcript_final", text: `t${i}`, messageId: `m${i}` }));
    const m = run(actions);
    expect(m.captions).toHaveLength(MAX_CAPTIONS);
    expect(m.captions[0].text).toBe("t10");
  });
});
