import "./locales";
import { useEffect, useState } from "react";
import { PersonaChip } from "./persona-chip";
import { PersonaPicker } from "./persona-picker";
import type { Persona } from "./types";
import { useAgentsConfig, usePersonas } from "./use-agents-data";

export interface ChatPersonaControlProps {
  personaId: string | null;
  disabled: boolean;
  /** 选了不同的角色(null = 不使用角色) */
  onChange(persona: Persona | null): void;
  /** 解析出的当前角色(助手头像用) */
  onResolved?(persona: Persona | null): void;
}

/** 对话顶栏的角色控件(懒加载块):智能体关闭时什么都不渲染,旧会话因此完全不变。 */
export function ChatPersonaControl({ personaId, disabled, onChange, onResolved }: ChatPersonaControlProps) {
  const { config } = useAgentsConfig();
  const enabled = !!config?.enabled;
  const { personas } = usePersonas(enabled);
  const [open, setOpen] = useState(false);
  const persona = personaId ? personas?.find((p) => p.id === personaId) ?? null : null;
  useEffect(() => {
    onResolved?.(persona);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona?.id, persona?.name]);
  if (!enabled) return null;
  return (
    <>
      <PersonaChip persona={persona} pendingId={personaId} disabled={disabled} onClick={() => setOpen(true)} />
      <PersonaPicker open={open} onOpenChange={setOpen} selectedId={personaId} allowNone
        onSelect={(p) => {
          setOpen(false);
          if ((p?.id ?? null) !== personaId) onChange(p);
        }} />
    </>
  );
}
