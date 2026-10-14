import type { TFunction } from "i18next";
import type { RoomsConfig } from "../rooms-api";
import { levelLabel } from "~/lib/levels";
import { scenarioTitle } from "./scenario-picker";

type Change = { field?: unknown; value?: unknown };
const BOOLEAN_FIELDS = new Set(["ai_public", "allow_voice", "locked"]);
const VALUE_FIELDS = new Set(["name", "scenario", "level", "max_members"]);

/**
 * 系统消息 `kind="system", text="settings", meta={changes:[{field,value}]}`(spec §3.2,一次 PATCH 一条)逐项渲染:
 * 「房主把房间名改为「美食角」,把人数上限改为 5」。字段名是服务端 snake_case;meta 经 camelcase-keys 后 field 的值不变。
 * 未知字段跳过;一项都认不出时返回 null(调用方退回通用文案 web.rooms.room.system.settings)。
 * 车道 WC 提供,消息列表(车道 WE)渲染 settings 系统消息时调用。
 */
export function describeSettingsChanges(t: TFunction, meta: unknown, scenarios?: RoomsConfig["scenarios"], language = "zh-CN"): string | null {
  const changes = (meta as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes)) return null;
  const parts: string[] = [];
  for (const c of changes as Change[]) {
    const field = typeof c?.field === "string" ? c.field : "";
    if (field === "join_mode" && (c.value === "code" || c.value === "approval")) {
      parts.push(t(`web.rooms.v2.system.join_mode_${c.value}`));
    } else if (BOOLEAN_FIELDS.has(field) && typeof c.value === "boolean") {
      parts.push(t(`web.rooms.v2.system.${field}_${c.value ? "on" : "off"}`));
    } else if (VALUE_FIELDS.has(field) && (typeof c.value === "string" || typeof c.value === "number")) {
      const value = field === "scenario" ? scenarioTitle(scenarios, String(c.value), language) : field === "level" ? levelLabel(t, String(c.value)) : String(c.value);
      parts.push(t(`web.rooms.v2.system.${field}`, { value }));
    }
  }
  if (!parts.length) return null;
  return t("web.rooms.v2.system.summary", { changes: parts.join(t("web.rooms.v2.system.separator")) });
}
