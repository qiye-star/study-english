import { CheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "~/components/segmented-control";
import { useIsDark } from "~/layout/color-scheme";
import { cn } from "~/lib/cn";
import { SWATCHES, guardBackground, hslToRgb, type BgStyle } from "~/lib/glass-theme";
import { useGlassTheme } from "~/settings/glass-theme-store";
import { GlassSlider } from "./glass-slider";

const css = (h: number, s: number, l: number) => `rgb(${hslToRgb(h, s, l).join(", ")})`;

/**
 * 背景(设计稿 bgBlock)。只编辑当前生效的颜色模式(html.dark,即 useIsDark)那一套:浅色模式只有浅色色板,深色模式只有深色色板。
 * 没有自己的浅色/深色切换;颜色模式由上方的「颜色模式」控件决定。另一模式的背景存在 theme.bg 里原样保留。
 */
export function BackgroundPicker() {
  const { t, i18n } = useTranslation();
  const { theme, updateBg, update } = useGlassTheme();
  const mode = useIsDark() ? "dark" : "light";
  const pref = theme.bg[mode];
  const guard = guardBackground(pref, mode);
  const zh = i18n.language.startsWith("zh");
  const name = (i: number) => (zh ? SWATCHES[mode][i].zh : SWATCHES[mode][i].en);
  return (
    <div data-testid="appearance-background">
      <h2 className="text-sub font-semibold text-ink-2">{t("web.appearance.background")}</h2>
      <p data-testid="appearance-bg-hint" className="mb-3 mt-1 text-meta text-ink-2">{t(`web.appearance.bgHint.${mode}`)}</p>
      <div data-testid="appearance-background-swatches" className="grid grid-cols-4 gap-x-2 gap-y-2.5">
        {SWATCHES[mode].map((s, i) => (
          <button key={s.zh} type="button" aria-pressed={pref.swatch === i} aria-label={name(i)} onClick={() => updateBg(mode, { swatch: i })}
            className={cn("flex min-h-tap flex-col items-center gap-1 text-meta", pref.swatch === i ? "font-semibold text-ink" : "text-ink-2")}>
            <i aria-hidden style={{ background: css(s.h, s.s, s.l) }}
              className={cn("block size-11 rounded-full shadow-[inset_0_0_0_1px_var(--hair)]", pref.swatch === i && "ring-2 ring-blue ring-offset-2 ring-offset-surface")} />
            <span aria-hidden>{name(i)}</span>
          </button>
        ))}
      </div>
      <p className="mt-3.5 text-meta text-ink-2">{t("web.appearance.custom")}</p>
      <GlassSlider id={`bg-h-${mode}`} label={t("web.appearance.hue")} value={pref.h} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`}
        onChange={(h) => updateBg(mode, { h })} />
      <GlassSlider id={`bg-s-${mode}`} label={t("web.appearance.sat")} value={pref.s} min={0} max={30} step={1} format={(v) => `${Math.round(v)}%`}
        onChange={(s) => updateBg(mode, { s })} />
      <GlassSlider id={`bg-l-${mode}`} label={t("web.appearance.lightness")} value={pref.l} min={0} max={100} step={1} format={(v) => String(Math.round(v))}
        onChange={(l) => updateBg(mode, { l })} />
      {guard.clampedFrom !== null ? (
        <p data-testid="bg-clamp-hint" role="status" className="mt-1 text-meta text-amber">
          {t("web.appearance.clamped", { from: guard.clampedFrom, to: guard.l })}
        </p>
      ) : null}
      <p className="mb-2 mt-3 text-meta text-ink-2">{t("web.appearance.second")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={pref.second === null} aria-label={`${t("web.appearance.secondShort")}: ${t("web.appearance.secondNone")}`}
          onClick={() => updateBg(mode, { second: null })}
          className={cn("well flex size-11 items-center justify-center rounded-full text-ink-2", pref.second === null && "ring-2 ring-blue")}>
          {pref.second === null ? <CheckIcon aria-hidden className="size-4" /> : null}
        </button>
        {SWATCHES[mode].map((s, i) => (
          <button key={s.zh} type="button" aria-pressed={pref.second === i} aria-label={`${t("web.appearance.secondShort")}: ${name(i)}`}
            onClick={() => updateBg(mode, { second: i })}
            style={{ background: css(s.h, s.s, s.l) }}
            className={cn("size-[30px] rounded-full shadow-[inset_0_0_0_1px_var(--hair)]", pref.second === i && "ring-2 ring-blue ring-offset-2 ring-offset-surface")} />
        ))}
      </div>
      <p className="mb-2 mt-3.5 text-meta text-ink-2">{t("web.appearance.style")}</p>
      <SegmentedControl label={t("web.appearance.style")} value={theme.bgStyle} onChange={(bgStyle: BgStyle) => update({ bgStyle })}
        options={(["gradient", "grain", "solid"] as const).map((v) => ({ value: v, label: t(`web.appearance.bgStyle.${v}`) }))} />
    </div>
  );
}
