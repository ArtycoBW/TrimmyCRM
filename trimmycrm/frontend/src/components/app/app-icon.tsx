import type { SVGProps } from "react";

export type AppIconName =
  | "home"
  | "calendar"
  | "booking"
  | "clients"
  | "services"
  | "staff"
  | "site"
  | "analytics"
  | "settings"
  | "feedback"
  | "guide"
  | "admin"
  | "menu"
  | "bell"
  | "arrow";

const paths: Record<AppIconName, React.ReactNode> = {
  home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></>,
  booking: <><path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h3" /><path d="m15 17 1.5 1.5L20 15" /></>,
  clients: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-1.5A4.5 4.5 0 0 1 8 14h2a4.5 4.5 0 0 1 4.5 4.5V20M16 5a3 3 0 0 1 0 6M17 14a4 4 0 0 1 3.5 4v2" /></>,
  services: <><circle cx="6" cy="7" r="3" /><circle cx="6" cy="17" r="3" /><path d="m8.5 8.5 10 8M8.5 15.5l10-8" /></>,
  staff: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /><path d="m17 4 1-2M7 4 6 2" /></>,
  site: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01M7 13h4v4H7M14 13h3M14 16h3" /></>,
  analytics: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  guide: <><path d="M5 4.5A3.5 3.5 0 0 1 8.5 3H20v17H8.5A3.5 3.5 0 0 0 5 23.5Z" /><path d="M5 4.5v19M8.5 20H20M9 8h7M9 12h7" /></>,
  feedback: <><path d="M20 15a4 4 0 0 1-4 4H8l-4 3v-7a4 4 0 0 1-2-3.5v-5A4.5 4.5 0 0 1 6.5 2h9A4.5 4.5 0 0 1 20 6.5Z" /><path d="M7 9h.01M11 9h.01M15 9h.01" /></>,
  admin: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h3M15 15h1" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  arrow: <path d="M5 12h14M14 7l5 5-5 5" />,
};

export function AppIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: AppIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
