import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { Switch } from "@renderer/components/ui/switch";
import { SheetHeader, SheetTitle } from "@renderer/components/ui/sheet";
import { BottomSheet, BottomSheetContent } from "~/components/bottom-sheet";
import { Textarea } from "@renderer/components/ui/textarea";
import { voicesFor, type ServerAiConfig } from "~/api/server-config";
import type { ConversationConfig } from "./chat-api";

const selectClass = "h-11 w-full rounded-md border bg-background px-3 text-base";

export function ConversationSettingsSheet({ open, onOpenChange, config, ai, onSave }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  config: ConversationConfig;
  ai: ServerAiConfig | null;
  onSave(next: ConversationConfig): Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  // 仅在打开时(false -> true)重置草稿;父组件重渲染产生的新 config 对象不能冲掉用户正在输入的内容
  const configRef = useRef(config);
  configRef.current = config;
  useEffect(() => { if (open) setDraft(configRef.current); }, [open]);
  const voices = ai ? voicesFor(ai, draft.ttsModel) : [];

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onOpenChange(false);
    } catch {
      // 保存失败:保持面板打开,错误提示由 onSave 负责
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetHeader><SheetTitle className="text-left">{t("web.chat.settings")}</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-4">
          <label className="block space-y-1 text-sm">
            <span>{t("web.chat.settingsForm.systemPrompt")}</span>
            <Textarea data-testid="settings-system-prompt" rows={4} className="text-base" value={draft.systemPrompt}
              onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} />
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t("web.chat.settingsForm.model")}</span>
            <select data-testid="settings-model" className={selectClass} value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
              <option value="">{t("web.chat.settingsForm.serverDefault")}</option>
              {(ai?.llmModels ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t("web.chat.settingsForm.ttsModel")}</span>
            <select data-testid="settings-tts-model" className={selectClass} value={draft.ttsModel}
              onChange={(e) => {
                const ttsModel = e.target.value;
                const first = ai ? voicesFor(ai, ttsModel)[0]?.value ?? "" : "";
                setDraft({ ...draft, ttsModel, ttsVoice: first });
              }}>
              {(ai?.ttsModels ?? [draft.ttsModel]).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t("web.chat.settingsForm.voice")}</span>
            <select data-testid="settings-tts-voice" className={selectClass} value={draft.ttsVoice}
              onChange={(e) => setDraft({ ...draft, ttsVoice: e.target.value })}>
              {voices.length ? voices.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)
                : <option value={draft.ttsVoice}>{draft.ttsVoice}</option>}
            </select>
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>{t("web.chat.settingsForm.bilingual")}</span>
            <Switch data-testid="settings-bilingual" checked={draft.bilingual === true}
              onCheckedChange={(checked) => setDraft({ ...draft, bilingual: checked })} />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>
              {t("web.chat.settingsForm.grammarCheck")}
              <span className="block text-xs text-muted-foreground">{t("web.chat.settingsForm.grammarCheckHint")}</span>
            </span>
            <Switch data-testid="settings-grammar-check" checked={draft.grammarCheck !== false}
              onCheckedChange={(checked) => setDraft({ ...draft, grammarCheck: checked })} />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>
              {t("web.chat.settingsForm.coachMode")}
              <span className="block text-xs text-muted-foreground">{t("web.chat.settingsForm.coachModeHint")}</span>
            </span>
            <Switch data-testid="settings-coach-mode" checked={draft.coachMode === true}
              onCheckedChange={(checked) => setDraft({ ...draft, coachMode: checked })} />
          </label>
          <Button data-testid="settings-save" className="h-11 w-full" disabled={saving} onClick={() => void save()}>
            {t("web.chat.settingsForm.save")}
          </Button>
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
