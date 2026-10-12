import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "~/components/segmented-control";
import { DEF_LANGS } from "./def-lang";
import { useDefLangSetting } from "./use-def-lang";
import type { DefLang } from "./wordbook-api";
import "./locales";

/**
 * 「释义显示:中英 / 仅中文 / 仅英文」(spec 2026-10-12-wordbook-definitions §5,R-DW3):放在每日目标面板里。
 * 三格等宽铺满(min-w-0 flex-1 + whitespace-nowrap,英文标签 ≤ 12 字符),选了立刻生效并保存(乐观,失败退回并说明)。
 */
export function DefLangSetting() {
  const { t } = useTranslation();
  const { defLang, setDefLang, error } = useDefLangSetting();
  const [saved, setSaved] = useState(0);
  const label = t("web.wordbookDefs.setting.label");
  return (
    <div className="mt-5" data-testid="def-lang-setting">
      <p className="text-sub font-semibold text-ink-2">{label}</p>
      <SegmentedControl<DefLang> label={label} value={defLang} className="mt-1.5 flex w-full" optionClassName="min-w-0 flex-1 whitespace-nowrap px-2"
        onChange={(next) => void setDefLang(next).then((ok) => { if (ok) setSaved((n) => n + 1); })}
        options={DEF_LANGS.map((v) => ({ value: v, label: t(`web.wordbookDefs.setting.options.${v}`), testId: `def-lang-${v}` }))} />
      <p className="mt-1.5 text-meta leading-dialogue text-ink-2">{t("web.wordbookDefs.setting.help")}</p>
      {error ? <p role="alert" className="mt-2 rounded-badge bg-surface-2 px-3 py-2.5 text-sub text-ink">{error}</p> : null}
      <span key={saved} aria-live="polite" className="sr-only">{saved > 0 ? t("web.wordbook.goals.saved") : ""}</span>
    </div>
  );
}
