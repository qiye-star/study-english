import type { TFunction } from "i18next";
import { LQ_DANGER_TEXT, LQ_FIELD, LQ_PRIMARY, LQ_SECONDARY } from "~/components/liquid";
import { cn } from "@renderer/lib/utils";
import type { Tone } from "~/components/tone";
import type { MemoryKind, PersonaRef } from "./memory-api";

// 记忆页共用的按钮类(12px 圆角、15px 半粗;主按钮蓝、次按钮 surface + 发丝线、危险红)。
const BASE = cn(
  "inline-flex min-w-0 items-center justify-center gap-2 rounded-button px-4 text-body font-semibold",
  "transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
);
export const PRIMARY = `${BASE} bg-blue text-on-blue active:bg-blue/90 ${LQ_PRIMARY}`;
export const GHOST = `${BASE} border-[0.5px] border-hair bg-surface text-ink active:bg-surface-2 ${LQ_SECONDARY}`;
/** 只给「清空」:一色一义,红只用于危险。 */
export const DANGER = `${BASE} bg-red-solid text-white active:bg-red-solid/90 ${LQ_DANGER_TEXT}`;
export const FIELD = `min-h-tap w-full rounded-button border-[0.5px] border-hair bg-surface px-3 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${LQ_FIELD}`;
export const NOTE = "text-sub text-ink-2";
/** 琥珀 = 弱点(提醒),绿 = 进步(完成),其余中性。 */
export const KIND_TONE: Record<MemoryKind, Tone> = { fact: "gray", preference: "gray", goal: "gray", weakness: "amber", progress: "green" };

export const fmtDate = (iso: string, lang: string) =>
  new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" }).format(new Date(iso));

export const personaLabel = (t: TFunction, persona: PersonaRef | null) =>
  persona === null ? t("web.agents.memory.items.shared") : persona.name ?? t("web.agents.memory.items.deletedPersona");
