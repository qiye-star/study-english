import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { pickText } from "~/components/announcement-banner";
import { TONE_CLASS } from "~/components/tone";
import type { ChangelogEntry, ChangelogTag } from "./api";
import { collapsedItems, formatDay, versionLabel } from "./entries";
import "./locales";

const CHIP = "mt-[2px] inline-flex h-5 flex-none items-center rounded-[7px] px-[7px] text-[11px] font-semibold leading-none";
const TAG_CLASS: Record<ChangelogTag, string> = {
  new: TONE_CLASS.blue, improve: TONE_CLASS.teal, fix: TONE_CLASS.amber, library: "cl-tag-library", other: TONE_CLASS.gray,
};

/** 一张日志卡(mockup 2):日期、可选版本号、标题、带类型标签的条目;未读的描边加「新」角标;超过 2 条默认折叠。 */
export function EntryCard({ entry, language, defaultExpanded }: { entry: ChangelogEntry; language: string; defaultExpanded: boolean }) {
  const { t } = useTranslation();
  const [toggled, setToggled] = useState<boolean | null>(null);
  const expanded = toggled ?? defaultExpanded;
  const shown = collapsedItems(entry.items, expanded);
  const foldable = entry.items.length > 2;
  const version = versionLabel(entry.version);
  const titleId = `changelog-title-${entry.id}`;
  return (
    <article
      data-testid={`changelog-card-${entry.id}`}
      aria-labelledby={titleId}
      className={cn("relative mt-2 rounded-card border-[0.5px] bg-surface px-3.5 pb-3 pt-3.5", entry.isNew ? "border-blue" : "border-hair")}
    >
      {entry.isNew ? (
        <span data-testid={`changelog-new-${entry.id}`} className="absolute right-3 top-3 rounded-lg bg-red-solid px-[7px] py-px text-[11px] font-bold text-white">
          {t("web.changelog.newBadge")}
        </span>
      ) : null}
      <div className="flex items-center gap-2 text-meta text-ink-3">
        <b className="font-semibold text-ink-2">{formatDay(entry.entryDate, language)}</b>
        {version ? <span>{version}</span> : null}
      </div>
      <h3 id={titleId} className="mt-1 pr-10 text-[17px] font-semibold tracking-[-0.01em] text-ink">
        {pickText(language, entry.titleZh, entry.titleEn)}
      </h3>
      <ul className="mt-2">
        {shown.map((item, i) => (
          <li key={i} className="flex gap-2 py-[3px] text-[14px] leading-[1.55] text-ink">
            <span className={cn(CHIP, TAG_CLASS[item.tag])}>{t(`web.changelog.tag.${item.tag}`)}</span>
            <span className="min-w-0 flex-1">{pickText(language, item.zh, item.en)}</span>
          </li>
        ))}
      </ul>
      {foldable ? (
        <button
          type="button"
          data-testid={`changelog-more-${entry.id}`}
          aria-expanded={expanded}
          onClick={() => setToggled(!expanded)}
          className="mt-1.5 inline-flex min-h-[32px] items-center gap-0.5 rounded-button text-[13px] text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? t("web.changelog.collapse") : t("web.changelog.expandAll", { count: entry.items.length })}
          {expanded ? <ChevronUpIcon aria-hidden className="h-3.5 w-3.5" /> : <ChevronDownIcon aria-hidden className="h-3.5 w-3.5" />}
        </button>
      ) : null}
    </article>
  );
}
