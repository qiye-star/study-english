// 只被 web/src/plugins/ 导入(architecture.test.ts):练习页顶栏的「更新日志」入口(计划 2026-10-14-changelog R-2、R-3)。
// 核心贡献:无联动键,永远可见。入口组件(图标、红点、提示、文案、样式)在懒加载块里,主包只有这个文件。
import { lazy, Suspense } from "react";
import { contribute } from "~/lib/extension-points";

const Entry = lazy(async () => ({ default: (await import("./changelog-entry")).ChangelogEntry }));

function ChangelogEntrySlot() {
  return (
    <Suspense fallback={null}>
      <Entry />
    </Suspense>
  );
}

contribute({ point: "practiceHeaderActions", id: "changelog.entry", order: 0, component: ChangelogEntrySlot });
