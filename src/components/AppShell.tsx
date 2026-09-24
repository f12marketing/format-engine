"use client";

import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Sidebar } from "@/components/Sidebar";
import { convexConfigured } from "@/app/ConvexClientProvider";

/**
 * Auth screens are full-page and deliberately chrome-less -- showing a nav
 * to someone who can't use any of it is noise. Everything else renders
 * inside the shell.
 */
const BARE_ROUTES = ["/sign-in", "/reset-password", "/auth", "/onboarding"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (BARE_ROUTES.some((p) => pathname.startsWith(p))) return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      {convexConfigured && <OnboardingGate />}
      <Sidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Sends a newly admitted client to the business quiz, once. "Once" is the
 * brand row's say: finishing or skipping the quiz sets a flag there, and
 * after that this never fires again -- the quiz is reachable from the
 * Business page instead.
 */
function OnboardingGate() {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const needs = useQuery(api.brands.needsOnboarding, isAuthenticated ? {} : "skip");
  useEffect(() => {
    if (needs) router.replace("/onboarding");
  }, [needs, router]);
  return null;
}
