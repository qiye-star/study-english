import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { cn } from "@renderer/lib/utils";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { voicesFor, type ServerAiConfig } from "~/api/server-config";
import type { ConversationConfig } from "./chat-api";
import { LEVELS, normalizeLevel, type Level } from "./levels";
import { VoicePicker } from "./voice-picker";
import { MAX_CUSTOM_SCENARIO, PRESET_SCENARIO_IDS, sanitizeCustomScenario } from "./scenarios";
import { Group, SwitchRow, fieldClass, hintClass, labelClass, selectClass, textareaClass } from "./sheet-form";

/**
 * 自由对话的角色提示词上限。实时通话的开始消息里提示词 ≤ 8000 字符(服务端 StartMsg,`START_LIMITS.systemPrompt`),
 * effectiveSystemPrompt 会再接上 "\n\n" + 难度要求(最长约 260 字符):留足余量,保证用户写下的内容通话时不被截断。
 * 场景对话不用它(场景提示词自身有界)。conversation-settings-sheet.test.tsx 断言这一不变式。
 */
export const MAX_SYSTEM_PROMPT = 7500;

const OPTIONAL_STRINGS = new Set(["model", "ttsModel", "ttsVoice"]);

/** 存储的自定义文本可能是垃圾值(非字符串),一律当作空串 */
const customText = (scenario?: { custom?: unknown }) => (typeof scenario?.custom === "string" ? scenario.custom : "");

const sameValue = (a: unknown, b: unknown) =>
  a === b || (!!a && !!b && typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));

/** 草稿相对打开时种子的差异;模型/语音被改成空串时记为 undefined(清除),绝不发送空串;场景按内容比较,自定义文本先清洗 */
function diffConfig(seed: ConversationConfig, draft: ConversationConfig): Partial<ConversationConfig> {
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as Array<keyof ConversationConfig>) {
    let value: unknown = draft[key];
    if (key === "scenario" && draft.scenario?.id === "custom") value = { id: "custom", custom: sanitizeCustomScenario(customText(draft.scenario)) };
    if (sameValue(value, seed[key])) continue;
    changes[key] = OPTIONAL_STRINGS.has(key) && value === "" ? undefined : value;
  }
  return changes as Partial<ConversationConfig>;
}

