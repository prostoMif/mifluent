/**
 * The browser half of authentication.
 *
 * Forms talk to `/api/auth/*` through this rather than posting to a server
 * action. That route is Better Auth's own, and it already gets the cookie
 * flags, the origin check and the per-endpoint rate limits right — a hand-
 * written action would have to repeat all three and would eventually get one
 * of them wrong.
 *
 * No base URL is configured: the client posts to the same origin the page came
 * from, which is what a self-hosted instance behind any hostname needs.
 */

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
