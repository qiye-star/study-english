/** 弹窗顶部日期行:「10月23日 · 周五」/ "Fri · Oct 23"。`localDate` 是服务端给的用户本地日 YYYY-MM-DD,不做时区换算。 */
export function formatGreetingDate(localDate: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) return "";
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const zh = lang.toLowerCase().startsWith("zh");
  try {
    const weekday = new Intl.DateTimeFormat(zh ? "zh-CN" : "en", { weekday: "short" }).format(date);
    if (zh) return `${date.getMonth() + 1}月${date.getDate()}日 · ${weekday}`;
    return `${weekday} · ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date)}`;
  } catch {
    return localDate;
  }
}
