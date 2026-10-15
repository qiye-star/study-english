import { LoaderIcon, MicIcon, SparklesIcon, StarIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigationType } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@renderer/components/ui/sheet";
import { BottomSheet, BottomSheetContent } from "~/components/bottom-sheet";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { MAX_PRACTICE_TEXT, savePracticeItem, useShadowSheet, useShadowSheetOpen } from "~/features/practice";
import { WordActions } from "~/lib/extension-points-react";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { DictionaryResult } from "./dictionary-result";
import { dictToLookup, lookupDictionary, type DictEntry } from "./dictionary";
import { LOOKUP_SERVER_ERRORS, cachedLookup, cachedTranslate, classifySelection, normalizeSelection, type LookupMode, type LookupResult } from "./lookup";
import { LookupBar } from "./lookup-bar";
import { useDictionaryPrefetch } from "./use-dictionary-prefetch";
import { useLongPressLookup } from "./use-long-press-lookup";
import { useTextSelection, type TextSelectionInfo } from "./use-text-selection";
import { wordTargetFromLookup } from "./word-target";

type LookupState =
  | { status: "loading" }
  | { status: "done"; source?: "dict" | "ai"; dict?: DictEntry; lookup?: LookupResult; translation?: string }
  | { status: "error"; error: string };
type AiState = { status: "idle" } | { status: "loading" } | { status: "done"; lookup: LookupResult } | { status: "error"; error: string };

const SWIPE_CLOSE_PX = 60;

