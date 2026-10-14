import type { ChangelogItem, ChangelogTag } from "./api";
import { S } from "./strings";

const TAG_CLASS: Record<ChangelogTag, string> = {
  new: "bg-accent-soft text-accent",
  improve: "bg-good-soft text-good",
  fix: "bg-warn-soft text-warn",
  library: "bg-violet-100 text-violet-700",
  other: "bg-sunken text-fg-2",
};

export type PreviewLang = "zh" | "en";

/** 与网页端 pickText 同一规则:中文取中文;英文为空回退中文(spec D4)。 */
export const pick = (lang: PreviewLang, zh: string, en: string): string => (lang === "zh" ? zh || en : en || zh);

const versionText = (version: string): string => (/^\d/.test(version) ? `v${version}` : version);

/** 手机端日志卡的只读预览(宽 375,同 mockup 的卡片)。 */
export function EntryPreview({ lang, entryDate, version, titleZh, titleEn, items }: {
  lang: PreviewLang;
  entryDate: string;
  version: string;
  titleZh: string;
  titleEn: string;
  items: ChangelogItem[];
}) {
  const v = version.trim();
  return (
    <div data-testid="changelog-preview" className="w-[375px] max-w-full rounded-2xl border border-line bg-surface p-3.5">
      <p className="text-xs text-muted">
        <b className="font-semibold text-fg-2">{entryDate || "—"}</b>
        {v ? ` · ${versionText(v)}` : ""}
      </p>
      <h3 className="mt-1 text-md font-semibold">{pick(lang, titleZh.trim(), titleEn.trim()) || S.untitled}</h3>
      <ul className="mt-2 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className={`badge flex-none ${TAG_CLASS[item.tag]}`}>{S.tags[item.tag]}</span>
            <span className="min-w-0 flex-1 break-words">{pick(lang, item.zh.trim(), item.en.trim()) || "…"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
