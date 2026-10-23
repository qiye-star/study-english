import "./locales";
import { useTranslation } from "react-i18next";

/** 今天的默认对话没有消息时(问候关闭或生成失败):不出现「选择角色」,默认对话本来就有角色。 */
export function EmptyDay() {
  const { t } = useTranslation();
  return (
    <div data-testid="chat-empty-day" className="py-6 text-center">
      <p className="text-body font-medium text-ink">{t("web.chat.home.emptyDay.title")}</p>
      <p className="mt-1 text-sub text-ink-2">{t("web.chat.home.emptyDay.hint")}</p>
    </div>
  );
}
