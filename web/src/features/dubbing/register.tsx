// 只被 web/src/plugins/ 导入(architecture.test.ts):练习首页的「影视配音」入口卡(计划 L5 R16)。
// 核心贡献:无联动键,永远登记;卡片本身在配置关闭时渲染 null。入口组件在懒加载块里。
import { lazy, Suspense } from "react";
import { contribute } from "~/lib/extension-points";

const Entry = lazy(async () => ({ default: (await import("./entry-card")).DubbingEntryCard }));

function DubbingEntrySlot() {
  return (
    <Suspense fallback={null}>
      <Entry />
    </Suspense>
  );
}

contribute({ point: "practiceHome", id: "dubbing.entry", order: 10, component: DubbingEntrySlot });
