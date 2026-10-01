import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { eventItems, events } from "./events.js";
import { chunks, rawItems } from "./items.js";

/**
 * What happens to a row when the raw item it points at is pruned. Read from
 * the schema itself, so a later change to a foreign key cannot quietly turn
 * "keep the history" back into "delete the history".
 */
function onDeleteOfRawItem(table: PgTable): string | undefined {
  const config = getTableConfig(table);
  const reference = config.foreignKeys.find(
    (key) => getTableConfig(key.reference().foreignTable).name === getTableConfig(rawItems).name,
  );
  return reference?.onDelete;
}

describe("retention of history when raw material is pruned", () => {
  it("keeps the event and clears its link to the raw item", () => {
    expect(onDeleteOfRawItem(events)).toBe("set null");
  });

  it("keeps the event's item list and clears the link to the raw item", () => {
    expect(onDeleteOfRawItem(eventItems)).toBe("set null");
  });

  it("deletes the chunks, which are only the raw text cut into pieces", () => {
    expect(onDeleteOfRawItem(chunks)).toBe("cascade");
  });

  it("lets an event exist without a raw item", () => {
    const column = getTableConfig(events).columns.find((c) => c.name === "raw_item_id");

    expect(column?.notNull).toBe(false);
  });
});
