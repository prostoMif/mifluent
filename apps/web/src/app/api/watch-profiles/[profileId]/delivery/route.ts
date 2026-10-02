/**
 * When, where and in which language a profile's brief is sent.
 *
 * // TODO: security review — authorisation
 */

import { AppError, isUuid, parseOrThrow } from "@mifluent/core";
import { deliverySettingsSchema, updateDeliverySettings } from "@mifluent/domain";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ readonly profileId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "watch_profiles.delivery_updated" }, async () => {
    assertSameOrigin(request);
    const session = await requireSessionWith("profile:write");
    const { profileId } = await context.params;
    if (!isUuid(profileId)) throw new AppError("not_found", "Not found.");

    const settings = parseOrThrow(deliverySettingsSchema, await readJsonBody(request));
    await updateDeliverySettings(getDatabase(), session.tenantId, profileId, settings);
    return settings;
  });
}
