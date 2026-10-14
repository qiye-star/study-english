import type { SVGProps } from "react";

/** 导航「更新日志」:星花(与网页端入口同一个意象;1.75 描边、24 视框,同 components/icons)。 */
export const ChangelogIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    <path d="M18.5 15v4M16.5 17h4" />
    <path d="M5.5 15.5v3M4 17h3" />
  </svg>
);
