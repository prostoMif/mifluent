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

// Built on the first request, not at import: `next build` imports every route
// to collect page data, and the Docker build stage has no configuration — the
// `.env` only arrives when the container starts.
export function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}
