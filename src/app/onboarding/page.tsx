"use client";

import { AuthorisedBoundary } from "@/components/AuthorisedBoundary";
import { OnboardingQuiz } from "@/components/business/OnboardingQuiz";
import { convexConfigured } from "@/app/ConvexClientProvider";

/** The business quiz. A new client lands here once, from AppShell's gate. */
export default function OnboardingPage() {
  if (!convexConfigured) {
    return <p className="p-10 text-sm text-muted">Connect Convex to set up a business profile.</p>;
  }
  return (
    <AuthorisedBoundary>
      <OnboardingQuiz />
    </AuthorisedBoundary>
  );
}
