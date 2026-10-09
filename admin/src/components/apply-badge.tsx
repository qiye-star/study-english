import { S } from "../strings";

export type Apply = "hot" | "new_sessions" | "restart";

/** 生效方式徽标:即时 = 绿(已生效语义)、新会话 = 中性、需重启/待重启 = 琥珀。 */
export function ApplyBadge({ apply, pending = false }: { apply: Apply; pending?: boolean }) {
  if (pending) return <span className="badge bg-warn-soft text-warn">{S.apply.pending}</span>;
  const tone =
    apply === "hot" ? "bg-good-soft text-good" : apply === "restart" ? "bg-warn-soft text-warn" : "bg-sunken text-fg-2 ring-1 ring-inset ring-line";
  return <span className={`badge ${tone}`}>{S.apply[apply]}</span>;
}
