// 日期标签(FR9)。日子都是 "YYYY-MM-DD" 字符串(用户本地日);星期 / 月份只靠日历算,不经时区换算。

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 某个时刻在设备本地时区的日历日。解析失败返回 null。 */
export function localDayOf(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function utcOf(day: string): Date | null {
  const m = DAY.exec(day);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

const dayNumber = (day: string): number | null => {
  const d = utcOf(day);
  return d ? Math.round(d.getTime() / 86_400_000) : null;
};

const weekday = (d: Date, lang: string) => new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" }).format(d);
const isZh = (lang: string) => lang.toLowerCase().startsWith("zh");

/** `today` = 同日 / `yesterday` = 前一日 / `date` = 其余。 */
export function dayRelation(day: string, today: string): "today" | "yesterday" | "date" {
  const a = dayNumber(day);
  const b = dayNumber(today);
  if (a === null || b === null) return "date";
  return a === b ? "today" : a === b - 1 ? "yesterday" : "date";
}

/** 分组标题:今天 / 昨天 / `2026-10-21 周三`(zh)/ `Wed 2026-10-21`(en)。 */
export function dateLabel(day: string, today: string, lang: string): string {
  const rel = dayRelation(day, today);
  const zh = isZh(lang);
  if (rel === "today") return zh ? "今天" : "Today";
  if (rel === "yesterday") return zh ? "昨天" : "Yesterday";
  const d = utcOf(day);
  if (!d) return day;
  return zh ? `${day} ${weekday(d, lang)}` : `${weekday(d, lang)} ${day}`;
}

/** 默认对话行标题里的日期部分(`dailyDate` 原样使用):`10月21日 周三` / `Oct 21 Wed`。 */
export function dailyDateText(dailyDate: string, lang: string): string {
  const d = utcOf(dailyDate);
  if (!d) return dailyDate;
  if (isZh(lang)) return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${weekday(d, lang)}`;
  return `${new Intl.DateTimeFormat(lang, { month: "short", timeZone: "UTC" }).format(d)} ${d.getUTCDate()} ${weekday(d, lang)}`;
}

export interface DayGroup<T> { day: string; items: T[] }

/** 按最近活动日(`updatedAt` 的本地日)分组,保持传入顺序(服务端 `updated_at desc`);无法解析的行归入 today。 */
export function groupByActivityDay<T extends { updatedAt: string }>(rows: T[], today: string): Array<DayGroup<T>> {
  const groups: Array<DayGroup<T>> = [];
  for (const row of rows) {
    const day = localDayOf(row.updatedAt) ?? today;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(row);
    else {
      const existing = groups.find((g) => g.day === day);
      if (existing) existing.items.push(row);
      else groups.push({ day, items: [row] });
    }
  }
  return groups;
}
