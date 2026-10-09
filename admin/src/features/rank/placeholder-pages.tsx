import { S as Shell } from "../../strings";
import { Placeholder } from "../../components/placeholder";
import { S } from "./strings";

/* 占位页:lane rank (C6/C7) 实现后替换本文件(保持 index.ts 的导出名不变)。 */

export function RankPage() {
  return <Placeholder title={S.rankPage} />;
}

export function RankRulesPage() {
  return <Placeholder title={S.rankRulesPage} />;
}

export function MatchPage() {
  return <Placeholder title={S.matchPage} />;
}

/** 用户详情页的页签内容;userId 为 8 位用户 ID。 */
export function UserRankPanel({ userId }: { userId: string }) {
  return (
    <div className="panel px-6 py-10 text-center text-sm text-fg-2" data-user-id={userId} aria-label={S.userRankPanel}>
      {Shell.shell.placeholder}
    </div>
  );
}
