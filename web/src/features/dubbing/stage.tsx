import "./locales";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDubKit } from "./kit-context";

/**
 * 深色视频舞台(计划 L5 R19):视频、倒计时叠层与字幕。票据 URL 只交给 <video src>,不打印。
 * 字幕与按钮放在深色底板上(web/CLAUDE.md Rule 4:模糊层上只放标题与图标)。
 */
export function DubStage({
  itemId, onElement, overlay, subtitle,
}: {
  itemId: string;
  onElement(el: HTMLVideoElement | null): void;
  overlay?: ReactNode;
  subtitle: ReactNode;
}) {
  const { t } = useTranslation();
  const kit = useDubKit();
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const { url, error, retry } = kit.useMediaSource(itemId, true, el);
  useEffect(() => {
    onElement(el);
  }, [el, onElement]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <video ref={setEl} src={url ?? undefined} playsInline preload="auto" className="h-full w-full object-contain" />
      {overlay ? <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">{overlay}</div> : null}
      <div className="absolute inset-x-2 bottom-2 rounded-xl bg-black/65 px-3 py-2 text-[14px] text-white">{subtitle}</div>
      {error ? (
        <button type="button" onClick={retry} className="absolute inset-0 m-auto h-fit w-fit rounded-xl bg-black/70 px-4 py-2 text-[13px] text-white">
          {t("web.dubbing.stage.retry")}
        </button>
      ) : null}
    </div>
  );
}
