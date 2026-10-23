import "./locales";
import "./dubbing.css";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { RoleKey } from "./dubbing-api";

export type RoleColor = "red" | "blue" | "green" | "yellow" | "purple" | "orange";

/**
 * 全 feature 唯一的角色 → 颜色表(计划 2026-10-23 R-B1)。线上与存储仍是 A–F,界面上只显示「色点 + 颜色词 + 名字」。
 * 颜色令牌在 dubbing.css。
 */
export const ROLE_COLOR: Record<RoleKey, RoleColor> = {
  A: "red", B: "blue", C: "green", D: "yellow", E: "purple", F: "orange",
};

/** 用户保存的名字(去空白后非空)优先,否则是默认名 Alex…Fiona。 */
export function roleName(t: TFunction, role: RoleKey, custom?: string | null): string {
  const trimmed = custom?.trim();
  return trimmed ? trimmed : t(`web.dubbing.roles.default.${role}`);
}

/** 「红·Alex」;颜色词让读屏与色弱用户不靠颜色也能分辨。 */
export function roleLabel(t: TFunction, role: RoleKey, custom?: string | null): string {
  return t("web.dubbing.roles.label", { color: t(`web.dubbing.roles.color.${ROLE_COLOR[role]}`), name: roleName(t, role, custom) });
}

/** 只有圆点,装饰用(名字永远写在旁边)。 */
export function RoleDot({ role }: { role: RoleKey }) {
  return <span aria-hidden="true" data-role-color={ROLE_COLOR[role]} className="dub-dot" />;
}

/** 圆点 + 「红·Alex」。 */
export function RoleTag({ role, custom }: { role: RoleKey; custom?: string | null }) {
  const { t } = useTranslation();
  return (
    <span data-role-color={ROLE_COLOR[role]} className="dub-tag">
      <RoleDot role={role} />
      <span className="dub-tag-name">{roleLabel(t, role, custom)}</span>
    </span>
  );
}
