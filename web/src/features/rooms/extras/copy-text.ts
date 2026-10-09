/**
 * 复制文本:非 HTTPS(局域网部署)没有 navigator.clipboard,退回 execCommand;都不行时返回 false,由调用方提示手动复制。
 * 与 room-page.tsx 里的 copyText 同一实现(room-page 已冻结,不从它导出;spec §16 extras/copy-text.ts)。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 退回下面的办法 */
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
