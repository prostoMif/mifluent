/**
 * What the model has cost, and what the plan allows.
 *
 * Shown to the owner because the daily cap is a hard stop: a quiet digest
 * should be explainable from this page without opening a log.
 */

import type {
  CostCapState,
  DiscoveryAllowance,
  SpendSummary,
  TargetAllowance,
} from "@mifluent/domain";
import type { PlanName } from "@mifluent/domain/schemas";

export interface SpendSummaryProps {
  readonly plan: PlanName;
  readonly spend: SpendSummary;
  readonly cap: CostCapState;
  readonly targets: TargetAllowance;
  readonly discoveries: DiscoveryAllowance;
}

const PURPOSE_LABELS: Readonly<Record<string, string>> = {
  discovery: "Reading sites during onboarding",
  selection: "Selection (cheap model)",
  extraction: "Extraction (deep model)",
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
});

export function SpendSummaryPanel({ plan, spend, cap, targets, discoveries }: SpendSummaryProps) {
  return (
    <section aria-labelledby="spend-heading">
      <h2 id="spend-heading">Plan and spend</h2>
      <dl>
        <dt>Plan</dt>
        <dd>{plan}</dd>
        <dt>Watched targets</dt>
        <dd>
          {targets.used} of {targets.limit}
        </dd>
        <dt>Site readings this month</dt>
        <dd>
          {discoveries.used} of {discoveries.limit}
        </dd>
        <dt>Spent today (this tenant)</dt>
        <dd>{money.format(spend.todayUsd)}</dd>
        <dt>Spent in the last 30 days</dt>
        <dd>{money.format(spend.last30DaysUsd)}</dd>
        <dt>Instance budget today</dt>
        <dd>
          {money.format(cap.spentTodayUsd)} of {money.format(cap.capUsd)}
          {cap.isReached ? " — reached; model work is paused until 00:00 UTC" : ""}
        </dd>
      </dl>

      {spend.byPurpose.length === 0 ? null : (
        <table>
          <caption>Last 30 days by purpose</caption>
          <thead>
            <tr>
              <th scope="col">Purpose</th>
              <th scope="col">Calls</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {spend.byPurpose.map((row) => (
              <tr key={row.purpose}>
                <td>{PURPOSE_LABELS[row.purpose] ?? row.purpose}</td>
                <td>{row.calls}</td>
                <td>{money.format(row.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
