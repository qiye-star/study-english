import { S as Shell } from "../../strings";
import { Placeholder } from "../../components/placeholder";
import { S } from "./strings";

/* 占位页:lane community (D5) 实现后替换本文件(保持 index.ts 的导出名不变)。 */

export function InvitesPage() {
  return <Placeholder title={S.invitesPage} />;
}

/** 用户详情页的页签内容;userId 为 8 位用户 ID。 */
export function UserAdminPanel({ userId }: { userId: string }) {
  return (
    <div className="panel px-6 py-10 text-center text-sm text-fg-2" data-user-id={userId} aria-label={S.userAdminPanel}>
      {Shell.shell.placeholder}
    </div>
  );
}
