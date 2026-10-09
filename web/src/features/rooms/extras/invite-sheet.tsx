import { CopyIcon, LoaderIcon, Share2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { cn } from "~/lib/cn";
import { ROOMS_SERVER_ERRORS } from "../rooms-api";
import { ghostButton, primaryButton, smallGhostButton, smallPrimaryButton } from "../ui";
import { copyText } from "./copy-text";
import { getInvite, rotateInvite } from "./invite-api";
import { QrCode } from "./qr";

type Load = { status: "loading" } | { status: "ready"; url: string } | { status: "error"; error: string };

/**
 * 邀请面板(spec §3.4、§6.3,视觉稿 V11;底部弹层用实色 BottomSheet——一屏最多三层模糊):
 * 完整链接(只读输入框 + 「复制」)、本地生成的二维码、`navigator.share` 可用时「分享链接」、房主「重置链接」(先确认)。
 * 审批房间只有房主能取链接(否则成员可以绕过审批):非房主只显示说明,不请求接口。
 * 链接与 token 不写日志、不进错误提示(R2-5):错误一律经 translateServerError 映射成固定文案。
 */
export function InviteSheet({ open, onOpenChange, roomId, isOwner, joinMode }: {
  open: boolean; onOpenChange(v: boolean): void; roomId: string; isOwner: boolean; joinMode: "code" | "approval";
}): JSX.Element | null {
  const { api } = useAuth();
  const { t } = useTranslation();
  const allowed = isOwner || joinMode !== "approval";
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!open || !allowed) return;
    const ctrl = new AbortController();
    setLoad({ status: "loading" });
    setConfirming(false);
    getInvite(api, roomId, ctrl.signal).then(
      (inv) => setLoad({ status: "ready", url: `${window.location.origin}${inv.path}` }),
      (err) => { if (!ctrl.signal.aborted) setLoad({ status: "error", error: translateServerError(t, err, ROOMS_SERVER_ERRORS) }); },
    );
    return () => ctrl.abort();
  }, [api, roomId, open, allowed, attempt, t]);

  const url = load.status === "ready" ? load.url : "";
  const copy = useCallback(() => {
    void copyText(url).then((ok) => (ok ? toast.success(t("web.rooms.extras.invite.copied")) : toast(t("web.rooms.extras.invite.copyManual"))));
  }, [url, t]);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const share = () => {
    navigator.share({ title: t("web.rooms.extras.invite.shareTitle"), url }).catch((): void => undefined); // 用户取消分享不算错误
  };
  const rotate = async () => {
    setRotating(true);
    try {
      const inv = await rotateInvite(api, roomId);
      if (!mounted.current) return;
      setLoad({ status: "ready", url: `${window.location.origin}${inv.path}` });
      toast.success(t("web.rooms.extras.invite.rotated"));
    } catch (err) {
      toast.error(translateServerError(t, err, ROOMS_SERVER_ERRORS));
    } finally {
      if (mounted.current) {
        setRotating(false);
        setConfirming(false);
      }
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="max-h-[90dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.rooms.extras.invite.title")} description={t("web.rooms.extras.invite.description")} srOnlyDescription />
        {!allowed ? (
          <p className="pb-2 text-sub text-ink-2">{t("web.rooms.extras.invite.approvalOnly")}</p>
        ) : load.status === "loading" ? (
          <p role="status" className="flex items-center justify-center gap-2 py-16 text-sub text-ink-2">
            <LoaderIcon aria-hidden className="size-4 animate-spin" />{t("web.common.loading")}
          </p>
        ) : load.status === "error" ? (
          <div className="py-8 text-center">
            <p role="alert" className="text-sub text-ink-2">{load.error}</p>
            <button type="button" className={cn(smallGhostButton, "mt-3")} onClick={() => setAttempt((n) => n + 1)}>{t("web.common.retry")}</button>
          </div>
        ) : (
          <>
            <div className="mx-auto mt-2.5 flex size-[212px] items-center justify-center rounded-[16px] bg-white text-[#111318] shadow-[inset_0_0_0_0.5px_rgba(17,19,24,0.12)]">
              <QrCode text={url} size={184} label={t("web.rooms.extras.invite.qrLabel")} />
            </div>
            <div className="mt-3.5 flex gap-2">
              <input data-testid="invite-link" readOnly value={url} aria-label={t("web.rooms.extras.invite.linkLabel")}
                onFocus={(e) => e.currentTarget.select()}
                className="h-tap min-w-0 flex-1 truncate rounded-button border-[0.5px] border-hair bg-surface px-3 text-[14px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30" />
              <button type="button" className={cn(smallGhostButton, "flex-none px-3.5 text-[14px]")} onClick={copy}>
                <CopyIcon aria-hidden />{t("web.rooms.extras.invite.copy")}
              </button>
            </div>
            {canShare && (
              <button type="button" className={cn(primaryButton, "mt-2.5")} onClick={share}>
                <Share2Icon aria-hidden />{t("web.rooms.extras.invite.share")}
              </button>
            )}
            {isOwner && !confirming && (
              <button type="button" className={cn(ghostButton, "mt-2")} onClick={() => setConfirming(true)}>{t("web.rooms.extras.invite.reset")}</button>
            )}
            {isOwner && confirming && (
              <div role="alertdialog" aria-labelledby="invite-reset-q" className="mt-2 rounded-card bg-surface-2 p-3">
                <p id="invite-reset-q" className="text-sub text-ink">{t("web.rooms.extras.invite.resetConfirm")}</p>
                <div className="mt-2.5 flex gap-2">
                  <button type="button" className={cn(smallGhostButton, "flex-1")} onClick={() => setConfirming(false)}>{t("web.common.cancel")}</button>
                  <button type="button" data-testid="invite-rotate-confirm" disabled={rotating} className={cn(smallPrimaryButton, "flex-1")}
                    onClick={() => void rotate()}>{t("web.rooms.extras.invite.resetDo")}</button>
                </div>
              </div>
            )}
            <p className="mt-2.5 text-center text-meta leading-[1.45] text-ink-2">{t("web.rooms.extras.invite.hint")}</p>
          </>
        )}
      </BottomSheetContent>
    </BottomSheet>
  );
}
