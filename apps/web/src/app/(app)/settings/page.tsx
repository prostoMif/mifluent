import { getConfig } from "@mifluent/core";
import {
  can,
  findTenant,
  findTenantPlan,
  getBillingStatus,
  getReferralStats,
  listInvitations,
  listWatchProfiles,
  readCostCap,
  readDeliverySettings,
  readDiscoveryAllowance,
  readTargetAllowance,
  summariseSpend,
} from "@mifluent/domain";
import type { Metadata } from "next";
import { BillingPanel } from "@/components/billing/billing-panel";
import { ReferralPanel } from "@/components/billing/referral-panel";
import { DeliverySettingsForm } from "@/components/settings/delivery-settings-form";
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

      {can(session.role, "profile:write")
        ? await renderDeliverySettings(session.tenantId, config.DEFAULT_TIMEZONE)
        : null}

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

      {canSeeSpend ? await renderBilling(session.tenantId, config.EARLY_SEATS) : null}

      {spendData === undefined ? null : <SpendSummaryPanel {...spendData} />}

      {canManagePeople ? <InvitationsPanel invitations={invitations} /> : null}

      {canSeeSpend ? (
        <section aria-labelledby="data-heading">
          <h2 id="data-heading">Your data · Данные</h2>
          <p className={styles["pageLead"]}>
            Download everything — profiles, targets, every change with its quotes, your decisions.
            Скачать всё одним файлом.
          </p>
          <p>
            <a href="/api/export" download>
              Download JSON · Скачать
            </a>
          </p>
          <p className={styles["pageLead"]}>
            To delete the account and everything in it, write to{" "}
            {config.FEEDBACK_EMAIL === undefined ? (
              "the owner of this instance"
            ) : (
              <a href={`mailto:${config.FEEDBACK_EMAIL}?subject=Delete my account`}>
                {config.FEEDBACK_EMAIL}
              </a>
            )}{" "}
            — it is done within three days.
          </p>
        </section>
      ) : null}
    </>
  );
}

/** "Your brief": when, where and in which language, per profile. */
async function renderDeliverySettings(tenantId: string, defaultTimezone: string) {
  const db = getDatabase();
  const [profiles, plan] = await Promise.all([
    listWatchProfiles(db, tenantId),
    findTenantPlan(db, tenantId),
  ]);
  const forms = await Promise.all(
    profiles.map(async (profile) => ({
      profile,
      settings: await readDeliverySettings(db, tenantId, profile.id, defaultTimezone),
    })),
  );
  if (forms.length === 0) return null;
  return (
    <section aria-labelledby="brief-heading">
      <h2 id="brief-heading">Your brief · Сводка</h2>
      {forms.map(({ profile, settings }) =>
        settings === undefined ? null : (
          <div key={profile.id}>
            {forms.length > 1 ? <h3>{profile.name}</h3> : null}
            <DeliverySettingsForm
              profileId={profile.id}
              initial={settings}
              isDailyAllowed={plan.limits.dailyDigest}
            />
          </div>
        ),
      )}
    </section>
  );
}

async function renderBilling(tenantId: string, earlySeats: number) {
  const db = getDatabase();
  const config = getConfig();
  const [status, plan, referrals] = await Promise.all([
    getBillingStatus(db, tenantId, earlySeats),
    findTenantPlan(db, tenantId),
    getReferralStats(db, tenantId),
  ]);
  const bot = config.TELEGRAM_BOT_USERNAME;
  return (
    <>
      <BillingPanel
        effectivePlan={plan.name}
        paidPlan={status.paidPlan}
        trialEndsAt={status.trialEndsAt?.toISOString() ?? null}
        paidUntil={status.paidUntil?.toISOString() ?? null}
        isRefundPossible={status.isRefundPossible}
      />
      <ReferralPanel
        siteLink={`${config.APP_URL}/r/ref/${referrals.code}`}
        telegramLink={bot === undefined ? null : `https://t.me/${bot}?start=ref_${referrals.code}`}
        signedUp={referrals.signedUp}
        rewarded={referrals.rewarded}
      />
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
