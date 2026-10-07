/** VAD 判定(计划 R10):Silero 概率 + 帧能量双条件;机器人说话时用更严的预设防回声误触发。 */
export type VadSensitivity = "normal" | "bot-speaking";

export interface GatePreset {
  startProb: number;
  endProb: number;
  minSpeechMs: number;
  redemptionMs: number;
  minDbfs: number;
}

export const VAD_PRESETS: Record<VadSensitivity, GatePreset> = {
  normal: { startProb: 0.5, endProb: 0.35, minSpeechMs: 250, redemptionMs: 600, minDbfs: -38 },
  "bot-speaking": { startProb: 0.8, endProb: 0.35, minSpeechMs: 400, redemptionMs: 600, minDbfs: -30 },
};

export type GateEvent = { type: "speech-start" } | { type: "speech-end"; durationMs: number };

/**
 * 一帧算"说话"当且仅当 概率 ≥ 阈值 且 能量 ≥ minDbfs(R10 双条件,开始与结束都要满足)。
 * 概率有滞回:等待开始时阈值是 startProb,说话中降到 endProb;能量门限不变。
 * - 等待中:必须连续 ≥ minSpeechMs 的"说话"帧才开始;任何一帧不满足就从头计(弱回声里偶尔的响帧凑不够)。
 * - 说话中:不满足的帧(概率低或能量低,例如远处的人声)都算静音,累计 ≥ redemptionMs 结束。
 * speech-end 的 durationMs = 从开始到最后一个"说话"帧(含中间的短停顿,不含结尾静音)。
 */
export class SpeechGate {
  private state: "idle" | "speaking" = "idle";
  private candidateMs = 0;
  private speechMs = 0;
  private silenceMs = 0;

  constructor(
    private readonly frameMs: number,
    private preset: GatePreset,
  ) {}

  get speaking(): boolean {
    return this.state === "speaking";
  }

  setPreset(preset: GatePreset): void {
    this.preset = preset;
  }

  reset(): void {
    this.state = "idle";
    this.candidateMs = this.speechMs = this.silenceMs = 0;
  }

  push(prob: number, level: number): GateEvent[] {
    const p = this.preset;
    const speaking = this.state === "speaking";
    const isSpeech = prob >= (speaking ? p.endProb : p.startProb) && level >= p.minDbfs;
    if (!speaking) {
      this.candidateMs = isSpeech ? this.candidateMs + this.frameMs : 0;
      if (this.candidateMs < p.minSpeechMs) return [];
      this.state = "speaking";
      this.speechMs = this.candidateMs;
      this.candidateMs = this.silenceMs = 0;
      return [{ type: "speech-start" }];
    }
    if (isSpeech) {
      this.speechMs += this.silenceMs + this.frameMs;
      this.silenceMs = 0;
      return [];
    }
    this.silenceMs += this.frameMs;
    if (this.silenceMs < p.redemptionMs) return [];
    const durationMs = this.speechMs;
    this.reset();
    return [{ type: "speech-end", durationMs }];
  }
}
