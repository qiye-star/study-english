import { InfoIcon, RotateCcwIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { LQ_SECONDARY } from "~/components/liquid";
import { SegmentedControl } from "~/components/segmented-control";
import { SurfaceCard } from "~/components/surface-card";
import { useIsDark } from "~/layout/color-scheme";
import { isLowMemory } from "~/layout/glass-quality";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import { isGlassOn } from "~/lib/glass-flag";
import { RADIUS_PRESETS, computeGlassVars, sliderToTint, tintToSlider, type GlassPreset } from "~/lib/glass-theme";
import { COLOR_SCHEMES, type ColorScheme } from "~/settings/color-scheme-pref";
import { useGlassTheme } from "~/settings/glass-theme-store";
import { useSettings } from "~/settings/settings-context";
import { BackgroundPicker } from "./background-picker";
import { GlassSlider } from "./glass-slider";
import { PreviewCard } from "./preview-card";

/** 预设缩略图(设计稿 .preset .pw):条纹上的一块「玻璃」,用不透明度示意,不模糊(blur 预算与源码守卫) */
const PRESET_SWATCH: Record<Exclude<GlassPreset, "custom">, string> = {
  clear: "bg-white/20",
  frosted: "bg-white/60",
  solid: "bg-surface",
};
const reducedTransparency = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches;

/** 我的 → 外观与主题(spec §6.4,设计稿 themeScreen;计划 2026-10-15-liquid-glass L3)。只在液态皮肤下可达。 */
export function AppearancePage() {
  const { t } = useTranslation();
  const dark = useIsDark();
  const { colorScheme, setColorScheme } = useSettings();
  const { theme, update, applyPreset, reset } = useGlassTheme();
  const lowMemory = isLowMemory();
  const lite = lowMemory || theme.reduced;
  const computed = useMemo(() => computeGlassVars(theme, { dark, lite }), [theme, dark, lite]);
  const rt = reducedTransparency();
  // App-wide switch, not the per-route pin: entering from a pinned route still has data-glass="pin" for one commit.
  if (!isGlassOn()) return <Navigate to="/me" replace />;
  const radiusPreset = (Object.keys(RADIUS_PRESETS) as (keyof typeof RADIUS_PRESETS)[]).find((k) => RADIUS_PRESETS[k] === theme.radius) ?? "";
  const section = "mt-4 p-4";
  const title = "mb-3 flex items-center justify-between text-sub font-semibold text-ink-2";
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.appearance.title")} back="/me" />
      <div className="px-frame pb-[calc(var(--tab-bar-space)+2rem)]">
        <SurfaceCard strong className="mt-2 p-4">
          <PreviewCard />
          <p className="mt-2.5 text-meta text-ink-2">{t("web.appearance.previewNote")}</p>
        </SurfaceCard>

        <SurfaceCard className={section}>
          <h2 className={title}>{t("web.appearance.colorMode")}</h2>
          <SegmentedControl label={t("web.appearance.colorMode")} value={colorScheme} onChange={(v: ColorScheme) => setColorScheme(v)}
            className="w-full" optionClassName="flex-1"
            options={COLOR_SCHEMES.map((s) => ({ value: s, label: t(`web.me.colorSchemeOptions.${s}`) }))} />
        </SurfaceCard>

        <SurfaceCard className={section}>
          <h2 className={title}>
            {t("web.appearance.presets")}
            <span data-testid="appearance-preset-name" className="font-medium">{t(`web.appearance.preset.${theme.preset}`)}</span>
          </h2>
          <div className="grid grid-cols-3 gap-2.5">
            {(["clear", "frosted", "solid"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={theme.preset === p} onClick={() => applyPreset(p)}
                className={cn("well flex min-h-tap flex-col items-center gap-1.5 rounded-tile px-2 pb-2.5 pt-2 text-sub font-semibold text-ink",
                  theme.preset === p && "shadow-[inset_0_0_0_2px_rgb(var(--blue))]")}>
                <span aria-hidden className="relative block h-[50px] w-full overflow-hidden rounded-[calc(var(--gx-radius,1)*22px-8px)] bg-[repeating-linear-gradient(135deg,rgb(var(--ink-3))_0_6px,transparent_6px_14px)]">
                  <i className={cn("absolute inset-x-2.5 inset-y-[11px] rounded-[10px] border border-white/80", PRESET_SWATCH[p])} />
                </span>
                {t(`web.appearance.preset.${p}`)}
                <small className="text-label font-normal text-ink-2">{t(`web.appearance.presetHint.${p}`)}</small>
              </button>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard className={section}>
          <h2 className={title}>{t("web.appearance.glass")}</h2>
          {rt ? (
            <p role="note" className="mb-1.5 flex gap-1.5 text-meta text-amber"><InfoIcon aria-hidden className="size-4 flex-none" />{t("web.appearance.reducedTransparency")}</p>
          ) : null}
          <GlassSlider id="glass-tint" label={t("web.appearance.tint")} value={Math.round(tintToSlider(theme.tint))} min={0} max={100} step={1}
            format={(v) => String(Math.round(v))} disabled={rt}
            onChange={(v) => update({ tint: sliderToTint(v) })}
            hint={computed.floorHit ? t("web.appearance.floor") : t("web.appearance.tintHint")} warn={computed.floorHit} />
          <GlassSlider id="glass-blur" label={t("web.appearance.blur")} value={theme.blur} min={0} max={1.5} step={0.05} disabled={rt}
            format={() => `${computed.blurPx.chrome} px`} onChange={(blur) => update({ blur })}
            hint={lite ? t("web.appearance.effectHint") : undefined} />
          <GlassSlider id="glass-saturate" label={t("web.appearance.saturate")} value={theme.saturate} min={1} max={2} step={0.05} disabled={rt}
            format={(v) => v.toFixed(2)} onChange={(saturate) => update({ saturate })} />
        </SurfaceCard>

        <SurfaceCard className={section}>
          <h2 className={title}>{t("web.appearance.shape")}</h2>
          {/* 不用 SegmentedControl:它在值不匹配时会把第一段标成选中;滑块调到非预设值时三颗都不选中 */}
          <div role="group" aria-label={t("web.appearance.radius")} className="well mb-1 grid grid-cols-3 gap-0.5 rounded-full p-[3px]">
            {(["compact", "standard", "round"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={radiusPreset === k} onClick={() => update({ radius: RADIUS_PRESETS[k] })}
                className={cn("hit-expand h-8 rounded-full text-sub", radiusPreset === k ? "bg-surface font-semibold text-blue shadow-[0_2px_8px_-3px_rgba(17,19,24,.25)] dark:bg-white/[.16]" : "font-medium text-ink-2")}>
                {t(`web.appearance.radiusPreset.${k}`)}
              </button>
            ))}
          </div>
          <GlassSlider id="glass-radius" label={t("web.appearance.radius")} value={theme.radius} min={0.5} max={1.3} step={0.05}
            format={(v) => `${Math.round(26 * v)} px`} onChange={(radius) => update({ radius })} />
          <GlassSlider id="glass-rim" label={t("web.appearance.rim")} value={theme.rim} min={0} max={1.5} step={0.05}
            format={(v) => `${Math.round(v * 100)}%`} onChange={(rim) => update({ rim })} />
          <GlassSlider id="glass-shadow" label={t("web.appearance.shadow")} value={theme.shadow} min={0} max={1.5} step={0.05}
            format={(v) => `${Math.round(v * 100)}%`} onChange={(shadow) => update({ shadow })} />
        </SurfaceCard>

        <SurfaceCard className={section}>
          <BackgroundPicker initialMode={dark ? "dark" : "light"} />
        </SurfaceCard>

        <SurfaceCard className={section}>
          <h2 className={title}>{t("web.appearance.effect")}</h2>
          <SegmentedControl label={t("web.appearance.effect")} value={theme.reduced ? "reduced" : "standard"} className="w-full" optionClassName="flex-1"
            onChange={(v) => update({ reduced: v === "reduced" })}
            options={(["standard", "reduced"] as const).map((v) => ({ value: v, label: t(`web.appearance.effectOption.${v}`) }))} />
          <p className="mt-2 text-meta text-ink-2">{t("web.appearance.effectHint")}</p>
        </SurfaceCard>

        <div className="mt-6 text-center">
          <button type="button" onClick={() => { reset(); toast.success(t("web.appearance.resetDone")); }}
            className={cn("inline-flex h-12 items-center gap-2 px-6 text-body font-semibold", LQ_SECONDARY)}>
            <RotateCcwIcon aria-hidden className="size-[18px]" />{t("web.appearance.reset")}
          </button>
        </div>
      </div>
    </div>
  );
}
