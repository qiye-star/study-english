import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

/** 概览:三根高低不一的音量柱 */
export const PulseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 14v-4M9 19V5M14 16V8M19 13v-2" />
  </Icon>
);
export const UsersIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
    <path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.8c2 .6 3.1 2.3 3.5 5.2" />
  </Icon>
);
export const MicIcon = (p: P) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Icon>
);
export const BackIcon = (p: P) => (
  <Icon {...p}>
    <path d="m15 5-7 7 7 7" />
  </Icon>
);
export const SearchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </Icon>
);
export const LogoutIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9" />
    <path d="M15 8l4 4-4 4M19 12H9" />
  </Icon>
);
export const PlayIcon = (p: P) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8A.8.8 0 0 0 8 5.2Z" />
  </Icon>
);
export const PauseIcon = (p: P) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
  </Icon>
);
export const ChevronIcon = (p: P) => (
  <Icon {...p}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
);
export const ChevronDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="m5 9 7 7 7-7" />
  </Icon>
);
export const SpinnerIcon = (p: P) => (
  <Icon {...p} className={`animate-spin ${p.className ?? ""}`}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Icon>
);
export const AlertIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </Icon>
);
export const ChatIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4V5.5Z" />
  </Icon>
);
export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
export const BookIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4V5.5Z" />
    <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7V5.5Z" />
  </Icon>
);
