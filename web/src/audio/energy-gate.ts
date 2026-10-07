import { dbfs, frameRms } from "./pcm";

/** 近讲能量门限(计划 R10)。只能降低旁人声音的影响,不能消除。 */
export const FRAME_MS = 20;
export const NEAR_FIELD_DBFS = -38;
export const PAD_MS = 200;
export const MIN_SPEECH_MS = 250;

export interface GateOptions {
  sampleRate: number;
  thresholdDbfs?: number;
  padMs?: number;
  minSpeechMs?: number;
}

export function frameLevels(samples: Float32Array, sampleRate: number): number[] {
  const size = Math.round((sampleRate * FRAME_MS) / 1000);
  const levels: number[] = [];
  for (let i = 0; i < samples.length; i += size) levels.push(dbfs(frameRms(samples.subarray(i, i + size))));
  return levels;
}

export function speechRuns(levels: number[], thresholdDbfs: number, minFrames: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= levels.length; i++) {
    const loud = i < levels.length && levels[i] >= thresholdDbfs;
    if (loud && start < 0) start = i;
    if (!loud && start >= 0) {
      if (i - start >= minFrames) runs.push([start, i]);
      start = -1;
    }
  }
  return runs;
}

function runsOf(samples: Float32Array, o: GateOptions) {
  const minFrames = Math.ceil((o.minSpeechMs ?? MIN_SPEECH_MS) / FRAME_MS);
  return speechRuns(frameLevels(samples, o.sampleRate), o.thresholdDbfs ?? NEAR_FIELD_DBFS, minFrames);
}

export function hasForegroundSpeech(samples: Float32Array, o: GateOptions): boolean {
  return runsOf(samples, o).length > 0;
}

export function trimSilence(samples: Float32Array, o: GateOptions): Float32Array {
  const runs = runsOf(samples, o);
  if (!runs.length) return new Float32Array(0);
  const frame = Math.round((o.sampleRate * FRAME_MS) / 1000);
  const pad = Math.round((o.sampleRate * (o.padMs ?? PAD_MS)) / 1000);
  const from = Math.max(0, runs[0][0] * frame - pad);
  const to = Math.min(samples.length, runs[runs.length - 1][1] * frame + pad);
  return samples.slice(from, to);
}
