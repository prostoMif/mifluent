/**
 * Instance settings: the name of the business and the zone its mornings are in.
 *
 * // TODO: security review — authorisation
 */

import { parseOrThrow } from "@mifluent/core";
import { tenantSettingsSchema, updateTenantSettings } from "@mifluent/domain";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

export async function PATCH(request: Request): Promise<Response> {
  return route({ event: "settings.updated" }, async () => {
    assertSameOrigin(request);

    // Permission first, body second. Parsing an unauthorised request's payload
    // is work done for somebody who is not allowed to ask for it.
    const session = await requireSessionWith("instance:manage");
    const settings = parseOrThrow(tenantSettingsSchema, await readJsonBody(request));

    await updateTenantSettings(getDatabase(), session.tenantId, settings);

    return settings;
  });
}
