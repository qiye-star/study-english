import type { ReactNode } from "react";
import type { RecorderEnv } from "~/audio/recorder";
import { ShadowSheetProvider } from "./shadow-context";
import { ShadowSheetHost } from "./shadow-host";

// 预热懒加载块:第一次打开的冷编译在并行跑测试时可能超过 findBy 的 1 s 默认超时(只在测试里)
void import("./shadow-sheet");

/** 测试里套上 Provider + Host(R-S05):`renderWithProviders(<WithShadowSheet>…</WithShadowSheet>)`。必须在 Router 里。 */
export function WithShadowSheet({ children, recorderEnv }: { children: ReactNode; recorderEnv?: RecorderEnv }) {
  return (
    <ShadowSheetProvider>
      {children}
      <ShadowSheetHost recorderEnv={recorderEnv} />
    </ShadowSheetProvider>
  );
}
