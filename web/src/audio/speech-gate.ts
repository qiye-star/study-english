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

export class SpeechGate {
  private state: "idle" | "candidate" | "speaking" = "idle";
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
    const qualifies = prob >= p.startProb && level >= p.minDbfs;
    if (this.state === "idle") {
      if (qualifies) {
        this.state = "candidate";
        this.candidateMs = this.frameMs;
      }
    } else if (this.state === "candidate") {
      if (qualifies) this.candidateMs += this.frameMs;
      else if (prob < p.endProb) this.reset();
    } else if (prob < p.endProb) {
      this.silenceMs += this.frameMs;
      if (this.silenceMs >= p.redemptionMs) {
        const durationMs = this.speechMs;
        this.reset();
        return [{ type: "speech-end", durationMs }];
      }
      return [];
    } else {
      this.speechMs += this.silenceMs + this.frameMs;
      this.silenceMs = 0;
      return [];
    }
    if (this.state === "candidate" && this.candidateMs >= p.minSpeechMs) {
      this.state = "speaking";
      this.speechMs = this.candidateMs;
      this.silenceMs = 0;
      return [{ type: "speech-start" }];
    }
    return [];
  }
}
