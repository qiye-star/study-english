import { ChevronDownIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { SHADOW_SERVER_ERRORS, type SegmentWithAi } from "./attempts-api";
import { analyzeSegment } from "./library-api";
import { lookupContext } from "~/lib/lookup-context";
import "./locales";
import { BlurText, GlassSurface } from "./shadow-fx";

export interface AnalysisSection {
  title: string | null;
  body: string;
}

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

/**
 * 桌面端 analyze 提示词返回的 markdown 分节(### Sentence Structure / ### Grammar / ### Vocabulary/Phrases,标题可能被译成母语):
 * 以 # 开头的行是一节的标题,其后到下一个标题之前是正文;标题前的文字是无标题的一节;正文为空的节丢弃;一个标题都没有就整段当一节。
 */
export function parseAnalysis(text: string): AnalysisSection[] {
  const sections: AnalysisSection[] = [];
  let title: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) sections.push({ title, body });
    lines = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      title = heading[1] || null;
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections.length ? sections : [{ title: null, body: text.trim() }];
}

// 本页缓存:键 = 条目 + 句序号 + 母语 + 句子原文(改了字,键就变,旧分析自然失效)。只在内存里。
const MAX_CACHED = 200;
const analysisCache = new Map<string, string>();
const keyOf = (itemId: string, idx: number, lang: string, text: string) => `${itemId}\u0000${idx}\u0000${lang}\u0000${text}`;
function remember(key: string, text: string): void {
  analysisCache.delete(key);
  analysisCache.set(key, text);
  while (analysisCache.size > MAX_CACHED) analysisCache.delete(analysisCache.keys().next().value as string);
}

/** 只给测试:清空缓存。 */
export function resetAnalysisCache(): void {
  analysisCache.clear();
}

function analysisError(t: TFunction, err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t("web.library.shadow.analysis.limited"); // 额度满(spec §9)
    if (err.status === 404) return t("web.library.shadow.analysis.unavailable"); // library_ai_enabled 关
  }
  return translateServerError(t, err, SHADOW_SERVER_ERRORS);
}

type State =
  | { status: "loading" }
  | { status: "done"; text: string; fresh: boolean }
  | { status: "error"; message: string };

export interface AnalysisCardProps {
  itemId: string;
  segment: SegmentWithAi;
}

/** 一句的 AI 分析卡(spec §11.4、设计稿 E):骨架 → BlurText 逐字浮现 → 可收起、命中缓存不再请求、失败可重试。 */
export function AnalysisCard({ itemId, segment }: AnalysisCardProps) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const { language } = useSettings();
  const native = nativeLanguageCode(language);
  const key = keyOf(itemId, segment.idx, native, segment.text);
  // 契约(ruling 1):详情只带 has_analysis,不带正文;要显示就 POST(服务端已缓存的返回 cached: true,不计额度、不动画)。只有本页缓存命中才不请求。
  const stored = analysisCache.get(key);
  const [state, setState] = useState<State>(() => (stored ? { status: "done", text: stored, fresh: false } : { status: "loading" }));
  const [collapsed, setCollapsed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const hadStored = useRef(Boolean(stored));

  const run = useCallback(async () => {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    setState({ status: "loading" });
    try {
      const res = await analyzeSegment(api, itemId, segment.idx, native, ctl.signal);
      if (ctl.signal.aborted || !mounted.current) return;
      if (!res.analysis.trim()) throw new ApiError(502, "Empty analysis");
      remember(key, res.analysis);
      setState({ status: "done", text: res.analysis, fresh: !res.cached });
    } catch (err) {
      if (ctl.signal.aborted || !mounted.current) return;
      setState({ status: "error", message: analysisError(t, err) });
    }
  }, [api, itemId, segment.idx, native, key, t]);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    mounted.current = true;
    if (!hadStored.current) void runRef.current(); // 只在挂载时请求;命中缓存 / 随句子带来的不请求
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const toggle = () => {
    // 收起后再展开不重播动画
    setState((s) => (s.status === "done" && s.fresh ? { ...s, fresh: false } : s));
    setCollapsed((v) => !v);
  };

  return (
    <GlassSurface tint data-testid="analysis-card" data-status={state.status} className="p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-meta text-ink-2">
          <SparklesIcon aria-hidden className="h-3.5 w-3.5" />
          {t("web.library.shadow.analysis.title")}
        </span>
        <button
          type="button" data-testid="analysis-toggle" aria-expanded={!collapsed} onClick={toggle}
          className="-mr-2 inline-flex min-h-tap items-center gap-1 rounded-button px-2 text-meta text-ink-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? t("web.library.shadow.analysis.expand") : t("web.library.shadow.analysis.collapse")}
          <ChevronDownIcon aria-hidden className={cn("h-4 w-4 transition-transform duration-fast motion-reduce:transition-none", !collapsed && "rotate-180")} />
        </button>
      </div>
      {!collapsed && (
        <div className="mt-1" aria-live="polite">
          {state.status === "loading" && (
            <div role="status" data-testid="analysis-loading" aria-label={t("web.library.shadow.analysis.loading")} className="space-y-2 py-1">
              {["w-11/12", "w-full", "w-8/12"].map((w) => (
                <div key={w} className={cn("h-3 animate-pulse rounded-inline bg-surface-2 motion-reduce:animate-none", w)} />
              ))}
            </div>
          )}
          {state.status === "error" && (
            <div>
              <p role="alert" data-testid="analysis-error" className="text-sub text-ink-2">{state.message}</p>
              <Button variant="outline" data-testid="analysis-retry" className="mt-2 h-tap" onClick={() => void run()}>
                {t("web.library.shadow.analysis.retry")}
              </Button>
            </div>
          )}
          {state.status === "done" && (
            <div {...lookupContext} className="select-text">
              {parseAnalysis(state.text).map((section, i) => (
                <section key={i} className="mt-2.5 first:mt-0">
                  {section.title && <h4 className="text-meta font-semibold text-teal">{section.title}</h4>}
                  {section.body.split(/\n+/).map((paragraph, j) => (
                    <p key={j} className="mt-0.5 text-sub leading-[1.7] text-ink">
                      {state.fresh ? <BlurText text={paragraph} /> : paragraph}
                    </p>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </GlassSurface>
  );
}
