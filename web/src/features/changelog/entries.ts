import { TAGS, type ChangelogEntry, type ChangelogTag } from "./api";

/** 日志页的纯函数:月份分组、类型筛选、折叠、日期格式。 */
export type TagFilter = ChangelogTag | "all";
export const COLLAPSED_ITEMS = 2;

export interface MonthGroup { key: string; entries: ChangelogEntry[] }

/** 相邻且同月的条目归一组(列表已按日期倒序;顺序不乱就不会出现重复的月份标题)。 */
export function groupByMonth(entries: ChangelogEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const entry of entries) {
    const key = entry.entryDate.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, entries: [entry] });
  }
  return groups;
}

export function presentTags(entries: ChangelogEntry[]): ChangelogTag[] {
  const found = new Set(entries.flatMap((e) => e.items.map((i) => i.tag)));
  return TAGS.filter((tag) => found.has(tag));
}

/** 只留匹配类型的条目,没有匹配条目的卡片整张去掉;"all" 原样返回。 */
export function filterByTag(entries: ChangelogEntry[], tag: TagFilter): ChangelogEntry[] {
  if (tag === "all") return entries;
  return entries.flatMap((entry) => {
    const items = entry.items.filter((i) => i.tag === tag);
    return items.length ? [{ ...entry, items }] : [];
  });
}

export function collapsedItems<T>(items: T[], expanded: boolean, limit = COLLAPSED_ITEMS): T[] {
  return expanded || items.length <= limit ? items : items.slice(0, limit);
}

function localDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; // 本地日期,不经 UTC,不受时区影响
}

export function formatMonth(key: string, language: string): string {
  const date = localDate(`${key}-01`);
  if (!date) return key;
  try {
    return date.toLocaleDateString(language, { year: "numeric", month: "long" });
  } catch {
    return key;
  }
}

export function formatDay(entryDate: string, language: string): string {
  const date = localDate(entryDate);
  if (!date) return entryDate;
  try {
    return date.toLocaleDateString(language, { month: "long", day: "numeric" });
  } catch {
    return entryDate;
  }
}

/** 版本号显示:数字开头补 "v"(1.12 → v1.12),其余原样;空 = 不显示。 */
export function versionLabel(version: string | null): string | null {
  const v = version?.trim();
  if (!v) return null;
  return /^\d/.test(v) ? `v${v}` : v;
}
