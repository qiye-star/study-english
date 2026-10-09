import type { ReactNode } from "react";
import { EmptyState } from "./states";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  /** 数字列:右对齐、等宽数字 */
  numeric?: boolean;
  className?: string;
}

/** 桌面数据表:表头 11px、行间分割线;数字列右对齐等宽。 */
export function DataTable<T>({
  columns,
  rows,
  empty,
  rowKey,
  onRowClick,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  empty: string;
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  caption?: string;
}) {
  if (rows.length === 0) return <EmptyState message={empty} />;
  const right = (c: Column<T>) => c.align === "right" || c.numeric;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`whitespace-nowrap border-b border-line px-3 py-2 text-2xs font-medium tracking-wide text-fg-2 ${right(c) ? "text-right" : "text-left"}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={onRowClick ? "cursor-pointer hover:bg-sunken" : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={`border-b border-line px-3 py-2.5 align-middle ${right(c) ? "text-right" : ""} ${c.numeric ? "num" : ""} ${c.className ?? ""}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
