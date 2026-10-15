import { ChevronRightIcon, LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { LevelHint } from "~/components/level-hint";
import { levelLabel } from "~/lib/levels";
import { CHAT_SERVER_ERRORS, DEFAULT_CONVERSATION_NAME } from "./chat-api";
import { titleFrom } from "./chat-request";
import { LEVELS, type Level } from "./levels";
import { OpeningNotSavedError, discardUnfinished, runScenarioCreation, type CreationProgress, type ScenarioChoice } from "./scenario-create";
import { MAX_CUSTOM_SCENARIO, PRESET_SCENARIO_IDS, sanitizeCustomScenario } from "./scenarios";
import { Group, fieldClass, hintClass, labelClass, selectClass, textareaClass } from "./sheet-form";
import { primeAudioElement, sharedAutoplayAudio } from "./use-tts-player";

export function ScenarioSheet({ open, onOpenChange, onCreated, onDiscarded }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(conversationId: string, openingId: string | null): void;
  onDiscarded?(): void;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [level, setLevel] = useState<Level>("auto");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; opening: boolean } | null>(null);
  const busyRef = useRef(false); // 同步防连点
  const progressRef = useRef<CreationProgress>({});
  const choiceRef = useRef<ScenarioChoice | null>(null);
  const mounted = useRef(true);
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // 卸载时(返回/切路由)尽力删掉开场白没保存的空会话;创建中的由 run 收尾
      const progress = progressRef.current;
      if (!busyRef.current && progress.openingPending) {
        progressRef.current = {};
        void discardUnfinished(apiRef.current, progress);
      }
    };
  }, []);

  const run = async (discarding?: Promise<void>) => {
    const choice = choiceRef.current;
    if (!choice) return;
    setBusy(true);
    setError(null);
    const progress = progressRef.current;
    try {
      await discarding; // 先删掉上一次没完成的空会话,避免占用会话上限
      const created = await runScenarioCreation(api, choice, progress);
      progressRef.current = {};
      if (mounted.current) onCreated(created.conversation.id, created.openingId);
    } catch (err) {
      if (!mounted.current) {
        progressRef.current = {};
        void discardUnfinished(api, progress);
        return;
      }
      const opening = err instanceof OpeningNotSavedError;
      if (!opening) progressRef.current = {};
      setError({ text: opening ? t("web.chat.scenarios.openingFailed") : translateServerError(t, err, CHAT_SERVER_ERRORS), opening });
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const start = (choice: ScenarioChoice) => {
    if (busyRef.current) return;
    busyRef.current = true;
    primeAudioElement(sharedAutoplayAudio()); // R5:点击的同步阶段、任何 await 之前;会话页用同一元素读开场白
    const previous = progressRef.current;
    progressRef.current = {};
    choiceRef.current = choice;
    // 开场白失败后改选别的场景:先丢弃上一个空会话(R10)
    const discarding = previous.openingPending
      ? discardUnfinished(api, previous).then(() => { if (mounted.current) onDiscarded?.(); })
      : undefined;
    void run(discarding);
  };

  const retry = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    primeAudioElement(sharedAutoplayAudio());
    void run();
  };

  const changeOpen = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (busyRef.current) return; // 创建中不关闭,避免留下半成品
    const progress = progressRef.current;
    progressRef.current = {};
    setError(null); // 关闭时就清掉,重新打开的第一帧不会闪出旧错误
    if (progress.openingPending) void discardUnfinished(api, progress).then(() => { if (mounted.current) onDiscarded?.(); });
    onOpenChange(false);
  };

  const customText = sanitizeCustomScenario(custom);

  return (
    <BottomSheet open={open} onOpenChange={changeOpen}>
      <BottomSheetContent data-testid="scenario-sheet" className="max-h-[85dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.chat.scenarios.pick")} description={t("web.chat.scenarios.pickDescription")} />
        <div className="space-y-section pb-1">
          <div className="rounded-card border-[0.5px] border-hair bg-surface">
            <label className={fieldClass}>
              <span className={labelClass}>{t("web.chat.scenarios.level")}</span>
              <select data-testid="scenario-level" aria-describedby="scenario-level-hint" className={selectClass} value={level} disabled={busy}
                onChange={(e) => setLevel(e.target.value as Level)}>
                {LEVELS.map((l) => <option key={l} value={l}>{l === "auto" ? t("web.chat.levels.auto") : levelLabel(t, l)}</option>)}
              </select>
              <LevelHint code={level} fallback={t("web.chat.levels.autoHint")} id="scenario-level-hint" testId="scenario-level-hint" />
            </label>
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-card bg-surface-2 py-1 pl-3.5 pr-1 text-sub text-red well liquid:rounded-inset">
              <p role="alert" data-testid="scenario-error" className="flex-1">{error.text}</p>
              {error.opening && (
                <button type="button" data-testid="scenario-retry" disabled={busy} onClick={retry}
                  className="inline-flex min-h-tap items-center rounded-button px-3 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                  {t("web.common.retry")}
                </button>
              )}
            </div>
          )}
          <Group title={t("web.chat.scenarios.presets")}>
            {(["free", ...PRESET_SCENARIO_IDS] as const).map((id) => (
              <button key={id} type="button" data-testid={`scenario-${id}`} disabled={busy}
                className="flex min-h-row w-full items-center gap-3 py-2.5 pl-3.5 pr-3 text-left transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
                onClick={() => start({
                  scenario: { id },
                  level,
                  name: id === "free" ? DEFAULT_CONVERSATION_NAME : t(`web.chat.scenarios.${id}.title`),
                })}>
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-ink">{t(`web.chat.scenarios.${id}.title`)}</span>
                  <span className="mt-0.5 block text-meta text-ink-2">{t(`web.chat.scenarios.${id}.description`)}</span>
                </span>
                <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3" />
              </button>
            ))}
          </Group>
          <Group title={t("web.chat.scenarios.custom.title")}>
            <div className="space-y-2.5 px-3.5 py-3">
              <p className={hintClass}>{t("web.chat.scenarios.custom.description")}</p>
              <Textarea data-testid="scenario-custom-input" rows={3} maxLength={MAX_CUSTOM_SCENARIO} className={textareaClass}
                aria-label={t("web.chat.scenarios.custom.title")}
                placeholder={t("web.chat.scenarios.custom.placeholder")} value={custom} disabled={busy}
                onChange={(e) => setCustom(e.target.value)} />
              <Button data-testid="scenario-custom-start" className="h-12 w-full rounded-button text-body font-semibold" disabled={busy || !customText}
                onClick={() => start({ scenario: { id: "custom", custom: customText }, level, name: titleFrom(customText, 30) })}>
                {busy ? <LoaderIcon className="mr-2 h-4 w-4 animate-spin" /> : null}{t("web.chat.scenarios.custom.start")}
              </Button>
            </div>
          </Group>
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
