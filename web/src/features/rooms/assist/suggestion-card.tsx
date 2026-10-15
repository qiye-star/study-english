import { CheckIcon, SendIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { lookupContext } from "~/lib/lookup-context";

const action = "hit-expand inline-flex h-9 min-w-9 flex-none items-center justify-center gap-1 rounded-badge px-2.5 text-sub font-semibold "
  + "transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4";

/**
 * 助手建议卡(spec §5.4,视觉稿 V2 .scard):英文句(15px 500)+ 备注(12px 次要色)+「发送」(主色)与「改一改」(次按钮)。
 * 按钮视觉 36px,命中区经 hit-expand 扩到 48px。used:这条建议已发到群里 →「已发送」灰字;disabled 只禁用「发送」
 * (离线、房间已结束、同一回复的另一条建议已发送——一个 assist_id 只能用一次);「改一改」始终可用(只是填进输入框)。
 */
export function SuggestionCard({ en, note, used, disabled, onSend, onEdit }: {
  en: string; note: string; used: boolean; disabled: boolean; onSend(): void; onEdit(): void;
}) {
  const { t } = useTranslation();
  return (
    <div data-testid="assist-suggestion" className="flex flex-none flex-col rounded-button py-[9px] pl-3 pr-2 shadow-hair">
      <p {...lookupContext} className="pr-1 text-body font-medium leading-[1.4] text-ink">{en}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-meta text-ink-2">{note}</p>
        {used ? (
          <span className="inline-flex h-9 flex-none items-center gap-1 px-1 text-sub font-medium text-ink-2 [&_svg]:size-4">
            <CheckIcon aria-hidden />{t("web.rooms.dock.sent")}
          </span>
        ) : (
          <button type="button" data-testid="assist-send" disabled={disabled} onClick={onSend} className={`${action} bg-blue text-on-blue active:bg-blue/90`}>
            <SendIcon aria-hidden />{t("web.rooms.dock.send")}
          </button>
        )}
        <button type="button" data-testid="assist-edit" onClick={onEdit}
          className={`${action} bg-surface text-ink shadow-hair active:bg-surface-2`}>{t("web.rooms.dock.edit")}</button>
      </div>
    </div>
  );
}
