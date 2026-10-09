/** 草稿与差异的纯函数(界面只做预判;最终以服务端的危险/配对判定为准)。 */
import { ApiError } from "../../api/client";
import type { DiffValue } from "../../components/diff-table";
import type { Scalar, SettingItem } from "./api";
import { S } from "./strings";

/** key → 新值;null = 恢复为 env(删除覆盖)。不在草稿里 = 未修改。 */
export type Draft = Record<string, Scalar>;

export function hostOf(url: unknown): string {
  try {
    return typeof url === "string" && url ? new URL(url).hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

/** 草稿里该项的"保存后"值(非密钥)。 */
export function afterValue(item: SettingItem, value: Scalar): Scalar {
  return value === null ? (item.envValue ?? null) : value;
}

const THRESHOLD_UP: Record<string, number> = { ai_rate_limit_per_minute: 600, realtime_max_sessions: 20 };

/** 与服务端 danger_reasons 同一套规则的界面预判;返回危险说明或 null。 */
export function dangerOf(item: SettingItem, value: Scalar): string | null {
  if (item.secret) return null;
  const before = item.effective ?? null;
  const after = afterValue(item, value);
  if (before === after) return null;
  if (item.key in THRESHOLD_UP) {
    return typeof after === "number" && after > THRESHOLD_UP[item.key] ? item.danger ?? "调高会增加上游费用" : null;
  }
  if (!item.danger) return null;
  if (item.kind === "url") return hostOf(before) !== hostOf(after) ? item.danger : null;
  const rules: Record<string, boolean> = {
    registration_mode: after === "open",
    log_level: after === "DEBUG",
    maintenance_mode: after !== "off",
    room_message_retention_days: typeof after === "number" && after > 0,
    realtime_enabled: after === true,
    admin_require_totp: after === true,
    rank_matches_global_daily: typeof after === "number" && typeof before === "number" && after > before,
    rooms_ai_global_daily: typeof after === "number" && typeof before === "number" && after > before,
  };
  return rules[item.key] ?? true ? item.danger : null;
}

export function confirmPhrase(keys: string[]): string {
  return keys.length === 1 ? keys[0].toUpperCase() : "CONFIRM";
}

/** 差异表的"当前 / 保存后"单元格。 */
export function diffValues(item: SettingItem, value: Scalar): { before: DiffValue; after: DiffValue } {
  if (item.secret) {
    const now = item.effectiveState ?? { set: false, fp: "" };
    const before = { set: now.set, fp: now.fp };
    if (value === null) {
      const env = item.envState ?? { set: false, fp: "" };
      return { before, after: { set: env.set, fp: env.fp } };
    }
    return { before, after: { set: true, fp: S.newSecret } };
  }
  return { before: (item.effective ?? null) as DiffValue, after: afterValue(item, value) as DiffValue };
}

/** 数字输入:合法数字转 number,其余原样交给服务端校验(422 带字段)。 */
export function parseInput(item: SettingItem, text: string): Scalar {
  if (item.kind === "int" || item.kind === "float") {
    const n = Number(text);
    return text.trim() !== "" && Number.isFinite(n) ? n : text;
  }
  return text;
}

export function formatValue(value: Scalar | undefined): string {
  if (value === null || value === undefined || value === "") return S.empty;
  if (typeof value === "boolean") return value ? S.on : S.off;
  return String(value);
}

/** 409 "Managed by rank rules"(段位规则发布后 6 个 rank_* 设置只读)→ 指向段位规则页的中文提示;否则 null。 */
export function managedErrorText(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 409 || e.message !== "Managed by rank rules") return null;
  const keys = Object.keys(e.fields ?? {}).map((k) => k.toUpperCase());
  return S.managedError(keys.length ? keys.join("、") : "RANK_*");
}
