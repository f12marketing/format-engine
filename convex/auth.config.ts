/**
 * Clerk as the identity provider for Convex.
 *
 * CLERK_JWT_ISSUER_DOMAIN is set on the deployment, not in .env.local, because
 * Convex validates the token server-side:
 *
 *   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
 *
 * The value is the Issuer URL from Clerk's JWT template named "convex".
 *
 * Declaring a provider with an undefined domain is a hard deployment failure,
 * so an unconfigured deployment exports no providers instead. That keeps a
 * local dev backend usable before Clerk exists -- which is the whole point of
 * being able to run one anonymously -- and the moment the variable is set,
 * real auth turns on with no code change.
 */
const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;

export default {
  providers: issuer ? [{ domain: issuer, applicationID: "convex" }] : [],
};
