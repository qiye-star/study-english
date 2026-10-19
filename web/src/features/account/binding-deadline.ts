/** 截止时间按当前界面语言显示;缺省或无法解析时返回 null,文案里就不带时间。 */
export function formatDeadline(iso: string | null | undefined, language: string): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString(language, { dateStyle: "medium", timeStyle: "short" });
}
