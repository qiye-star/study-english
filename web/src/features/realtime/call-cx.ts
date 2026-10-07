/**
 * 只拼接、不合并的 className 工具。`cn`(tailwind-merge)不认识设计令牌里的 `text-label` / `text-ink-2`
 * 这类自定义名字,会把字号和颜色当成同一组互相覆盖;通话界面的样式全用它拼。
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
