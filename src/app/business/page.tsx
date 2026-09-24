"use client";

import { AuthorisedBoundary } from "@/components/AuthorisedBoundary";
import { BusinessProfile } from "@/components/business/BusinessProfile";
import { convexConfigured } from "@/app/ConvexClientProvider";

/** The business profile, editable any time after the quiz. */
export default function BusinessPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      {convexConfigured ? (
        <AuthorisedBoundary>
          <BusinessProfile />
        </AuthorisedBoundary>
      ) : (
        <p className="text-sm text-muted">Connect Convex to set up a business profile.</p>
      )}
    </main>
  );
}
