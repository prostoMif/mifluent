/**
 * Binding a profile's digests to a Telegram chat, and unbinding.
 *
 * POST returns a one-time code to send to the bot; DELETE forgets the chat.
 *
 * // TODO: security review — authorisation
 */

import { AppError, isUuid } from "@mifluent/core";
import { createBindingCode, unbindTelegram } from "@mifluent/delivery";
import { route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ readonly profileId: string }>;
}

async function readProfileId(context: RouteContext): Promise<string> {
  const { profileId } = await context.params;
  if (!isUuid(profileId)) {
    throw new AppError("not_found", "Not found.");
  }
  return profileId;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "telegram.binding_created", status: 201 }, async () => {
    assertSameOrigin(request);
    const session = await requireSessionWith("profile:write");

    return createBindingCode(getDatabase(), session.tenantId, await readProfileId(context));
  });
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "telegram.unbound" }, async () => {
    assertSameOrigin(request);
    const session = await requireSessionWith("profile:write");

    await unbindTelegram(getDatabase(), session.tenantId, await readProfileId(context));
    return { isBound: false };
  });
}
