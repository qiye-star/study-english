import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { PracticeItemSource } from "../practice-items-api";
import { goPractice, practiceReference } from "../save-practice-item";

/** 入口来源,只用于「收藏」(PracticeItemSource 的子集);评测本身不带 source(R-S03) */
export type ShadowSource = Extract<PracticeItemSource, "chat" | "grammar" | "lookup" | "manual">;

export interface ShadowOpenInput {
  /** 要跟读的句子;给了 list 时以 list[index] 为准 */
  text: string;
  /** 多句入口(句子列表面板)传整张列表,弹窗显示「第 n / m 句」与上一句 / 下一句 */
  list?: string[];
  index?: number;
  source: ShadowSource;
}

export interface ShadowRequest {
  id: number;
  items: string[];
  index: number;
  source: ShadowSource;
}

export interface ShadowSheetApi {
  open(input: ShadowOpenInput): void;
  close(): void;
}

/** 归一化:空白折叠并截到上限;空句丢掉但 index 仍指向同一句;没有可练的内容返回 null。 */
export function normalizeShadowInput(input: ShadowOpenInput): Omit<ShadowRequest, "id"> | null {
  const single = practiceReference(input.text);
  const cleaned = (input.list ?? []).map(practiceReference);
  const wanted = input.index ?? cleaned.indexOf(single);
  const usable = cleaned.flatMap((text, i) => (text ? [{ text, i }] : []));
  if (usable.length === 0) return single ? { items: [single], index: 0, source: input.source } : null;
  const at = usable.findIndex((u) => u.i === wanted);
  return { items: usable.map((u) => u.text), index: at >= 0 ? at : 0, source: input.source };
}

const ApiContext = createContext<ShadowSheetApi | null>(null);
const RequestContext = createContext<ShadowRequest | null>(null);

/**
 * 全局单例弹窗的状态(挂在 layout/app-shell.tsx,包住整个壳)。两个 context:稳定的 {open, close} 给调用方
 * (弹窗开关不会让 ConversationPage 这样的大组件重渲染),request 只给 ShadowSheetHost。
 */
export function ShadowSheetProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ShadowRequest | null>(null);
  const seq = useRef(0);
  const open = useCallback((input: ShadowOpenInput) => {
    const next = normalizeShadowInput(input);
    if (!next) return;
    seq.current += 1;
    setRequest({ id: seq.current, ...next });
  }, []);
  const close = useCallback(() => setRequest(null), []);
  const api = useMemo<ShadowSheetApi>(() => ({ open, close }), [open, close]);
  return (
    <ApiContext.Provider value={api}>
      <RequestContext.Provider value={request}>{children}</RequestContext.Provider>
    </ApiContext.Provider>
  );
}

/**
 * 调用方先关闭自己的面板,再 open(不叠两层弹窗)。返回对象引用稳定。
 * 没有 Provider(没挂壳的页面 / 测试)时回退为旧行为:跳到练习页并预填参考文本。
 */
export function useShadowSheet(): ShadowSheetApi {
  const api = useContext(ApiContext);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const fallback = useMemo<ShadowSheetApi>(
    () => ({ open: (input) => goPractice(navigateRef.current, input.text), close: () => undefined }),
    [],
  );
  return api ?? fallback;
}

/** 弹窗当前是否打开(给 LookupLayer:弹窗打开时收起查词抽屉,R-S21)。没有 Provider 时恒为 false。 */
export function useShadowSheetOpen(): boolean {
  return useContext(RequestContext) !== null;
}

/** 只给 ShadowSheetHost 用 */
export function useShadowHost(): { request: ShadowRequest | null; api: ShadowSheetApi | null } {
  return { request: useContext(RequestContext), api: useContext(ApiContext) };
}
