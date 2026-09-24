import { getConfig } from "@mifluent/core";
import {
  can,
  findTenant,
  findTenantPlan,
  listInvitations,
  readCostCap,
  readDiscoveryAllowance,
  readTargetAllowance,
  summariseSpend,
} from "@mifluent/domain";
import type { Metadata } from "next";
import { InstanceSettingsForm } from "@/components/settings/instance-settings-form";
import { InvitationsPanel } from "@/components/settings/invitations-panel";
import { SpendSummaryPanel } from "@/components/settings/spend-summary";
import { Notice } from "@/components/ui/notice";
import { getDatabase } from "@/lib/db";
import { requireSession } from "@/lib/session";
import styles from "../app.module.css";

export const metadata: Metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  const tenant = await findTenant(getDatabase(), session.tenantId);
  const config = getConfig();
  const canManagePeople = can(session.role, "member:manage");
  const invitations = canManagePeople ? await listInvitations(getDatabase(), session.tenantId) : [];
  const canSeeSpend = can(session.role, "instance:manage");
  const spendData = canSeeSpend
    ? await loadSpend(session.tenantId, config.DAILY_COST_CAP_USD)
    : undefined;

  return (
    <>
      <h1 className={styles["pageTitle"]}>Settings</h1>

      <section aria-labelledby="account-heading">
        <h2 id="account-heading">Your account</h2>
        <dl>
          <dt>Name</dt>
          <dd>{session.name}</dd>
          <dt>Email</dt>
          <dd>{session.email}</dd>
          <dt>Role</dt>
          <dd>{session.role}</dd>
        </dl>
      </section>

      <section aria-labelledby="instance-heading">
        <h2 id="instance-heading">This instance</h2>

        {canManagePeople && tenant !== undefined ? (
          <InstanceSettingsForm name={tenant.name} timezone={tenant.timezone} />
        ) : (
          <Notice tone="neutral">
            Only the owner can change these. Ask them if something here is wrong.
          </Notice>
        )}

        <p className={styles["pageLead"]}>
          Registration is currently <strong>{config.REGISTRATION_OPEN ? "open" : "closed"}</strong>.
          It is set with the <code>REGISTRATION_OPEN</code> variable and cannot be changed from here
          — a setting that decides who may create an account should not be one click away from the
          account that has just been taken over.
        </p>
      </section>

      {spendData === undefined ? null : <SpendSummaryPanel {...spendData} />}

      {canManagePeople ? <InvitationsPanel invitations={invitations} /> : null}
    </>
  );
}

async function loadSpend(tenantId: string, capUsd: number) {
  const db = getDatabase();
  const [plan, spend, cap, targets, discoveries] = await Promise.all([
    findTenantPlan(db, tenantId),
    summariseSpend(db, tenantId),
    readCostCap(db, capUsd),
    readTargetAllowance(db, tenantId),
    readDiscoveryAllowance(db, tenantId),
  ]);
  return { plan: plan.name, spend, cap, targets, discoveries };
}
