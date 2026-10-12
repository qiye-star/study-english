import { expect, it } from "vitest";
import type { VoiceInfo } from "../protocol";
import { ME, msg } from "./fixtures";
import { maxSeq, turnVoice } from "./tutor-voice";

const voice = (status: VoiceInfo["status"]): VoiceInfo => ({ durationMs: 2000, status, transcript: status === "done" ? "I went there" : null, lang: null,
  translation: null, translationStatus: null, attempts: 1, audio: true });
const mine = (seq: number, status: VoiceInfo["status"]) => msg({ seq, kind: "voice", text: "", sender: { kind: "user", id: ME, name: "alice" }, voice: voice(status) });

it("only my voice messages after the turn started count; the latest decides (spec addressing §3.2 #3)", () => {
  expect(turnVoice([mine(3, "pending")], ME, 5, null)).toBe("none");
  expect(turnVoice([mine(6, "pending")], ME, 5, null)).toBe("recognizing");
  expect(turnVoice([mine(6, "empty")], ME, 5, null)).toBe("unclear");
  expect(turnVoice([mine(6, "failed")], ME, 5, null)).toBe("unclear");
  expect(turnVoice([mine(6, "empty"), mine(7, "pending")], ME, 5, null)).toBe("recognizing");
  expect(turnVoice([mine(6, "done")], ME, 5, null)).toBe("none");
  const other = msg({ seq: 8, kind: "voice", text: "", sender: { kind: "user", id: 22, name: "bob" }, voice: voice("pending") });
  expect(turnVoice([other], ME, 5, null)).toBe("none");
  expect(turnVoice([{ ...mine(9, "pending"), hidden: true }], ME, 5, null)).toBe("none");
});

it("the server's voice_unclear notice also means unclear, unless a newer attempt is being recognized", () => {
  expect(turnVoice([], ME, 5, "voice_unclear")).toBe("unclear");
  expect(turnVoice([mine(6, "pending")], ME, 5, "voice_unclear")).toBe("recognizing");
  expect(turnVoice([], ME, 5, "ai_busy")).toBe("none");
});

it("maxSeq is 0 for an empty list", () => {
  expect(maxSeq([])).toBe(0);
  expect(maxSeq([mine(4, "done"), mine(9, "done")])).toBe(9);
});
