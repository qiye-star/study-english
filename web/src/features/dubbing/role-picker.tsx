import "./locales";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ROLE_KEYS, type RoleKey } from "./dubbing-api";

/** 角色名最多 24 个字符(计划 L5 W8)。 */
export const ROLE_NAME_MAX = 24;

/**
 * 选角色(计划 L5 W8):每个角色一张卡,显示片段内句数;片段里没有台词的角色不可选;
 * 名字可以改(精选副本只读)。
 */
export function RolePicker({
  names, counts, selected, editable, onSelect, onRename,
}: {
  names: Partial<Record<RoleKey, string>>;
  counts: Record<RoleKey, number>;
  selected: RoleKey | null;
  editable: boolean;
  onSelect(role: RoleKey): void;
  onRename(role: RoleKey, name: string | null): void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<RoleKey | null>(null);
  const [draft, setDraft] = useState("");

  const save = (role: RoleKey) => {
    const trimmed = draft.trim().slice(0, ROLE_NAME_MAX);
    onRename(role, trimmed === "" ? null : trimmed);
    setEditing(null);
  };

  return (
    <ul className="space-y-2">
      {ROLE_KEYS.map((role) => {
        const count = counts[role] ?? 0;
        const label = names[role] ?? t("web.dubbing.roles.role", { key: role });
        return (
          <li key={role} className="flex items-center gap-2">
            <button
              type="button"
              disabled={count === 0}
              aria-pressed={selected === role}
              onClick={() => onSelect(role)}
              className={`flex flex-1 items-center justify-between rounded-2xl px-4 py-3 text-left ${selected === role ? "bg-white/25" : "bg-white/10"} disabled:opacity-40`}
            >
              <span className="text-[15px] font-medium">{label}</span>
              <span className="text-[12px] opacity-80">{t("web.dubbing.roles.count", { count })}</span>
            </button>
            {editable ? (
              <button
                type="button"
                aria-label={t("web.dubbing.roles.rename", { key: role })}
                onClick={() => {
                  setEditing(role);
                  setDraft(names[role] ?? "");
                }}
                className="rounded-xl px-2 py-2 text-[12px] opacity-80"
              >
                {t("web.dubbing.roles.editShort")}
              </button>
            ) : null}
            {editable && editing === role ? (
              <div className="flex items-center gap-1">
                <input
                  aria-label={t("web.dubbing.roles.nameFor", { key: role })}
                  maxLength={ROLE_NAME_MAX}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-32 rounded-lg bg-white/15 px-2 py-1 text-[13px]"
                />
                <button type="button" onClick={() => save(role)} className="rounded-lg bg-white/25 px-2 py-1 text-[12px]">
                  {t("web.dubbing.roles.save")}
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
