import { LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@renderer/components/ui/sheet";
import { Textarea } from "@renderer/components/ui/textarea";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent } from "~/components/bottom-sheet";
import { CHAT_SERVER_ERRORS, DEFAULT_CONVERSATION_NAME } from "./chat-api";
import { titleFrom } from "./chat-request";
import { LEVELS, type Level } from "./levels";
import { OpeningNotSavedError, discardUnfinished, runScenarioCreation, type CreationProgress, type ScenarioChoice } from "./scenario-create";
import { MAX_CUSTOM_SCENARIO, PRESET_SCENARIO_IDS, sanitizeCustomScenario } from "./scenarios";
import { primeAudioElement, sharedAutoplayAudio } from "./use-tts-player";

const selectClass = "h-11 w-full rounded-md border bg-background px-3 text-base";

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
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (open) setError(null); }, [open]);

  const run = async () => {
    const choice = choiceRef.current;
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const created = await runScenarioCreation(api, choice, progressRef.current);
      progressRef.current = {};
      if (mounted.current) onCreated(created.conversation.id, created.openingId);
    } catch (err) {
      if (!mounted.current) return;
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
    progressRef.current = {};
    choiceRef.current = choice;
    void run();
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
    if (progress.openingPending) void discardUnfinished(api, progress).then(() => onDiscarded?.());
    onOpenChange(false);
  };

  const customText = sanitizeCustomScenario(custom);

  return (
    <BottomSheet open={open} onOpenChange={changeOpen}>
      <BottomSheetContent data-testid="scenario-sheet" className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle className="text-left">{t("web.chat.scenarios.pick")}</SheetTitle>
          <SheetDescription className="text-left">{t("web.chat.scenarios.pickDescription")}</SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-3">
          <label className="block space-y-1 text-sm">
            <span>{t("web.chat.scenarios.level")}</span>
            <select data-testid="scenario-level" className={selectClass} value={level} disabled={busy}
              onChange={(e) => setLevel(e.target.value as Level)}>
              {LEVELS.map((l) => <option key={l} value={l}>{t(`web.chat.levels.${l}`)}</option>)}
            </select>
          </label>
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <p role="alert" data-testid="scenario-error" className="flex-1">{error.text}</p>
              {error.opening && (
                <Button variant="outline" data-testid="scenario-retry" className="h-11" disabled={busy} onClick={retry}>{t("web.common.retry")}</Button>
              )}
            </div>
          )}
          <ul className="divide-y rounded-md border">
            {(["free", ...PRESET_SCENARIO_IDS] as const).map((id) => (
              <li key={id}>
                <button type="button" data-testid={`scenario-${id}`} disabled={busy}
                  className="flex min-h-14 w-full flex-col items-start justify-center px-3 py-2 text-left disabled:opacity-50"
                  onClick={() => start({
                    scenario: { id },
                    level,
                    name: id === "free" ? DEFAULT_CONVERSATION_NAME : t(`web.chat.scenarios.${id}.title`),
                  })}>
                  <span className="font-medium">{t(`web.chat.scenarios.${id}.title`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`web.chat.scenarios.${id}.description`)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("web.chat.scenarios.custom.title")}</p>
            <p className="text-xs text-muted-foreground">{t("web.chat.scenarios.custom.description")}</p>
            <Textarea data-testid="scenario-custom-input" rows={3} maxLength={MAX_CUSTOM_SCENARIO} className="text-base"
              aria-label={t("web.chat.scenarios.custom.title")}
              placeholder={t("web.chat.scenarios.custom.placeholder")} value={custom} disabled={busy}
              onChange={(e) => setCustom(e.target.value)} />
            <Button data-testid="scenario-custom-start" className="h-11 w-full" disabled={busy || !customText}
              onClick={() => start({ scenario: { id: "custom", custom: customText }, level, name: titleFrom(customText, 30) })}>
              {busy ? <LoaderIcon className="mr-2 h-4 w-4 animate-spin" /> : null}{t("web.chat.scenarios.custom.start")}
            </Button>
          </div>
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
