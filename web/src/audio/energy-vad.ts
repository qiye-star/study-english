import { TARGET_RATE, dbfs, frameRms } from "./pcm";
import { SpeechGate, type GatePreset, type VadSensitivity } from "./speech-gate";
import type { VadCallbacks, VadHandle } from "./vad";

/** 基础检测按 20 ms 切片判定(与 energy-gate.ts 的 FRAME_MS 一致)。 */
export const ENERGY_FRAME_MS = 20;
const SLICE = (TARGET_RATE * ENERGY_FRAME_MS) / 1000;

/**
 * 只有能量、没有 Silero 概率时的门限:比 VAD_PRESETS 更保守(更长的起说时长、更长的收尾),
 * 因为能量门分不清人声与持续的噪声。概率条件恒为满足(push 时传 1)。
 */
export const ENERGY_PRESETS: Record<VadSensitivity, GatePreset> = {
  normal: { startProb: 0, endProb: 0, minSpeechMs: 300, redemptionMs: 700, minDbfs: -36 },
  "bot-speaking": { startProb: 0, endProb: 0, minSpeechMs: 450, redemptionMs: 700, minDbfs: -28 },
};

export interface FrameVad extends VadHandle {
  /** 喂一帧 16 kHz 采集样本(任意长度)。 */
  push(frame: Float32Array): void;
}

/**
 * Silero 加载失败(iOS 上 wasm/worklet 不可用等)时的"基础检测":直接用通话采集的 16 kHz 帧,
 * 按能量判定开始/结束说话。不建任何音频节点,不会失败;由调用方在每一帧上调用 `push`。
 */
export function createEnergyVad(callbacks: VadCallbacks): FrameVad {
  const gate = new SpeechGate(ENERGY_FRAME_MS, ENERGY_PRESETS.normal);
  let running = false;
  let destroyed = false;
  let rest = new Float32Array(0);
  let slices = 0;

  const clear = () => {
    gate.reset();
    rest = new Float32Array(0);
  };

  return {
    push(frame) {
      if (!running || destroyed || !frame.length) return;
      let data = frame;
      if (rest.length) {
        data = new Float32Array(rest.length + frame.length);
        data.set(rest);
        data.set(frame, rest.length);
      }
      let i = 0;
      for (; i + SLICE <= data.length; i += SLICE) {
        slices++;
        for (const event of gate.push(1, dbfs(frameRms(data.subarray(i, i + SLICE))))) {
          if (!running || destroyed) return;
          if (event.type === "speech-start") callbacks.onSpeechStart();
          else callbacks.onSpeechEnd(event.durationMs);
        }
      }
      rest = data.slice(i);
    },
    start() {
      if (!destroyed) running = true;
    },
    pause() {
      running = false;
      clear();
    },
    reset: clear,
    framesProcessed: () => slices,
    setSensitivity: (s) => gate.setPreset(ENERGY_PRESETS[s]),
    async destroy() {
      destroyed = true;
      running = false;
      clear();
    },
  };
}
