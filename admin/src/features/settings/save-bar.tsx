import { S } from "./strings";

/** 底部保存栏:草稿数 + "放弃修改" + "检查并保存"(保存只经 ReviewDialog)。 */
export function SaveBar({ count, dangerCount = 0, onReview, onDiscard }: { count: number; dangerCount?: number; onReview: () => void; onDiscard: () => void }) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-0 z-20 -mx-6 flex items-center gap-3 border-t border-line bg-surface/95 px-6 py-3 shadow-float backdrop-blur">
      <span aria-hidden="true" className="inline-block h-[7px] w-[7px] rounded-full bg-accent" />
      <b className="text-sm font-semibold">{S.unsaved(count)}</b>
      {dangerCount > 0 && <span className="text-xs text-fg-2">{S.unsavedDanger(dangerCount)}</span>}
      <span className="flex-1" />
      <button type="button" className="btn-ghost btn-sm" onClick={onDiscard}>
        {S.discard}
      </button>
      <button type="button" className="btn-primary btn-sm" onClick={onReview}>
        {S.review}
      </button>
    </div>
  );
}
