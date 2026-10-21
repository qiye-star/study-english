import { lazy } from "react";

/**
 * 懒加载的配音页面(计划 L5 R17):页面、文案与 library 工具包只在打开 /dub 时才进入。
 * 这个文件在主包里,只含 lazy() 包装与动态导入。
 */
export const DubHomeRoute = lazy(async () => {
  const [{ loadDubbingRuntime }, { DubKitProvider }, { DubHomePage }] = await Promise.all([
    import("./loader"),
    import("./kit-context"),
    import("./dub-home-page"),
  ]);
  const kit = await loadDubbingRuntime();
  function DubHomeWithKit() {
    return (
      <DubKitProvider kit={kit}>
        <DubHomePage />
      </DubKitProvider>
    );
  }
  return { default: DubHomeWithKit };
});

export const DubItemRoute = lazy(async () => {
  const [{ loadDubbingRuntime }, { DubKitProvider }, { DubItemPage }] = await Promise.all([
    import("./loader"),
    import("./kit-context"),
    import("./dub-item-page"),
  ]);
  const kit = await loadDubbingRuntime();
  function DubItemWithKit() {
    return (
      <DubKitProvider kit={kit}>
        <DubItemPage />
      </DubKitProvider>
    );
  }
  return { default: DubItemWithKit };
});
