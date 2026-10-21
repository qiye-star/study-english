import { createContext, type ReactNode, useContext } from "react";
import type { DubbingKit } from "~/features/library";

/** 懒加载的 library 工具包经 React context 交给配音的各个组件(计划 L5 R17)。 */
const KitContext = createContext<DubbingKit | null>(null);

export function DubKitProvider({ kit, children }: { kit: DubbingKit; children: ReactNode }) {
  return <KitContext.Provider value={kit}>{children}</KitContext.Provider>;
}

export function useDubKit(): DubbingKit {
  const kit = useContext(KitContext);
  if (!kit) throw new Error("useDubKit is used outside DubKitProvider");
  return kit;
}
