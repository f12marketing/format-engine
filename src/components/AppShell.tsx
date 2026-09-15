"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

/**
 * Auth screens are full-page and deliberately chrome-less -- showing a nav
 * to someone who can't use any of it is noise. Everything else renders
 * inside the shell.
 */
const BARE_ROUTES = ["/sign-in", "/reset-password", "/auth"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (BARE_ROUTES.some((p) => pathname.startsWith(p))) return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
