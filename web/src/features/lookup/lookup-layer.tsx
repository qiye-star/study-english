import { LanguagesIcon, LoaderIcon, MicIcon, SearchIcon, StarIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@renderer/components/ui/sheet";
import { BottomSheet, BottomSheetContent } from "~/components/bottom-sheet";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { MAX_PRACTICE_TEXT } from "~/features/practice/practice-items-api";
import { goPractice, savePracticeItem } from "~/features/practice/save-practice-item";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { LOOKUP_SERVER_ERRORS, cachedLookup, cachedTranslate, classifySelection, normalizeSelection, type LookupMode, type LookupResult } from "./lookup";
import { useTextSelection, type TextSelectionInfo } from "./use-text-selection";

type LookupState =
  | { status: "loading" }
  | { status: "done"; lookup?: LookupResult; translation?: string }
  | { status: "error"; error: string };

const SWIPE_CLOSE_PX = 60;

export function LookupLayer() {
  const { api } = useAuth();
  const { language } = useSettings();
  const { t } = useTranslation();
  const { selection, clear } = useTextSelection();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<TextSelectionInfo | null>(null);
  const [mode, setMode] = useState<LookupMode>("lookup");
  const [state, setState] = useState<LookupState>({ status: "loading" });
  const native = nativeLanguageCode(language);
  const controller = useRef<AbortController | null>(null);
  const touchStart = useRef<number | null>(null);
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const passageText = target ? normalizeSelection(target.text) : "";
  const isPassage = !!target && classifySelection(target.text) === "translate";
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
  }, []);
  useEffect(() => abort, [abort]); // no request outlives the layer

  const run = useCallback(async (info: TextSelectionInfo, nextMode: LookupMode) => {
    abort();
    const ctl = new AbortController();
    controller.current = ctl;
    setMode(nextMode);
    setState({ status: "loading" });
    try {
      const next: LookupState = nextMode === "lookup"
        ? { status: "done", lookup: await cachedLookup(api, { word: info.text, context: info.context, nativeLanguage: native }, ctl.signal) }
        : { status: "done", translation: await cachedTranslate(api, { text: info.text, nativeLanguage: native }, ctl.signal) };
      if (!ctl.signal.aborted) setState(next);
    } catch (err) {
      if (ctl.signal.aborted) return;
      setState({ status: "error", error: translateServerError(t, err, LOOKUP_SERVER_ERRORS) });
    }
  }, [abort, api, native, t]);

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

  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (start !== null && e.changedTouches[0].clientY - start > SWIPE_CLOSE_PX) onOpenChange(false);
  };

  const suggested = selection ? classifySelection(selection.text) : null;

  return (
    <>
      {selection && suggested && !open && (
        <Button data-testid="lookup-trigger"
          className="absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 h-11 -translate-x-1/2 rounded-full px-5 shadow-lg"
          onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
          onClick={() => openFor(selection)}>
          {suggested === "lookup" ? <SearchIcon className="mr-2 h-4 w-4" /> : <LanguagesIcon className="mr-2 h-4 w-4" />}
          {suggested === "lookup" ? t("web.lookup.lookup") : t("web.lookup.translate")}
        </Button>
      )}
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
            {state.status === "done" && state.lookup && (
              <>
                <p className="text-lg font-semibold">
                  {state.lookup.word || target?.text}
                  {state.lookup.pronunciation && <span className="ml-2 font-code font-normal text-muted-foreground">/{state.lookup.pronunciation}/</span>}
                  {state.lookup.pos && <span className="ml-2 text-sm font-normal text-muted-foreground">{state.lookup.pos}</span>}
                </p>
                {state.lookup.lemma && state.lookup.lemma !== state.lookup.word && (
                  <p className="text-sm text-muted-foreground">{t("web.lookup.lemma")}: {state.lookup.lemma}</p>
                )}
                {state.lookup.definition && <p>{state.lookup.definition}</p>}
                {state.lookup.translation && <p className="font-medium">{state.lookup.translation}</p>}
                {state.lookup.contextTranslation && (
                  <p className="border-l-2 pl-2 text-sm text-muted-foreground">{state.lookup.contextTranslation}</p>
                )}
              </>
            )}
            {state.status === "done" && state.translation !== undefined && <p className="whitespace-pre-wrap">{state.translation}</p>}
          </div>
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
          {isPassage && (
            <div className="mt-2">
              <div className="flex gap-2">
                <Button variant="outline" data-testid="lookup-practice" className="h-11 min-w-11 flex-1" disabled={tooLong}
                  onClick={() => { onOpenChange(false); goPractice(navigate, passageText); }}>
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
