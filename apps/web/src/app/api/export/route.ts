/**
 * Download everything this business has here, as JSON.
 *
 * // TODO: security review — authorisation
 */

import { exportTenantData } from "@mifluent/domain";
import { route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

export async function GET(): Promise<Response> {
  return route({ event: "tenant.exported" }, async () => {
    const session = await requireSessionWith("instance:manage");
    const data = await exportTenantData(getDatabase(), session.tenantId);
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="mifluent-export-${data.exportedAt.slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
