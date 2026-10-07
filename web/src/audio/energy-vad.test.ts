import { describe, expect, it, vi } from "vitest";
import { ENERGY_FRAME_MS, ENERGY_PRESETS, createEnergyVad } from "./energy-vad";

const RATE = 16000;
const frameOf = (ms: number, amp: number) => new Float32Array((RATE * ms) / 1000).fill(amp);
const LOUD = 0.2; // ≈ -14 dBFS
const QUIET = 0.001; // ≈ -60 dBFS

function setup() {
  const onSpeechStart = vi.fn();
  const onSpeechEnd = vi.fn();
  const vad = createEnergyVad({ onSpeechStart, onSpeechEnd });
  return { vad, onSpeechStart, onSpeechEnd };
}

describe("createEnergyVad (basic detection when Silero cannot load)", () => {
  it("detects speech from frame energy alone, whatever size the capture frames are", () => {
    const s = setup();
    s.vad.start();
    // 37 ms 的不规则帧:内部按 20 ms 切片
    for (let i = 0; i < 12; i++) s.vad.push(frameOf(37, LOUD));
    expect(s.onSpeechStart).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 30; i++) s.vad.push(frameOf(37, QUIET));
    expect(s.onSpeechEnd).toHaveBeenCalledTimes(1);
    expect(s.onSpeechEnd.mock.calls[0][0]).toBeGreaterThanOrEqual(400);
  });

  it("ignores quiet background and short clicks", () => {
    const s = setup();
    s.vad.start();
    for (let i = 0; i < 100; i++) s.vad.push(frameOf(20, QUIET));
    s.vad.push(frameOf(100, LOUD)); // 100 ms 的响声 < minSpeechMs
    for (let i = 0; i < 50; i++) s.vad.push(frameOf(20, QUIET));
    expect(s.onSpeechStart).not.toHaveBeenCalled();
    expect(ENERGY_PRESETS.normal.minSpeechMs).toBeGreaterThan(100);
  });

  it("does nothing until started, nor while paused; pause resets a half-started detection", () => {
    const s = setup();
    for (let i = 0; i < 30; i++) s.vad.push(frameOf(20, LOUD));
    expect(s.onSpeechStart).not.toHaveBeenCalled();
    s.vad.start();
    for (let i = 0; i < 10; i++) s.vad.push(frameOf(20, LOUD)); // 200 ms:还没到门限
    s.vad.pause();
    for (let i = 0; i < 30; i++) s.vad.push(frameOf(20, LOUD));
    s.vad.start();
    for (let i = 0; i < 10; i++) s.vad.push(frameOf(20, LOUD));
    expect(s.onSpeechStart).not.toHaveBeenCalled(); // 暂停前的 200 ms 不累计
    for (let i = 0; i < 10; i++) s.vad.push(frameOf(20, LOUD));
    expect(s.onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("is stricter while the bot speaks, and reset()/destroy() stop it", async () => {
    const s = setup();
    s.vad.start();
    s.vad.setSensitivity("bot-speaking");
    const medium = 0.03; // ≈ -30.5 dBFS:正常时算说话,机器人说话时不算
    for (let i = 0; i < 60; i++) s.vad.push(frameOf(20, medium));
    expect(s.onSpeechStart).not.toHaveBeenCalled();
    s.vad.setSensitivity("normal");
    for (let i = 0; i < 20; i++) s.vad.push(frameOf(20, medium));
    expect(s.onSpeechStart).toHaveBeenCalledTimes(1);
    s.vad.reset();
    for (let i = 0; i < 60; i++) s.vad.push(frameOf(20, QUIET));
    expect(s.onSpeechEnd).not.toHaveBeenCalled();
    await s.vad.destroy();
    for (let i = 0; i < 30; i++) s.vad.push(frameOf(20, LOUD));
    expect(s.onSpeechStart).toHaveBeenCalledTimes(1);
    expect(ENERGY_FRAME_MS).toBe(20);
  });
});
