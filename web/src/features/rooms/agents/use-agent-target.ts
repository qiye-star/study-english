import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomState } from "../room-state";
import type { RoomAgent, RoomAgentsInfo } from "./room-agents-api";
import { loadTarget, nextTarget, saveTarget, type TargetState } from "./target";

export interface AgentTarget {
  /** 开着且房间里有可对准的角色 */
  on: boolean;
  /** 实际对准的角色(选中的不在名单里时回落到默认,R-AW6);名单为空时 null */
  personaId: string | null;
  agent: RoomAgent | null;
  toggle(personaId: string): void;
}

/**
 * 「对象」开关(spec addressing §3.2 第 2 条,D2,R-AW4):按「用户 + 房间」记在本机;带练开始自动打开,结束(完成 / 停止 /
 * 房间关闭)自动关闭;没有计时器、没有空闲关闭。取不到本机存储时从「关」开始,本次打开仍有效(只是不记住,R-AW15)。
 */
export function useAgentTarget(p: { roomId: string; userId: number | null; agents: readonly RoomAgent[]; state: RoomState; ended: boolean; info: RoomAgentsInfo | null }): AgentTarget {
  const { roomId, userId, agents, state, ended, info } = p;
  const [s, setS] = useState<TargetState>(() => loadTarget(userId, roomId));
  const restored = useRef(s.auto !== null);
  const seq = Math.max(state.lastSeq, state.liveFrom);
  useEffect(() => {
    setS((cur) => nextTarget(cur, { tutor: state.tutor, messages: state.messages, seq, closed: ended }));
  }, [state.tutor, state.messages, seq, ended]);
  // 上次离开时带练还开着:第一次读到的 REST 名单说已经没有带练、本页也没收到带练帧 → 关闭(结束消息可能不在补发页里)
  useEffect(() => {
    if (!restored.current || !info) return;
    restored.current = false;
    if (info.tutor === null && state.tutor === null) setS((cur) => (cur.auto ? { ...cur, on: false, auto: null, ended: null } : cur));
  }, [info, state.tutor]);
  useEffect(() => { saveTarget(userId, roomId, s); }, [userId, roomId, s]);
  const agent = agents.find((a) => a.id === s.personaId) ?? agents[0] ?? null;
  const effective = agent?.id ?? null;
  const toggle = useCallback((personaId: string) => {
    setS((cur) => (cur.on && effective === personaId ? { ...cur, on: false, personaId } : { ...cur, on: true, personaId }));
  }, [effective]);
  return { on: s.on && agent !== null, personaId: effective, agent, toggle };
}
