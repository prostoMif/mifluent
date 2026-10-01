import { getConfig } from "@mifluent/core";

/**
 * Set the cookie (when the code is well-formed) and send the visitor on.
 * HttpOnly and lax: only the sign-up hook on our own site reads it.
 */
export function rememberAndRedirect(input: {
  readonly cookieName: string;
  readonly code: string | undefined;
  readonly maxAgeSeconds: number;
  readonly location: string;
}): Response {
  const headers = new Headers({ Location: input.location, "Cache-Control": "no-store" });
  if (input.code !== undefined) {
    const secure = getConfig().isProduction ? "; Secure" : "";
    headers.append(
      "Set-Cookie",
      `${input.cookieName}=${input.code}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${input.maxAgeSeconds}${secure}`,
    );
  }
  return new Response(null, { status: 302, headers });
}
