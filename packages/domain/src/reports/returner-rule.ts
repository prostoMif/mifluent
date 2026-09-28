/**
 * Returner rule: determines if a user "came back" during the beta.
 *
 * A user is a "returner" if, within the first 14 days after onboarding:
 * - They had actions on 3 different days, AND
 * - At least one of those days is on day 7 or later, OR
 * - They have at least one "influenced" action.
 *
 * An action is any button press (saved, not_important, not_following_target,
 * influenced) or a link click (opened_source).
 */

interface UserAction {
  readonly occurredAt: Date;
  readonly kind: string;
}

export function isReturner(onboardedAt: Date, actions: readonly UserAction[]): boolean {
  if (actions.length === 0) return false;

  // Check for "influenced" action anywhere in the first 14 days
  const windowEnd = new Date(onboardedAt.getTime() + 14 * 24 * 60 * 60 * 1000);

  for (const action of actions) {
    if (action.kind === "influenced" && action.occurredAt <= windowEnd) {
      return true;
    }
  }

  // Collect unique days with any action within first 14 days
  const actionDays = new Set<string>();
  for (const action of actions) {
    if (action.occurredAt > windowEnd) break; // actions are ordered
    const dayStr = action.occurredAt.toISOString().split("T")[0] ?? "";
    if (dayStr) actionDays.add(dayStr);
  }

  if (actionDays.size < 3) return false;

  // Check if at least one action day is on day 7 or later (0-indexed: day >= 7)
  const onboardedDayStr = onboardedAt.toISOString().split("T")[0];
  const onboardedDate = new Date(`${onboardedDayStr}T00:00:00Z`);

  for (const dayStr of actionDays) {
    const actionDate = new Date(`${dayStr}T00:00:00Z`);
    const dayDiff = Math.floor(
      (actionDate.getTime() - onboardedDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (dayDiff >= 7) return true;
  }

  return false;
}
