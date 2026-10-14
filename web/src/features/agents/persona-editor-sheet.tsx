import "./locales";
import { ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@renderer/components/ui/switch";
import { ApiError } from "~/api/client";
import { loadServerAiConfig, voicesFor, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { LevelHint } from "~/components/level-hint";
import { cn } from "~/lib/cn";
import { levelLabel } from "~/lib/levels";
import { agentsApi, personaErrorKey } from "./agents-api";
import { PERSONA_LEVELS, PERSONA_STYLES, TOOL_KEYS, type Persona, type PersonaDraft, type ToolKey } from "./types";
import { useAgentsConfig } from "./use-agents-data";

export const NAME_MAX = 20;
export const INTRO_MAX = 60;

/** 新建:工具全开(D2)、人设公开(D3)。编辑:沿用角色的值(人设原文只有本人能取到)。 */
export function draftOf(p: Persona | null): PersonaDraft {
  if (!p) return { name: "", intro: "", prompt: "", level: "B1", style: "friendly", voice: null, tools: [...TOOL_KEYS], promptPublic: true, deepThink: false };
  return { name: p.name, intro: p.intro, prompt: p.prompt ?? "", level: p.level, style: p.style, voice: p.voice, tools: [...p.tools], promptPublic: p.promptPublic, deepThink: p.deepThink };
}

export function validateDraft(d: PersonaDraft, promptMax: number): "name" | "prompt" | null {
  const name = d.name.trim();
  if (!name || name.length > NAME_MAX) return "name";
  if (!d.prompt.trim() || d.prompt.length > promptMax) return "prompt";
  return null;
}

const fieldClass = "mb-3.5 block";
const labelClass = "mb-1.5 flex justify-between text-meta text-ink-2";
const inputClass = "w-full rounded-[12px] border-0 bg-surface-2 px-3 py-2.5 text-base text-ink placeholder:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30";
const chipClass = (on: boolean) => cn(
  "hit-expand h-8 rounded-full px-3 text-sub transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  on ? "bg-blue-tint font-semibold text-blue" : "bg-surface-2 text-ink-2",
);
const TOOL_TONE: Record<ToolKey, string> = {
  lookup: "bg-teal-tint text-teal", learned_words: "bg-amber-tint text-amber", weak_words: "bg-amber-tint text-amber",
  due_words: "bg-amber-tint text-amber", memory: "bg-amber-tint text-amber",
};

export interface PersonaEditorSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** null = 新建 */
  persona: Persona | null;
  onSaved(persona: Persona): void;
  onDeleted?(id: string): void;
}

type Trial = { text: string; state: "idle" | "loading" | "done" | "error" | "unavailable"; reply?: string };

/** 创建 / 编辑角色(视觉稿 6 屏)。音色不试听(R-W7);试聊一句不保存(R-W8)。 */
export function PersonaEditorSheet({ open, onOpenChange, persona, onSaved, onDeleted }: PersonaEditorSheetProps) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const { config } = useAgentsConfig();
  const promptMax = config?.promptMaxChars ?? 800;
  const uid = useId();
  const [draft, setDraft] = useState<PersonaDraft>(() => draftOf(persona));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [trial, setTrial] = useState<Trial>({ text: "", state: "idle" });
  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  useEffect(() => {
    if (!open) return;
    setDraft(draftOf(persona));
    setError(null);
    setConfirmDelete(false);
    setTrial((prev) => ({ text: t("web.agents.editor.tryDefault"), state: prev.state === "unavailable" ? "unavailable" : "idle" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, persona?.id ?? null]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }, (): void => undefined);
    return () => { alive = false; };
  }, [open, api]);

  const voices = ai ? voicesFor(ai, ai.defaultTts.model) : [];
  const invalid = validateDraft(draft, promptMax);
  const clean = (): PersonaDraft => ({ ...draft, name: draft.name.trim(), intro: draft.intro.trim(), prompt: draft.prompt.trim() });
  const toggleTool = (key: ToolKey, on: boolean) =>
    setDraft((d) => ({ ...d, tools: on ? TOOL_KEYS.filter((k) => k === key || d.tools.includes(k)) : d.tools.filter((k) => k !== key) }));

  const save = async () => {
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(persona ? await agentsApi.updatePersona(api, persona.id, clean()) : await agentsApi.createPersona(api, clean()));
    } catch (err) {
      setError(t(personaErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!persona || saving) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await agentsApi.deletePersona(api, persona.id);
      onDeleted?.(persona.id);
    } catch (err) {
      setError(t(personaErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };
  const tryLine = async () => {
    if (invalid || !trial.text.trim() || trial.state === "loading" || trial.state === "unavailable") return;
    setTrial((s) => ({ ...s, state: "loading", reply: undefined }));
    try {
      const { text } = await agentsApi.tryPersona(api, clean(), trial.text.trim());
      setTrial((s) => ({ ...s, state: "done", reply: text }));
    } catch (err) {
      setTrial((s) => ({ ...s, state: err instanceof ApiError && err.status === 404 ? "unavailable" : "error" }));
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent data-testid="agent-persona-editor" className="max-h-[92dvh] overflow-y-auto pb-0">
        <BottomSheetHeader title={t(persona ? "web.agents.editor.editTitle" : "web.agents.editor.createTitle")} />
        <label className={fieldClass}>
          <span className={labelClass}>{t("web.agents.editor.name")}</span>
          <input data-testid="agent-editor-name" className={inputClass} maxLength={NAME_MAX} value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className={fieldClass}>
          <span className={labelClass}>{t("web.agents.editor.intro")}</span>
          <input data-testid="agent-editor-intro" className={inputClass} maxLength={INTRO_MAX} value={draft.intro}
            onChange={(e) => setDraft({ ...draft, intro: e.target.value })} />
        </label>
        <label className={fieldClass}>
          <span className={labelClass}>
            {t("web.agents.editor.prompt")}
            <span data-testid="agent-editor-prompt-count" id={`${uid}-count`} className="num">
              {t("web.agents.editor.promptCount", { used: draft.prompt.length, max: promptMax })}
            </span>
          </span>
          <textarea data-testid="agent-editor-prompt" rows={4} maxLength={promptMax} aria-describedby={`${uid}-count`} value={draft.prompt}
            className={cn(inputClass, "min-h-24 resize-none leading-body")} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
        </label>
        <div className={fieldClass}>
          <span className={labelClass}>
            <span id={`${uid}-level`}>{t("web.agents.editor.level")}</span>
            <LevelHint code={draft.level} id={`${uid}-level-hint`} testId="agent-editor-level-hint" className="text-right" />
          </span>
          <div role="radiogroup" aria-labelledby={`${uid}-level`} aria-describedby={`${uid}-level-hint`} className="flex flex-wrap gap-1.5">
            {PERSONA_LEVELS.map((level) => (
              <button key={level} type="button" role="radio" aria-checked={draft.level === level} data-testid={`agent-editor-level-${level}`}
                className={chipClass(draft.level === level)} onClick={() => setDraft({ ...draft, level })}>{levelLabel(t, level)}</button>
            ))}
          </div>
        </div>
        <div className={fieldClass}>
          <span className={labelClass} id={`${uid}-style`}>{t("web.agents.editor.style")}</span>
          <div role="radiogroup" aria-labelledby={`${uid}-style`} className="flex flex-wrap gap-1.5">
            {PERSONA_STYLES.map((style) => (
              <button key={style} type="button" role="radio" aria-checked={draft.style === style} data-testid={`agent-editor-style-${style}`}
                className={chipClass(draft.style === style)} onClick={() => setDraft({ ...draft, style })}>{t(`web.agents.editor.styles.${style}`)}</button>
            ))}
          </div>
        </div>
        <label className={fieldClass}>
          <span className={labelClass}>{t("web.agents.editor.voice")}</span>
          <select data-testid="agent-editor-voice" className={inputClass} value={draft.voice ?? ""}
            onChange={(e) => setDraft({ ...draft, voice: e.target.value || null })}>
            <option value="">{t("web.agents.editor.voiceDefault")}</option>
            {voices.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </label>
        <p className={labelClass}>{t("web.agents.editor.tools")}</p>
        <div className="divide-y-[0.5px] divide-hair-2">
          {TOOL_KEYS.map((key) => (
            <div key={key} className="flex min-h-row items-center gap-2.5 py-1.5">
              <span aria-hidden className={cn("flex h-7 w-7 flex-none items-center justify-center rounded-[9px] text-label font-semibold", TOOL_TONE[key])}>
                {t(`web.agents.tools.${key}`).slice(0, 1)}
              </span>
              <label htmlFor={`${uid}-${key}`} className="min-w-0 flex-1 text-body text-ink">
                {t(`web.agents.tools.${key}`)}
                <span className="block text-meta text-ink-2">{t(`web.agents.toolHints.${key}`)}</span>
              </label>
              <Switch id={`${uid}-${key}`} data-testid={`agent-editor-tool-${key}`} checked={draft.tools.includes(key)} onCheckedChange={(on) => toggleTool(key, on)}
                className="hit-expand h-[26px] w-11 flex-none data-[state=checked]:bg-blue data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair" />
            </div>
          ))}
          <div className="flex min-h-row items-center gap-2.5 py-1.5">
            <label htmlFor={`${uid}-public`} className="min-w-0 flex-1 text-body text-ink">
              {t("web.agents.editor.promptPublic")}
              <span className="block text-meta text-ink-2">{t("web.agents.editor.promptPublicHint")}</span>
            </label>
            <Switch id={`${uid}-public`} data-testid="agent-editor-prompt-public" checked={draft.promptPublic} onCheckedChange={(promptPublic) => setDraft({ ...draft, promptPublic })}
              className="hit-expand h-[26px] w-11 flex-none data-[state=checked]:bg-blue data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair" />
          </div>
        </div>
        <p className="mt-2.5 flex gap-2 rounded-[10px] bg-amber-tint px-3 py-2 text-meta text-amber">
          <ShieldCheckIcon aria-hidden className="mt-px h-4 w-4 flex-none" />{t("web.agents.editor.safety")}
        </p>
        <label className="mt-3.5 block">
          <span className={labelClass}>{t("web.agents.editor.tryLabel")}</span>
          <input data-testid="agent-editor-try-text" className={inputClass} maxLength={200} value={trial.text}
            onChange={(e) => setTrial({ ...trial, text: e.target.value })} />
        </label>
        {trial.state === "done" && trial.reply && (
          <p data-testid="agent-editor-try-reply" className="mt-2 whitespace-pre-wrap rounded-card border-[0.5px] border-hair bg-surface px-3 py-2 text-body text-ink">{trial.reply}</p>
        )}
        {trial.state === "error" && <p role="status" className="mt-2 text-sub text-ink-2">{t("web.agents.editor.tryFailed")}</p>}
        {trial.state === "unavailable" && <p role="status" className="mt-2 text-sub text-ink-2">{t("web.agents.editor.tryUnavailable")}</p>}
        {error && <p role="alert" className="mt-2 text-sub text-red">{error}</p>}
        {!error && invalid && (draft.name || draft.prompt) && (
          <p className="mt-2 text-meta text-ink-2">{t(`web.agents.editor.errors.${invalid}`)}</p>
        )}
        {persona && (
          <button type="button" data-testid="agent-editor-delete" disabled={saving} onClick={() => void remove()}
            className="mt-3 inline-flex min-h-tap items-center gap-1.5 rounded-button px-1 text-sub font-semibold text-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Trash2Icon aria-hidden className="h-4 w-4" />{t(confirmDelete ? "web.agents.editor.deleteConfirm" : "web.agents.editor.delete")}
          </button>
        )}
        <div className="glass glass-edge-t sticky bottom-0 -mx-gutter mt-3 flex gap-2.5 px-gutter pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5">
          <button type="button" data-testid="agent-editor-try" disabled={!!invalid || trial.state === "loading" || trial.state === "unavailable"} onClick={() => void tryLine()}
            className="h-11 flex-1 whitespace-nowrap rounded-button bg-surface-2 text-body font-semibold text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("web.agents.editor.tryButton")}
          </button>
          <button type="button" data-testid="agent-editor-save" disabled={!!invalid || saving} onClick={() => void save()}
            className="h-11 flex-1 whitespace-nowrap rounded-button bg-blue text-body font-semibold text-on-blue disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("web.agents.editor.save")}
          </button>
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
