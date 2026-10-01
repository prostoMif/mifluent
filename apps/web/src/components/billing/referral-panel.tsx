/**
 * "Invite a friend": the tenant's link, and how many friends came and paid.
 * Server-rendered; the links are plain text to copy.
 */

import { MAX_REFERRAL_MONTHS, REFERRAL_TRIAL_DAYS } from "@mifluent/domain";
import styles from "./billing.module.css";

export interface ReferralPanelProps {
  readonly siteLink: string;
  readonly telegramLink: string | null;
  readonly signedUp: number;
  readonly rewarded: number;
}

export function ReferralPanel({ siteLink, telegramLink, signedUp, rewarded }: ReferralPanelProps) {
  return (
    <section aria-labelledby="referral-heading">
      <h2 id="referral-heading">Invite a friend</h2>
      <p className={styles["muted"]}>
        A friend who signs up through your link gets {REFERRAL_TRIAL_DAYS} days of Pro free instead
        of 14. When they pay for any plan, you get a month free — up to {MAX_REFERRAL_MONTHS}.
      </p>
      <dl>
        <dt>Your link</dt>
        <dd>
          <code>{siteLink}</code>
        </dd>
        {telegramLink === null ? null : (
          <>
            <dt>In Telegram</dt>
            <dd>
              <code>{telegramLink}</code>
            </dd>
          </>
        )}
        <dt>Friends</dt>
        <dd>
          {signedUp} signed up, {rewarded} paid
        </dd>
      </dl>
    </section>
  );
}
