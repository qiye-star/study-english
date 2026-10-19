/**
 * 批量邀请码的 CSV(X21):在浏览器里由 Blob 生成,服务端从不导出码。
 * 列为 code,label,expires_at。前导 BOM 让 Excel 按 UTF-8 读中文标签。
 * 以 = + - @ 制表符 回车开头的单元格加前导单引号,防止表格软件把它当公式执行(标签可由管理员填写)。
 */
export interface InviteCsvRow {
  code: string;
  label: string;
  expiresAt: string | null;
}

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function buildInviteCsv(rows: InviteCsvRow[]): string {
  const lines = ["code,label,expires_at", ...rows.map((r) => [r.code, r.label, r.expiresAt ?? ""].map(cell).join(","))];
  return `\uFEFF${lines.join("\n")}\n`;
}

/** 触发一次浏览器下载;Blob URL 用完即释放,不写入存储,也不进任何 URL 参数。 */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
