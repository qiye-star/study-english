import type { ReactNode } from "react";
import type { RecorderEnv } from "~/audio/recorder";
import { ShadowSheetProvider } from "./shadow-context";
import { ShadowSheetHost } from "./shadow-host";

/** 测试里套上 Provider + Host(R-S05):`renderWithProviders(<WithShadowSheet>…</WithShadowSheet>)`。必须在 Router 里。 */
export function WithShadowSheet({ children, recorderEnv }: { children: ReactNode; recorderEnv?: RecorderEnv }) {
  return (
    <ShadowSheetProvider>
      {children}
      <ShadowSheetHost recorderEnv={recorderEnv} />
    </ShadowSheetProvider>
  );
}
