import { describe, expect, it } from "vitest";
import { SpeechGate, VAD_PRESETS, type GateEvent } from "./speech-gate";

const F = 32; // ms/帧
function run(gate: SpeechGate, frames: Array<[number, number]>): GateEvent[] {
  return frames.flatMap(([p, db]) => gate.push(p, db));
}
const repeat = (n: number, frame: [number, number]) => Array.from({ length: n }, () => frame);

describe("VAD_PRESETS (plan R10 numbers)", () => {
  it("match the plan verbatim", () => {
    expect(VAD_PRESETS).toEqual({
      normal: { startProb: 0.5, endProb: 0.35, minSpeechMs: 250, redemptionMs: 600, minDbfs: -38 },
      "bot-speaking": { startProb: 0.8, endProb: 0.35, minSpeechMs: 400, redemptionMs: 600, minDbfs: -30 },
    });
  });
});

describe("SpeechGate (normal)", () => {
  it("starts after the minimum speech time and ends after the redemption time", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    const events = run(g, [...repeat(8, [0.9, -20]), ...repeat(19, [0.1, -60]), ...repeat(1, [0.1, -60])]);
    expect(events).toEqual([{ type: "speech-start" }, { type: "speech-end", durationMs: 8 * F }]);
  });

  it("ignores a burst shorter than the minimum", () => {
    expect(run(new SpeechGate(F, VAD_PRESETS.normal), [...repeat(7, [0.9, -20]), ...repeat(30, [0.1, -60])])).toEqual([]);
  });

  it("does not start on quiet speech below the energy floor (distant voices)", () => {
    expect(run(new SpeechGate(F, VAD_PRESETS.normal), repeat(40, [0.95, -45]))).toEqual([]);
  });

  it("a short pause inside speech does not end it", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    const events = run(g, [...repeat(10, [0.9, -20]), ...repeat(10, [0.1, -60]), ...repeat(10, [0.9, -20])]);
    expect(events).toEqual([{ type: "speech-start" }]);
    expect(g.speaking).toBe(true);
  });

  it("the minimum speech must be contiguous: a frame below the start probability restarts the count (R10)", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    // 4 + 4 帧合计 256 ms,但中间被 0.4(< startProb)打断:不算连续 250 ms
    expect(run(g, [...repeat(4, [0.9, -20]), ...repeat(3, [0.4, -20]), ...repeat(4, [0.9, -20])])).toEqual([]);
    expect(run(g, repeat(4, [0.9, -20]))).toEqual([{ type: "speech-start" }]); // 4 + 4 连续 = 256 ms
  });

  it("a frame below the energy floor restarts the count while waiting (R10)", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    expect(run(g, [...repeat(7, [0.9, -20]), [0.9, -45], ...repeat(7, [0.9, -20])])).toEqual([]);
    expect(run(g, repeat(1, [0.9, -20]))).toEqual([{ type: "speech-start" }]); // 8 帧连续
  });

  it("hysteresis once speaking: probabilities between the end and start thresholds keep speech going", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    expect(run(g, [...repeat(8, [0.9, -20]), ...repeat(40, [0.4, -20])])).toEqual([{ type: "speech-start" }]);
    expect(g.speaking).toBe(true);
  });

  it("quiet background voices after real speech end the utterance within redemptionMs + one frame (review W2 I2)", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    expect(run(g, repeat(10, [0.9, -20]))).toEqual([{ type: "speech-start" }]);
    const events: GateEvent[] = [];
    let frames = 0;
    while (!events.length && frames < 400) {
      events.push(...g.push(0.6, -50)); // 远处的人声/电视:概率够,能量不够
      frames++;
    }
    expect(events).toEqual([{ type: "speech-end", durationMs: 10 * F }]);
    expect(frames * F).toBeLessThanOrEqual(VAD_PRESETS.normal.redemptionMs + F);
    expect(g.speaking).toBe(false);
  });

  it("durationMs counts speech up to the last speech frame, including short pauses but not the trailing silence", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    const events = run(g, [...repeat(8, [0.9, -20]), ...repeat(5, [0.1, -60]), ...repeat(3, [0.9, -20]), ...repeat(19, [0.1, -60])]);
    expect(events).toEqual([{ type: "speech-start" }, { type: "speech-end", durationMs: 16 * F }]);
  });

  it("ends after exactly ceil(redemptionMs / frameMs) silent frames", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    run(g, repeat(8, [0.9, -20]));
    expect(run(g, repeat(18, [0.1, -60]))).toEqual([]); // 576 ms < 600 ms
    expect(run(g, repeat(1, [0.1, -60]))).toEqual([{ type: "speech-end", durationMs: 8 * F }]);
  });
});

describe("SpeechGate (bot speaking: echo protection)", () => {
  it("needs a higher probability, more energy and longer speech", () => {
    const g = new SpeechGate(F, VAD_PRESETS["bot-speaking"]);
    expect(run(g, repeat(20, [0.7, -20]))).toEqual([]); // 概率不够
    g.reset();
    expect(run(g, repeat(20, [0.9, -34]))).toEqual([]); // 能量不够(回声通常较弱)
    g.reset();
    expect(run(g, repeat(12, [0.9, -20]))).toEqual([]); // 384 ms < 400 ms
    expect(run(g, repeat(1, [0.9, -20]))).toEqual([{ type: "speech-start" }]);
  });

  it("weak echo with 10% loud frames never triggers in 60 s (review W2 I1)", () => {
    const g = new SpeechGate(F, VAD_PRESETS["bot-speaking"]);
    const frames = Math.ceil(60_000 / F);
    const events: GateEvent[] = [];
    for (let i = 0; i < frames; i++) events.push(...g.push(0.9, i % 10 === 9 ? -25 : -34));
    expect(events).toEqual([]);
  });

  it("starts after exactly ceil(400 / frameMs) contiguous loud, confident frames", () => {
    const g = new SpeechGate(F, VAD_PRESETS["bot-speaking"]);
    expect(run(g, [...repeat(12, [0.85, -25]), [0.79, -25], ...repeat(12, [0.85, -25])])).toEqual([]); // 0.79 < 0.8 打断
    expect(run(g, repeat(1, [0.85, -25]))).toEqual([{ type: "speech-start" }]);
  });

  it("switching presets mid-stream applies from the next frame", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    run(g, repeat(4, [0.9, -20]));
    g.setPreset(VAD_PRESETS["bot-speaking"]);
    expect(run(g, repeat(4, [0.9, -20]))).toEqual([]); // 8 帧 = 256 ms < 400 ms
  });
});