export function ConversationSettingsSheet({ open, onOpenChange, config, ai, onSave }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  config: ConversationConfig;
  ai: ServerAiConfig | null;
  /** 只含用户在面板里改动过的键;值为 undefined 表示清除该键(回到服务端默认) */
  onSave(changes: Partial<ConversationConfig>): Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  // 仅在打开时(false -> true)重置草稿;父组件重渲染产生的新 config 对象不能冲掉用户正在输入的内容
  const configRef = useRef(config);
  configRef.current = config;
  const seedRef = useRef(config);
  useEffect(() => { if (open) { seedRef.current = configRef.current; setDraft(configRef.current); } }, [open]);
  const uid = useId();
  const promptCountId = `${uid}-prompt-count`;
  const voices = ai ? voicesFor(ai, draft.ttsModel) : [];
  const scenarioId = draft.scenario?.id && (draft.scenario.id === "custom" || (PRESET_SCENARIO_IDS as readonly string[]).includes(draft.scenario.id))
    ? draft.scenario.id : "free";
  const customInvalid = scenarioId === "custom" && !sanitizeCustomScenario(customText(draft.scenario));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(diffConfig(seedRef.current, draft));
      onOpenChange(false);
    } catch {
      // 保存失败:保持面板打开,错误提示由 onSave 负责
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="max-h-[85dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.chat.settings")} />
        <div className="space-y-section pb-1">
          <Group title={t("web.chat.settingsForm.groupConversation")}>
            <label className={fieldClass}>
              <span className={labelClass}>{t("web.chat.settingsForm.scenario")}</span>
              <select data-testid="settings-scenario" className={selectClass} value={scenarioId}
                onChange={(e) => {
                  const id = e.target.value;
                  setDraft({ ...draft, scenario: id === "custom" ? { id, custom: customText(draft.scenario) } : { id } });
                }}>
                {(["free", ...PRESET_SCENARIO_IDS, "custom"] as const).map((id) => (
                  <option key={id} value={id}>{t(`web.chat.scenarios.${id}.title`)}</option>
                ))}
              </select>
              <span className={hintClass}>{t("web.chat.settingsForm.scenarioHint")}</span>
            </label>
            {scenarioId === "custom" && (
              <div className={fieldClass}>
                <Textarea data-testid="settings-scenario-custom" rows={3} maxLength={MAX_CUSTOM_SCENARIO} className={textareaClass}
                  aria-label={t("web.chat.scenarios.custom.title")}
                  placeholder={t("web.chat.scenarios.custom.placeholder")} value={customText(draft.scenario)}
                  onChange={(e) => setDraft({ ...draft, scenario: { id: "custom", custom: e.target.value } })} />
              </div>
            )}
            {scenarioId === "free" ? (
              <label className={fieldClass}>
                <span className={labelClass}>{t("web.chat.settingsForm.systemPrompt")}</span>
                <Textarea data-testid="settings-system-prompt" rows={4} className={textareaClass} value={draft.systemPrompt}
                  maxLength={MAX_SYSTEM_PROMPT} aria-describedby={promptCountId}
                  onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} />
                <span id={promptCountId} data-testid="settings-system-prompt-count" className={cn(hintClass, "num")}>
                  {t("web.chat.settingsForm.systemPromptCount", { used: (draft.systemPrompt ?? "").length, max: MAX_SYSTEM_PROMPT })}
                </span>
              </label>
            ) : (
              <p data-testid="settings-scenario-note" className={cn(fieldClass, "text-meta text-ink-2")}>{t("web.chat.settingsForm.scenarioNote")}</p>
            )}
            <label className={fieldClass}>
              <span className={labelClass}>{t("web.chat.settingsForm.level")}</span>
              <select data-testid="settings-level" className={selectClass} value={normalizeLevel(draft.level)}
                onChange={(e) => setDraft({ ...draft, level: e.target.value as Level })}>
                {LEVELS.map((l) => <option key={l} value={l}>{t(`web.chat.levels.${l}`)}</option>)}
              </select>
              <span className={hintClass}>{t("web.chat.settingsForm.levelHint")}</span>
            </label>
            <label className={fieldClass}>
              <span className={labelClass}>{t("web.chat.settingsForm.model")}</span>
              <select data-testid="settings-model" className={selectClass} value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
                <option value="">{t("web.chat.settingsForm.serverDefault")}</option>
                {(ai?.llmModels ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </Group>
          <Group title={t("web.chat.settingsForm.groupVoice")}>
            <label className={fieldClass}>
              <span className={labelClass}>{t("web.chat.settingsForm.ttsModel")}</span>
              <select data-testid="settings-tts-model" className={selectClass} value={draft.ttsModel}
                onChange={(e) => {
                  const ttsModel = e.target.value;
                  const first = ai ? voicesFor(ai, ttsModel)[0]?.value ?? "" : "";
                  setDraft({ ...draft, ttsModel, ttsVoice: first });
                }}>
                {(ai?.ttsModels ?? [draft.ttsModel]).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <div className={fieldClass}>
              <VoicePicker voices={voices} model={draft.ttsModel} value={draft.ttsVoice ?? ""}
                onChange={(ttsVoice) => setDraft({ ...draft, ttsVoice })} />
              <p data-testid="settings-near-field-tip" className={hintClass}>{t("web.chat.voice.nearFieldTip")}</p>
            </div>
            <SwitchRow id={`${uid}-auto-speak`} testId="settings-auto-speak" title={t("web.chat.settingsForm.autoSpeak")}
              hint={t("web.chat.settingsForm.autoSpeakHint")} checked={draft.autoSpeak !== false}
              onChange={(checked) => setDraft({ ...draft, autoSpeak: checked })} />
          </Group>
          <Group title={t("web.chat.settingsForm.groupLearning")}>
            <SwitchRow id={`${uid}-bilingual`} testId="settings-bilingual" title={t("web.chat.settingsForm.bilingual")}
              checked={draft.bilingual === true} onChange={(checked) => setDraft({ ...draft, bilingual: checked })} />
            <SwitchRow id={`${uid}-grammar-check`} testId="settings-grammar-check" title={t("web.chat.settingsForm.grammarCheck")}
              hint={t("web.chat.settingsForm.grammarCheckHint")} checked={draft.grammarCheck !== false}
              onChange={(checked) => setDraft({ ...draft, grammarCheck: checked })} />
            <SwitchRow id={`${uid}-coach-mode`} testId="settings-coach-mode" title={t("web.chat.settingsForm.coachMode")}
              hint={t("web.chat.settingsForm.coachModeHint")} checked={draft.coachMode === true}
              onChange={(checked) => setDraft({ ...draft, coachMode: checked })} />
          </Group>
          <Button data-testid="settings-save" className="h-12 w-full rounded-button text-body font-semibold" disabled={saving || customInvalid} onClick={() => void save()}>
            {t("web.chat.settingsForm.save")}
          </Button>
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
