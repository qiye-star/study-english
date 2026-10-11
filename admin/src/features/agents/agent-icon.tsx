import type { SVGProps } from "react";

/** 导航「智能体」:带对话气泡的机器人头像(与 components/icons 同为 1.75 描边、24 视框)。 */
export const AgentIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <rect x="4" y="7" width="16" height="11" rx="3" />
    <path d="M12 7V4" />
    <circle cx="12" cy="3.5" r="0.5" />
    <path d="M9 12h.01M15 12h.01" />
    <path d="M9.5 15h5" />
  </svg>
);
