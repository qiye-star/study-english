import "./locales";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { TutorBar } from "./tutor-bar";
import { TutorRecapCard } from "./tutor-recap-card";
import { useTutorSession } from "./use-tutor-session";

export interface TutorBarPanelProps {
  sessionId: string;
  /** 对话页最近一次回合的 meta 事件(第几题 / 评价);开场之前为 null */
  meta: unknown;
  /** 智能体回合正在生成 */
  busy: boolean;
  /** 再跑一个 text = null 的回合(出题 / 继续) */
  onContinue(): void;
  /** 带学结束(或总结关闭):对话页退出导师模式 */
  onEnd(): void;
  /** 最后一条完成的助手消息(「听一遍」) */
  lastReply: string;
  onSpeak(text: string): void;
  onTranslateLast(): void;
}

/**
 * `TUTOR_SLOTS.Bar`:带学条 + 总结抽屉。结束(手动或最后一题答完)后先出总结抽屉,抽屉关闭才调用 `onEnd`,
 * 这样对话页在总结可见期间仍保持导师模式,不会在已结束的会话上再发回合。
 */
export function TutorBarPanel({ sessionId, meta, busy, onContinue, onEnd, lastReply, onSpeak, onTranslateLast }: TutorBarPanelProps) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [recapOpen, setRecapOpen] = useState(false);
  const tutor = useTutorSession({ api, sessionId, meta, onContinue, onError: (message) => toast.error(message) });
  const s = tutor.session;
  const status = s?.status ?? null;
  const hasRecap = !!s?.recap;
  const ended = useRef(false);
  const end = () => { if (!ended.current) { ended.current = true; onEnd(); } };

  useEffect(() => {
    if (status === "done") {
      if (hasRecap) setRecapOpen(true);
      else end();
    } else if (status === "expired") {
      toast.error(t("web.agents.tutor.errors.expired"));
      end();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, hasRecap]);

  if (!s) return null;
  return (
    <>
      {s.status === "active" ? (
        <TutorBar session={s} hint={tutor.hint} busy={busy || tutor.busy}
          onHint={() => void tutor.requestHint()} onSkip={() => void tutor.skip()}
          onListen={() => onSpeak(s.kind === "dictate" && s.say ? s.say : lastReply)}
          onTranslate={onTranslateLast} onEnd={() => void tutor.finish()} onResume={tutor.resume} />
      ) : null}
      {s.recap ? (
        <BottomSheet open={recapOpen} onOpenChange={(open) => { setRecapOpen(open); if (!open) end(); }}>
          <BottomSheetContent data-testid="tutor-recap-sheet" className="max-h-[85dvh] overflow-y-auto">
            <BottomSheetHeader title={t("web.agents.tutor.recap.sheetTitle")} />
            <TutorRecapCard recap={s.recap} showTitle={false} />
          </BottomSheetContent>
        </BottomSheet>
      ) : null}
    </>
  );
}
