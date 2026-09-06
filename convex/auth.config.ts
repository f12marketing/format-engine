/**
 * Clerk as the identity provider for Convex.
 *
 * CLERK_JWT_ISSUER_DOMAIN is set on the Convex deployment (not in .env.local),
 * because Convex validates the token server-side:
 *
 *   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
 *
 * The value is the Issuer URL from Clerk's JWT template named "convex". Invite
 * only is enforced in Clerk itself plus the `clients` table -- a valid Clerk
 * token with no matching client row gets nothing.
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
