import type { RoleKey } from "./dubbing-api";
import type { ClipSeg } from "./clip";

/**
 * 自己句子的录音窗口与静音时间表(计划 L5 R14)。纯 TS,无 React。
 * 窗口 = [句首 − before, 句尾 + after];前后紧邻的「对方」句子(含未标注)夹住窗口,不把对方原声录进来;
 * 相邻两句都是自己且窗口重叠时,在两句的间隙中点切开。窗口只看片段外的邻句,所以片段边界处也会被夹住。
 */

export interface LineWindow {
  /** 句子下标 */
  idx: number;
  /** 录音窗口(媒体毫秒) */
  startMs: number;
  endMs: number;
  /** 句子本身的时间,用于倒计时 */
  lineStartMs: number;
  lineEndMs: number;
}

export interface WindowOptions {
  /** 句首前的收音毫秒(计划:300) */
  before: number;
  /** 句尾后的收音毫秒(计划:600) */
  after: number;
}

/** 倒计时只在自己句子开始前的这段时间内显示(计划 R14)。 */
export const COUNTDOWN_MS = 3000;

export function lineWindows(segs: readonly ClipSeg[], from: number, to: number, role: RoleKey, opts: WindowOptions): LineWindow[] {
  const out: LineWindow[] = [];
  const other = (s: ClipSeg | undefined) => s !== undefined && s.speaker !== role;
  for (let i = from; i <= to; i++) {
    const s = segs[i];
    if (s.speaker !== role) continue;
    let startMs = Math.max(0, s.startMs - opts.before);
    let endMs = s.endMs + opts.after;
    if (i > 0 && other(segs[i - 1])) startMs = Math.max(startMs, segs[i - 1].endMs);
    if (i + 1 < segs.length && other(segs[i + 1])) endMs = Math.min(endMs, segs[i + 1].startMs);
    out.push({ idx: s.idx, startMs, endMs, lineStartMs: s.startMs, lineEndMs: s.endMs });
  }
  // 相邻两句都是自己且窗口重叠:在两句的间隙中点切开(无间隙则切在交界)。
  for (let k = 0; k + 1 < out.length; k++) {
    const a = out[k];
    const b = out[k + 1];
    if (b.idx !== a.idx + 1 || a.endMs <= b.startMs) continue;
    const mid = Math.floor((segs[a.idx].endMs + segs[b.idx].startMs) / 2);
    a.endMs = mid;
    b.startMs = mid;
  }
  return out;
}

/** 视频在自己的窗口内静音(计划 R14:窗口外恢复,同时避免回声)。 */
export function muteAt(windows: readonly LineWindow[], ms: number): boolean {
  return windows.some((w) => ms >= w.startMs && ms < w.endMs);
}

/** 自己句子开始前 3 秒内的倒计时 3 / 2 / 1;其余时间为 null。 */
export function countdownAt(windows: readonly LineWindow[], ms: number): 3 | 2 | 1 | null {
  for (const w of windows) {
    const delta = w.lineStartMs - ms;
    if (delta > 0 && delta <= COUNTDOWN_MS) return Math.ceil(delta / 1000) as 3 | 2 | 1;
  }
  return null;
}

/**
 * 当前处于哪一段:在自己的窗口内为 mine(idx 是该句);否则为 other,idx 是下一句自己的句子(之后没有则 -1)。
 */
export function phaseAt(windows: readonly LineWindow[], ms: number): { kind: "mine" | "other"; idx: number } {
  const active = windows.find((w) => ms >= w.startMs && ms < w.endMs);
  if (active) return { kind: "mine", idx: active.idx };
  const next = windows.find((w) => w.startMs > ms);
  return { kind: "other", idx: next ? next.idx : -1 };
}
