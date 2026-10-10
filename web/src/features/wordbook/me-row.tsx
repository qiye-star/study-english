import { LibraryBigIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { ToneBadge } from "~/components/tone-badge";
import { bookTitle, fmt } from "./ui";
import { useWordbookToday } from "./use-today";
import { useWordbookEnabled } from "./use-wordbook-config";

/**
 * 「我的 → 学习」里的「背单词」行(spec §11.1,视觉稿 12):副标题「书名 · 已掌握 m 词」,右侧蓝色徽标 = 待复习数。
 * 开关关闭时不渲染;今日数据没到时先只显示标题。
 */
export function WordbookMeRow() {
  const { t, i18n } = useTranslation();
  const enabled = useWordbookEnabled();
  const { today } = useWordbookToday(enabled);
  if (!enabled) return null;
  const subtitle = today?.book && today.progress
    ? t("web.wordbook.meRow.subtitle", { book: bookTitle(today.book, i18n.language), m: fmt(today.progress.mastered) })
    : today && !today.enrollment ? t("web.wordbook.meRow.pick") : undefined;
  const due = today?.plan?.reviewLeft ?? 0;
  return (
    <ListRow icon={<IconChip tone="teal" icon={LibraryBigIcon} />} title={t("web.wordbook.card.title")} subtitle={subtitle}
      value={due > 0 ? <ToneBadge tone="blue" className="num">{due}</ToneBadge> : undefined}
      to="/wordbook" testId="me-wordbook" />
  );
}
