/**
 * Supabase Auth as the identity provider for Convex.
 *
 * Two Convex-side env vars, set once on the deployment (not in .env.local --
 * Convex validates the token server-side):
 *
 *   npx convex env set SUPABASE_JWT_ISSUER https://<project-ref>.supabase.co/auth/v1
 *   npx convex env set SUPABASE_JWKS_URL   https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
 *
 * `customJwt` rather than the simpler `{ domain, applicationID }` shape: that
 * shape makes Convex fetch OIDC discovery itself, which works here too, but
 * being explicit about issuer/jwks/algorithm means a Supabase project that
 * later disables its JWKS discovery doc doesn't silently break auth.
 *
 * ES256 only works because this project has asymmetric JWT signing keys
 * enabled (Supabase Dashboard -> Auth -> JWT Keys). A project still on the
 * legacy shared HS256 secret cannot use this: Convex's customJwt provider
 * only verifies RS256 and ES256. Verified against this project's own
 * /.well-known/jwks.json before writing this file -- it returned one ES256
 * P-256 key.
 *
 * applicationID: "authenticated" matches Supabase's standard `aud` claim for
 * a signed-in user. Omitting it would accept a JWT meant for a different
 * audience entirely, which the type's own doc comment calls out as insecure.
 *
 * Declaring the provider with an undefined issuer is a hard deployment
 * failure, so this exports no providers until both variables are set --
 * which is what lets a local anonymous backend come up before Supabase is
 * wired in at all.
 */
const issuer = process.env.SUPABASE_JWT_ISSUER;
const jwks = process.env.SUPABASE_JWKS_URL;

export default {
  providers:
    issuer && jwks
      ? [
          {
            type: "customJwt" as const,
            issuer,
            jwks,
            algorithm: "ES256" as const,
            applicationID: "authenticated",
          },
        ]
      : [],
};
