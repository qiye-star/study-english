import { MessageSquareTextIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToneBadge } from "~/components/tone-badge";
import type { PointProps } from "~/lib/extension-points";
import { useChatWords } from "./chat-words-api";

/** wordDetailSections 贡献(link: chat_words):词卡上「今天在对话里用过」青色小标;没用过就不渲染。 */
export function ChatWordsUsedBadge({ word }: PointProps["wordDetailSections"]) {
  const { t } = useTranslation();
  const data = useChatWords();
  if (!data?.today.some((item) => item.word === word && item.used)) return null;
  return (
    <div className="mt-3" data-testid="chat-words-badge">
      <ToneBadge tone="teal">
        <MessageSquareTextIcon aria-hidden />
        {t("web.links.chatWords.badge")}
      </ToneBadge>
    </div>
  );
}
