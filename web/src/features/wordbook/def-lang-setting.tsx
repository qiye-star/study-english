import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "~/components/segmented-control";
import { DEF_LANGS } from "./def-lang";
import { readPhrasesPref, writePhrasesPref } from "./phrases-pref";
import { useDefLangSetting } from "./use-def-lang";
import type { DefLang } from "./wordbook-api";
import "./locales";

type PhrasesChoice = "open" | "closed";
const PHRASES_CHOICES: readonly PhrasesChoice[] = ["open", "closed"];

/**
 * 「释义显示:中英 / 仅中文 / 仅英文」(spec 2026-10-12-wordbook-definitions §5,R-DW3)与「短语:自动展开 / 收起」
 * (spec 2026-10-13-defs-default §2.2 ④,计划 R-A11):放在每日目标面板里。
 * 释义:三格等宽铺满,选了立刻生效并保存(乐观,失败退回并说明)。短语:设备级,读写 phrases-pref.ts(没存过 = 自动展开),
 * 不上服务端、不发请求;只管学新词页(卡片上手动开合写的是同一个值)。
 */
export function DefLangSetting() {
  const { t } = useTranslation();
  const { defLang, setDefLang, error } = useDefLangSetting();
  const [saved, setSaved] = useState(0);
  const [phrases, setPhrases] = useState<PhrasesChoice>(() => (readPhrasesPref() === false ? "closed" : "open"));
  const label = t("web.wordbookDefs.setting.label");
  const phrasesLabel = t("web.wordbookDefs.phrases.label");
  return (
    <div className="mt-5" data-testid="def-lang-setting">
      <p className="text-sub font-semibold text-ink-2">{label}</p>
      <SegmentedControl<DefLang> label={label} value={defLang} className="mt-1.5 flex w-full" optionClassName="min-w-0 flex-1 whitespace-nowrap px-2"
        onChange={(next) => void setDefLang(next).then((ok) => { if (ok) setSaved((n) => n + 1); })}
        options={DEF_LANGS.map((v) => ({ value: v, label: t(`web.wordbookDefs.setting.options.${v}`), testId: `def-lang-${v}` }))} />
      <p className="mt-1.5 text-meta leading-dialogue text-ink-2">{t("web.wordbookDefs.setting.help")}</p>
      <p className="mt-4 text-sub font-semibold text-ink-2">{phrasesLabel}</p>
      <SegmentedControl<PhrasesChoice> label={phrasesLabel} value={phrases} className="mt-1.5 flex w-full" optionClassName="min-w-0 flex-1 whitespace-nowrap px-2"
        onChange={(next) => { setPhrases(next); writePhrasesPref(next === "open"); setSaved((n) => n + 1); }}
        options={PHRASES_CHOICES.map((v) => ({ value: v, label: t(`web.wordbookDefs.phrases.options.${v}`), testId: `phrases-${v}` }))} />
      <p className="mt-1.5 text-meta leading-dialogue text-ink-2">{t("web.wordbookDefs.phrases.help")}</p>
      {error ? <p role="alert" className="mt-2 rounded-badge bg-surface-2 px-3 py-2.5 text-sub text-ink">{error}</p> : null}
      <span key={saved} aria-live="polite" className="sr-only">{saved > 0 ? t("web.wordbook.goals.saved") : ""}</span>
    </div>
  );
}
