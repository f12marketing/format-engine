"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthStatus } from "@/components/AuthStatus";
import { authConfigured } from "@/app/ConvexClientProvider";

/**
 * The app shell's left nav.
 *
 * Only destinations that exist get a row -- the reference design's other
 * entries (Brand, Automations, ...) are features this app doesn't have, and a
 * nav full of dead links reads as broken rather than as a roadmap. Collapses
 * to icons under `md` instead of hiding behind a drawer, so there's no
 * open/closed state to own.
 */
const NAV = [
  { href: "/", label: "Content", icon: ClapperIcon },
  { href: "/influencers", label: "Influencers", icon: PersonIcon },
  { href: "/library", label: "Library", icon: LibraryIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/analytics", label: "Analytics", icon: ChartIcon },
  { href: "/history", label: "Jobs", icon: ListIcon },
  { href: "/projects", label: "Projects", icon: FolderIcon },
  { href: "/connections", label: "Connections", icon: PlugIcon },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-line bg-surface md:w-60">
      <div className="flex items-center gap-2.5 px-3 py-4 md:px-4">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-sm font-semibold text-white">
          F
        </span>
        <span className="hidden truncate text-sm font-semibold tracking-tight md:block">
          Format Engine
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 md:px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          // "/" would otherwise match every route.
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={[
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition",
                active
                  ? "bg-surface-sub font-medium text-foreground"
                  : "text-muted hover:bg-surface-sub hover:text-foreground",
              ].join(" ")}
            >
              <Icon className={active ? "text-accent" : ""} />
              <span className="hidden truncate md:block">{label}</span>
            </Link>
          );
        })}
      </nav>

      {authConfigured && (
        <div className="hidden border-t border-line px-4 py-3 md:block">
          <AuthStatus />
        </div>
      )}
    </aside>
  );
}

function iconProps(className?: string) {
  return {
    className: `size-[18px] shrink-0 ${className ?? ""}`,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function ClapperIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
      <path d="m3.5 9 1.2-3.6 16 1.2L19.5 9" />
      <path d="m9 5.6-1 3.2M14.5 6l-1 3" />
    </svg>
  );
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="12" cy="10" r="2.6" />
      <path d="M7 18a5 5 0 0 1 10 0" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m3.5 15.5 4.2-4.2a2 2 0 0 1 2.8 0l3 3" />
      <path d="m14.5 13 1.6-1.6a2 2 0 0 1 2.8 0l1.6 1.6" />
      <circle cx="9" cy="8.75" r="1.25" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

function PlugIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M9 3v6M15 3v6" />
      <path d="M6 9h12v3a6 6 0 0 1-12 0V9Z" />
      <path d="M12 18v3" />
    </svg>
  );
}
