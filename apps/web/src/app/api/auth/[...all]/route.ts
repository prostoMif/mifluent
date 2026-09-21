/**
 * Better Auth's own endpoints: sign-in, sign-up, sign-out, password reset,
 * session lookup.
 *
 * Handing the whole `/api/auth/*` subtree to the library is intentional. Every
 * route added here by hand is a route that has to get cookie flags, CSRF and
 * rate limiting right on its own.
 */

import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(getAuth());
