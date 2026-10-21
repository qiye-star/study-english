import type { DubbingLimits, RoleKey } from "./dubbing-api";

/**
 * 片段规则(计划 L5 R6,与服务端 `server/app/dubbing/clip.py` 同码)。纯 TS,无 React。
 * 约定:`segs[i].idx === i`(库的句子下标连续)。限值来自 config.limits,不写死。
 */

export interface ClipSeg {
  idx: number;
  startMs: number;
  endMs: number;
  /** 句子的角色;null = 未标注,配音里一律当「对方」 */
  speaker: RoleKey | null;
}

/** 选择状态:第一次点是起点(to 为 null),第二次点是终点;反向自动交换。 */
export interface ClipSelection {
  from: number;
  to: number | null;
}

/** 点一句的选择逻辑:第一次点起点,第二次点终点,第三次点重新开始。 */
export function selectRange(prev: ClipSelection | null, tap: number): ClipSelection {
  if (!prev || prev.to !== null) return { from: tap, to: null };
  return { from: Math.min(prev.from, tap), to: Math.max(prev.from, tap) };
}

export interface ClipStats {
  /** 范围在 [0, segs.length) 内且 from ≤ to */
  valid: boolean;
  lines: number;
  ms: number;
  /** 片段里属于所选角色的句数 */
  mine: number;
}

export function clipStats(segs: readonly ClipSeg[], from: number, to: number, role: RoleKey): ClipStats {
  const valid = Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from <= to && to < segs.length;
  if (!valid) return { valid: false, lines: 0, ms: 0, mine: 0 };
  let mine = 0;
  for (let i = from; i <= to; i++) if (segs[i].speaker === role) mine++;
  return { valid: true, lines: to - from + 1, ms: segs[to].endMs - segs[from].startMs, mine };
}

export type ClipProblem = "clip" | "clip_too_long" | "role_missing";

/** 返回与服务端同码的问题;没有问题返回 null。顺序与服务端一致:范围 → 过长 → 角色缺失。 */
export function clipProblem(stats: ClipStats, limits: Pick<DubbingLimits, "maxLines" | "maxMs">): ClipProblem | null {
  if (!stats.valid) return "clip";
  if (stats.lines > limits.maxLines || stats.ms > limits.maxMs) return "clip_too_long";
  if (stats.mine === 0) return "role_missing";
  return null;
}
