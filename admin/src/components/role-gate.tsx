import type { ReactNode } from "react";
import { hasRole, useAdminSession, type Role } from "../api/session";

/** 按最低角色显示内容(只是界面隐藏;服务端每个端点另有角色校验)。 */
export function RoleGate({ min, children, fallback = null }: { min: Role; children: ReactNode; fallback?: ReactNode }) {
  const session = useAdminSession();
  return <>{hasRole(session, min) ? children : fallback}</>;
}
