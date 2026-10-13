import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { IconButton } from "~/components/icon-button";
import { SHADOW_SERVER_ERRORS, patchSegment, type SavedSegment, type SegmentPatch, type SegmentWithAi } from "./attempts-api";
import "./locales";

export const NUDGE_MS = 200;
export const MIN_SEGMENT_MS = 200;
export const MAX_SEGMENT_TEXT = 600;

export interface Bounds {
  min: number;
  max: number;
}

interface Span {
  startMs: number;
  endMs: number;
}

/** 起点不早于上一句终点(没有 = 0),终点不晚于下一句起点(没有 = 媒体时长;时长未知 = 不限)。 */
export function segmentBounds(prevEndMs: number | null, nextStartMs: number | null, durationMs: number | null): Bounds {
  return {
    min: prevEndMs ?? 0,
    max: nextStartMs ?? durationMs ?? Number.POSITIVE_INFINITY,
  };
}

/** 移动起点或终点 delta 毫秒,夹在边界内并保留至少 MIN_SEGMENT_MS;无处可移时原样返回(R-SH16)。 */
export function nudge<T extends Span>(draft: T, edge: "start" | "end", delta: number, bounds: Bounds): T {
  if (edge === "start") {
    const lo = bounds.min;
    const hi = draft.endMs - MIN_SEGMENT_MS;
    if (lo > hi) return draft;
    return { ...draft, startMs: Math.min(Math.max(draft.startMs + delta, lo), hi) };
  }
  const lo = draft.startMs + MIN_SEGMENT_MS;
  const hi = bounds.max;
  if (lo > hi) return draft;
  return { ...draft, endMs: Math.min(Math.max(draft.endMs + delta, lo), hi) };
}

const fold = (s: string) => s.replace(/\s+/g, " ").trim();

/** 空白折叠后 1–600 字且含字母;否则 null(与 spec §9 的服务端规则一致)。 */
export function cleanSegmentText(text: string): string | null {
  const v = fold(text);
  return v && v.length <= MAX_SEGMENT_TEXT && /\p{L}/u.test(v) ? v : null;
}

/** 只含变化的键;文字无效时返回 null。 */
export function segmentPatch(orig: SavedSegment, draft: Span & { text: string }): SegmentPatch | null {
  const text = cleanSegmentText(draft.text);
  if (text === null) return null;
  const patch: SegmentPatch = {};
  if (draft.startMs !== orig.startMs) patch.startMs = draft.startMs;
  if (draft.endMs !== orig.endMs) patch.endMs = draft.endMs;
  if (text !== fold(orig.text)) patch.text = text;
  return patch;
}

/** 毫秒 → "m:ss.t"(十分之一秒,微调步长 0.2 s 需要这个精度)。 */
export function formatMs(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const rest = tenths % 600;
  return `${minutes}:${String(Math.floor(rest / 10)).padStart(2, "0")}.${rest % 10}`;
}

export interface SegmentEditorProps {
  itemId: string;
  segment: SavedSegment;
  /** 上一句的终点(没有 = null);W1 的 prevEndMs */
  prevEndMs: number | null;
  /** 下一句的起点(没有 = null);W1 的 nextStartMs */
  nextStartMs: number | null;
  durationMs: number | null;
  onSaved: (segment: SegmentWithAi) => void;
  onClose: () => void;
}

const EDGES = ["start", "end"] as const;

export function SegmentEditor({ itemId, segment, prevEndMs, nextStartMs, durationMs, onSaved, onClose }: SegmentEditorProps) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ startMs: segment.startMs, endMs: segment.endMs, text: segment.text });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const bounds = segmentBounds(prevEndMs, nextStartMs, durationMs);
  const patch = segmentPatch(segment, draft);

  const move = (edge: "start" | "end", delta: number) => setDraft((d) => nudge(d, edge, delta, bounds));

  const save = async () => {
    if (!patch || saving) return;
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await patchSegment(api, itemId, segment.idx, patch, segment);
      if (!mounted.current) return;
      toast.success(t("web.library.shadow.editor.saved"));
      onSaved(saved);
      onClose();
    } catch (err) {
      if (mounted.current) setError(translateServerError(t, err, SHADOW_SERVER_ERRORS));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <div data-testid="segment-editor" className="mt-3 space-y-3 rounded-button bg-surface-2 p-3">
      <div className="eyebrow">{t("web.library.shadow.editor.title")}</div>
      {EDGES.map((edge) => (
        <div key={edge} className="flex items-center gap-1.5">
          <span className="w-12 flex-none text-sub text-ink-2">{t(`web.library.shadow.editor.${edge}`)}</span>
          <IconButton label={t(`web.library.shadow.editor.${edge}Earlier`)} data-testid={`segment-${edge}-earlier`}
            disabled={saving} onClick={() => move(edge, -NUDGE_MS)}>
            <MinusIcon aria-hidden />
          </IconButton>
          <span data-testid={`segment-${edge}`} className="num min-w-[64px] text-center text-body text-ink">
            {formatMs(edge === "start" ? draft.startMs : draft.endMs)}
          </span>
          <IconButton label={t(`web.library.shadow.editor.${edge}Later`)} data-testid={`segment-${edge}-later`}
            disabled={saving} onClick={() => move(edge, NUDGE_MS)}>
            <PlusIcon aria-hidden />
          </IconButton>
        </div>
      ))}
      <label className="block">
        <span className="text-sub text-ink-2">{t("web.library.shadow.editor.text")}</span>
        <textarea data-testid="segment-text" rows={3} maxLength={MAX_SEGMENT_TEXT} value={draft.text} disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
          className="mt-1 w-full resize-none rounded-button border-0 bg-surface px-3 py-2 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </label>
      {!patch && (
        <p data-testid="segment-text-invalid" className="text-meta text-destructive">{t("web.library.shadow.editor.invalidText")}</p>
      )}
      {error && <p role="alert" data-testid="segment-error" className="text-sub text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" data-testid="segment-cancel" className="h-tap flex-1" disabled={saving} onClick={onClose}>
          {t("web.library.shadow.editor.cancel")}
        </Button>
        <Button data-testid="segment-save" className="h-tap flex-1" disabled={!patch || saving} onClick={() => void save()}>
          {saving ? t("web.library.shadow.editor.saving") : t("web.library.shadow.editor.save")}
        </Button>
      </div>
    </div>
  );
}
