/**
 * The database half of the registration rule.
 *
 * The decision itself is in `registration-rules.ts`, without a database in
 * sight. This file only answers the one question that needs one.
 */

import { getConfig } from "@mifluent/core";
import { type Queryable, schema } from "@mifluent/db";

/**
 * Has anybody signed up yet?
 *
 * Deliberately asks about accounts rather than about owners. An account that
 * exists without a membership is a bug, but if that bug ever happens the safe
 * reading is "this instance is taken", not "the throne is free".
 */
export async function hasAnyAccount(db: Queryable): Promise<boolean> {
  const rows = await db.select({ id: schema.user.id }).from(schema.user).limit(1);
  return rows.length > 0;
}

/**
 * Whether a new person may sign up here: on an instance nobody has claimed
 * yet, or where the owner opened registration. The same rule for the
 * password form, magic links and the Telegram bot.
 */
export async function isRegistrationOpenFor(db: Queryable): Promise<boolean> {
  return getConfig().REGISTRATION_OPEN || !(await hasAnyAccount(db));
}