export function LookupLayer() {
  const { api } = useAuth();
  const { language } = useSettings();
  const { t } = useTranslation();
  const { selection, clear, press, release, readNow } = useTextSelection();
  const prefetched = useDictionaryPrefetch(selection);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<TextSelectionInfo | null>(null);
  const [mode, setMode] = useState<LookupMode>("lookup");
  const [state, setState] = useState<LookupState>({ status: "loading" });
  const [ai, setAi] = useState<AiState>({ status: "idle" });
  // 全站长按查词(计划 2026-10-15 R-L3):抽屉打开时停用;选中后立刻读选区,操作条马上出现
  useLongPressLookup({ enabled: !open, onSelect: readNow });
  const native = nativeLanguageCode(language);
  const controller = useRef<AbortController | null>(null);
  const aiController = useRef<AbortController | null>(null);
  const touchStart = useRef<number | null>(null);
  const { open: openShadow } = useShadowSheet();
  const shadowOpen = useShadowSheetOpen();
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const passageText = target ? normalizeSelection(target.text) : "";
  const isPassage = !!target && classifySelection(target.text) === "translate";
  // 词汇本只收单词/短语:长句即使切到"查词"也不提供
  const isWordOrPhrase = !!target && classifySelection(target.text) === "lookup";
  const tooLong = passageText.length > MAX_PRACTICE_TEXT;

  const save = async () => {
    if (saving || !passageText || tooLong) return;
    setSaving(true);
    try {
      await savePracticeItem(api, t, passageText, "lookup");
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const abort = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    aiController.current?.abort();
    aiController.current = null;
  }, []);
  useEffect(() => abort, [abort]); // no request outlives the layer

  const run = useCallback(async (info: TextSelectionInfo, nextMode: LookupMode) => {
    abort();
    const ctl = new AbortController();
    controller.current = ctl;
    setMode(nextMode);
    setState({ status: "loading" });
    setAi({ status: "idle" });
    try {
      let next: LookupState;
      if (nextMode === "lookup") {
        // 先本地词典(便宜,无上游成本);未命中或任何错误都静默回退大模型(spec D7、§3.3)。长句不问词典。
        const dict = classifySelection(info.text) === "lookup" ? await lookupDictionary(api, info.text, ctl.signal).catch((): null => null) : null;
        if (ctl.signal.aborted) return;
        next = dict
          ? { status: "done", source: "dict", dict }
          : { status: "done", source: "ai", lookup: await cachedLookup(api, { word: info.text, context: info.context, nativeLanguage: native }, ctl.signal) };
      } else {
        next = { status: "done", translation: await cachedTranslate(api, { text: info.text, nativeLanguage: native }, ctl.signal) };
      }
      if (!ctl.signal.aborted) setState(next);
    } catch (err) {
      if (ctl.signal.aborted) return;
      setState({ status: "error", error: translateServerError(t, err, LOOKUP_SERVER_ERRORS) });
    }
  }, [abort, api, native, t]);

  /** 词典命中后的「AI 结合语境讲解」:点了才调现有大模型查询(R-L10)。 */
  const explain = async () => {
    if (!target || ai.status === "loading") return;
    aiController.current?.abort();
    const ctl = new AbortController();
    aiController.current = ctl;
    setAi({ status: "loading" });
    try {
      const lookup = await cachedLookup(api, { word: target.text, context: target.context, nativeLanguage: native }, ctl.signal);
      if (!ctl.signal.aborted) setAi({ status: "done", lookup });
    } catch (err) {
      if (!ctl.signal.aborted) setAi({ status: "error", error: translateServerError(t, err, LOOKUP_SERVER_ERRORS) });
    }
  };

  const openFor = (info: TextSelectionInfo) => {
    setTarget(info);
    setOpen(true);
    void run(info, classifySelection(info.text) ?? "translate");
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      abort();
      clear();
    }
  };

  // 「单词操作」面板(联动 word_actions)里的「跟读这个词」从查词面板之上跳到跟读页:前进导航(PUSH)时收起查词面板。
  // 联动关闭时查词面板里的每个跳转都先自己关闭,前进导航不会在打开时发生,所以行为与今天相同;返回(POP)不处理。
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const shownAt = useRef(pathname);
  useEffect(() => {
    if (pathname === shownAt.current) return;
    shownAt.current = pathname;
    if (open && navigationType === "PUSH") onOpenChange(false);
  }); // 每次渲染比较路径:只在路径真的变了时动作

  // 跟读弹窗打开时收起查词面板(含「单词操作」面板里的「跟读这个词」:它不导航,抽屉不会因路径变化而收起,R-S21)。
  // 只在弹窗「打开的那一刻」触发;弹窗已开时再从弹窗里选词打开抽屉不会被它关掉。
  useEffect(() => {
    if (shadowOpen && open) onOpenChange(false);
  }, [shadowOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (start !== null && e.changedTouches[0].clientY - start > SWIPE_CLOSE_PX) onOpenChange(false);
  };

  const suggested = selection ? classifySelection(selection.text) : null;
  const done = state.status === "done" ? state : null;
  // 抽屉里「加入词汇本」的来源:词典命中用词典结果,否则用大模型结果(与改动前相同)
  const addSource = done?.dict ? dictToLookup(done.dict) : done?.lookup;

  return (
    <>
      {selection && suggested && !open && <LookupBar selection={selection} suggested={suggested} entry={prefetched} onOpen={openFor} onPress={press} onRelease={release} />}
      <BottomSheet open={open} onOpenChange={onOpenChange}>
        <BottomSheetContent data-testid="lookup-drawer"
          className="max-h-[70dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="-mt-3 mb-2 flex h-6 touch-none justify-center" aria-hidden="true" data-testid="lookup-grabber"
            onTouchStart={(e) => { touchStart.current = e.touches[0].clientY; }} onTouchEnd={onTouchEnd}>
            <span className="mt-2 h-1 w-10 rounded-full bg-muted-foreground/40" />
          </div>
          <SheetHeader>
            <SheetTitle className="line-clamp-3 text-left">{target?.text}</SheetTitle>
            <SheetDescription className="sr-only">{t("web.lookup.drawerDescription")}</SheetDescription>
          </SheetHeader>
          <div data-testid="lookup-result" data-status={state.status} aria-live="polite" className="mt-3 select-text space-y-2 text-base">
            {state.status === "loading" && <LoaderIcon className="h-5 w-5 animate-spin" aria-label={t("web.common.loading")} />}
            {state.status === "error" && <p role="alert" className="text-destructive">{state.error}</p>}
            {done?.source && (
              <p data-testid="lookup-source" data-source={done.source} className="text-xs text-muted-foreground">
                {done.source === "dict" ? t("web.lookup.sourceDict") : t("web.lookup.sourceAi")}
              </p>
            )}
            {done?.dict && <DictionaryResult entry={done.dict} />}
            {done?.lookup && <AiLookup lookup={done.lookup} fallbackWord={target?.text ?? ""} />}
            {done && done.translation !== undefined && <p className="whitespace-pre-wrap">{done.translation}</p>}
          </div>
          {done?.dict && (
            <div className="mt-3">
              {ai.status === "idle" && (
                <Button variant="outline" data-testid="lookup-ai-explain" className="h-11 w-full" onClick={() => void explain()}>
                  <SparklesIcon className="mr-2 h-4 w-4" />{t("web.lookup.aiExplain")}
                </Button>
              )}
              {ai.status === "loading" && <LoaderIcon data-testid="lookup-ai-loading" className="h-5 w-5 animate-spin" aria-label={t("web.common.loading")} />}
              {ai.status === "error" && (
                <div className="space-y-2">
                  <p role="alert" className="text-destructive">{ai.error}</p>
                  <Button variant="outline" data-testid="lookup-ai-retry" className="h-11 w-full" onClick={() => void explain()}>{t("web.common.retry")}</Button>
                </div>
              )}
              {ai.status === "done" && (
                <div data-testid="lookup-ai-result" className="select-text space-y-2 border-t pt-3">
                  <p data-testid="lookup-ai-source" className="text-xs text-muted-foreground">{t("web.lookup.sourceAi")}</p>
                  <AiLookup lookup={ai.lookup} fallbackWord={target?.text ?? ""} />
                </div>
              )}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Button variant="outline" data-testid="lookup-switch-mode" className="h-11 flex-1"
              disabled={!target || state.status === "loading"}
              onClick={() => target && void run(target, mode === "lookup" ? "translate" : "lookup")}>
              {mode === "lookup" ? t("web.lookup.translateInstead") : t("web.lookup.lookupInstead")}
            </Button>
            {state.status === "error" && target && (
              <Button data-testid="lookup-retry" className="h-11 flex-1" onClick={() => void run(target, mode)}>{t("web.common.retry")}</Button>
            )}
          </div>
          {addSource && isWordOrPhrase && target && (
            <div className="mt-2 flex">
              <WordActions key={`${target.text}
${target.context}`} testId="lookup-vocab" variant="labeled" target={wordTargetFromLookup(addSource, target)} />
            </div>
          )}
          {isPassage && (
            <div className="mt-2">
              <div className="flex gap-2">
                <Button variant="outline" data-testid="lookup-practice" className="h-11 min-w-11 flex-1" disabled={tooLong}
                  onClick={() => { onOpenChange(false); openShadow({ text: passageText, source: "lookup" }); }}>
                  <MicIcon className="mr-2 h-4 w-4" />{t("web.lookup.practice")}
                </Button>
                <Button variant="outline" data-testid="lookup-save" className="h-11 min-w-11 flex-1" disabled={tooLong || saving}
                  onClick={() => void save()}>
                  <StarIcon className="mr-2 h-4 w-4" />{t("web.lookup.save")}
                </Button>
              </div>
              {tooLong && <p data-testid="lookup-too-long" className="mt-1 text-sm text-muted-foreground">{t("web.lookup.tooLong")}</p>}
            </div>
          )}
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}

/** 大模型查词结果(原来内联在抽屉里的那一段,逐项相同)。 */
function AiLookup({ lookup, fallbackWord }: { lookup: LookupResult; fallbackWord: string }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="text-lg font-semibold">
        {lookup.word || fallbackWord}
        {lookup.pronunciation && <span className="ml-2 font-code font-normal text-muted-foreground">/{lookup.pronunciation}/</span>}
        {lookup.pos && <span className="ml-2 text-sm font-normal text-muted-foreground">{lookup.pos}</span>}
      </p>
      {lookup.lemma && lookup.lemma !== lookup.word && <p className="text-sm text-muted-foreground">{t("web.lookup.lemma")}: {lookup.lemma}</p>}
      {lookup.definition && <p>{lookup.definition}</p>}
      {lookup.translation && <p className="font-medium">{lookup.translation}</p>}
      {lookup.contextTranslation && <p className="border-l-2 pl-2 text-sm text-muted-foreground">{lookup.contextTranslation}</p>}
    </>
  );
}
