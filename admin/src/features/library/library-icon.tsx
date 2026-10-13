import type { SVGProps } from "react";

/** 导航「跟读库」:带播放三角的胶片框(与 components/icons 同为 1.75 描边、24 视框)。 */
export const LibraryIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M7 5v14M17 5v14" />
    <path d="M10.5 9.5v5l4-2.5z" />
  </svg>
);
