/**
 * The two jobs a person waits on during onboarding: reading their site, and a
 * new profile's first run from polling to digest.
 *
 * Both finish with a result the web page reads back through the queue, rather
 * than failing the job, when the problem is one to show the person — a plan
 * limit, no model configured. A failed job's output is a stack trace, which is
 * the one thing that must not reach a browser.
 */

import { toAppError } from "@mifluent/core";
import { sendSignupFailure, sendSignupListing } from "@mifluent/delivery";
import { createProber, discover, findTargetSurfaces } from "@mifluent/discovery";
import {
  assertCanRunDiscovery,
  createSource,
  discoveryJobSchema,
  ensureAnonTenant,
  type FirstRunJob,
  firstRunJobSchema,
  getPendingOnboarding,
  listProfilePollableSources,
  listTargetsWithoutSources,
  recordPendingDiscoveryFailure,
  updatePendingDiscoveryResult,
} from "@mifluent/domain";
import { loadProfileContext } from "@mifluent/pipeline";
import type { PgBoss } from "pg-boss";
import { pollSource } from "../poll-source.js";
import { QUEUES, queueDelivery } from "../queue.js";
import {
  createPipelineLlm,
  getDatabase,
  getRsshubHostname,
  getTelegramApi,
  logger,
  USER_AGENT,
} from "../runtime.js";
import { buildDigestNow, embedTenant, extractProfile, selectProfile } from "../steps.js";

export async function registerOnboardingJobs(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.discoveryRun, async ([job]) => {
    if (job === undefined) return undefined;
    const data = discoveryJobSchema.parse(job.data);
    const db = getDatabase();

    try {
      // A visitor without an account: limited by address when it started,
      // booked to the anonymous service tenant.
      if (data.pendingId === undefined) {
        await assertCanRunDiscovery(db, data.tenantId);
      } else {
        await ensureAnonTenant(db);
      }
      const llm = createPipelineLlm(db);
      if (llm === undefined) {
        const message = "No language model is configured on this instance.";
        if (data.pendingId !== undefined) {
          await recordPendingDiscoveryFailure(db, data.pendingId, message);
        }
        return failure("model_unavailable", message);
      }

      const result = await onceMoreIfTransient(() =>
        discover({
          input: data.input,
          language: data.language,
          llm,
          userAgent: USER_AGENT,
          tenantId: data.tenantId,
          runId: job.id,
          logger,
          allowedInternalHost: getRsshubHostname(),
        }),
      );
      if (data.pendingId !== undefined) {
        await updatePendingDiscoveryResult(db, data.pendingId, result);
        await tellTelegramSignup(data.pendingId, undefined);
      }
      return { status: "completed", result };
    } catch (thrown) {
      const error = toAppError(thrown);
      logger.warn("discovery.failed", {
        tenantId: data.tenantId,
        code: error.code,
        details: error.details,
      });
      if (data.pendingId !== undefined) {
        await recordPendingDiscoveryFailure(db, data.pendingId, error.message);
        await tellTelegramSignup(data.pendingId, error.message);
      }
      return failure(error.code, error.message);
    }
  });

  await boss.work(QUEUES.profileFirstRun, async ([job]) => {
    if (job === undefined) return undefined;
    return runFirstRun(boss, firstRunJobSchema.parse(job.data));
  });
}

/**
 * A new profile, from nothing to its first digest: every source read now
 * rather than when due, the cascade run inline, the digest built for the last
 * week (a month if the week was empty).
 */
async function runFirstRun(
  boss: PgBoss,
  ref: FirstRunJob,
): Promise<{ status: "completed"; digestId: string }> {
  const db = getDatabase();
  const now = new Date();

  await findSourcesForManualTargets(ref);

  for (const source of await listProfilePollableSources(db, ref.tenantId, ref.profileId)) {
    await pollSource({ db, source, now });
  }

  let embedded = await embedTenant(db, ref.tenantId);
  while (embedded.hasMore) {
    embedded = await embedTenant(db, ref.tenantId);
  }

  const selection = await selectProfile(db, ref);
  const extraction = typeof selection === "string" ? selection : await extractProfile(db, ref);
  const digest = await buildDigestNow(db, ref, new Date());

  if (digest.isNew && digest.channel === "telegram") {
    await queueDelivery(boss, { tenantId: ref.tenantId, digestId: digest.digestId });
  }

  logger.info("profile.first_run_completed", {
    ...ref,
    selection: typeof selection === "string" ? selection : selection.status,
    extraction: typeof extraction === "string" ? extraction : extraction.status,
    cards: digest.cardCount,
  });
  return { status: "completed", digestId: digest.digestId };
}

/**
 * A competitor added by hand has a site and nothing else. The same heuristics
 * discovery uses find where to watch it, and every verified surface becomes a
 * source before the first poll.
 */
async function findSourcesForManualTargets(ref: FirstRunJob): Promise<void> {
  const db = getDatabase();
  const targets = await listTargetsWithoutSources(db, ref.tenantId, ref.profileId);
  if (targets.length === 0) return;

  const context = await loadProfileContext(db, ref.tenantId, ref.profileId);
  const prober = createProber({
    userAgent: USER_AGENT,
    logger,
    allowedInternalHost: getRsshubHostname(),
  });

  for (const target of targets) {
    const surfaces = await findTargetSurfaces(target, {
      prober,
      language: context?.language ?? "en",
    });
    for (const surface of surfaces.filter((candidate) => candidate.verified)) {
      await createSource({
        db,
        tenantId: ref.tenantId,
        profileId: ref.profileId,
        targetId: target.id,
        input: {
          kind: surface.type === "diff" ? "diff" : surface.type === "json" ? "json" : "rss",
          label: `${target.name} — ${surface.label}`.slice(0, 120),
          locator: surface.url,
          pollIntervalMinutes: surface.pollIntervalMinutes,
        },
      }).catch((thrown: unknown) => {
        // A duplicate of a source the profile already has is fine to skip;
        // anything else is logged and the run goes on with what it has.
        logger.warn("profile.surface_skipped", { ...ref, code: toAppError(thrown).code });
      });
    }
  }
}

function failure(
  code: string,
  message: string,
): { status: "failed"; error: { code: string; message: string } } {
  return { status: "failed", error: { code, message } };
}

/**
 * A sign-up running in Telegram hears about its discovery in the chat: the
 * listing with its "Go" button, or why the site could not be read. A sign-up
 * from the site has no chat yet and reads it on the progress page instead.
 */
async function tellTelegramSignup(pendingId: string, failureReason: string | undefined) {
  const telegram = getTelegramApi();
  if (telegram === undefined) return;
  const db = getDatabase();
  try {
    if (failureReason === undefined) {
      await sendSignupListing(db, telegram, pendingId);
      return;
    }
    const pending = await getPendingOnboarding(db, pendingId);
    if (pending?.telegramChatId != null) {
      await sendSignupFailure(telegram, pending.telegramChatId, pending.language, failureReason);
    }
  } catch (error) {
    logger.warn("telegram.signup_message_failed", { pendingId, cause: error });
  }
}

/** Codes that mean "the model service hiccupped", not "this input is bad". */
const TRANSIENT_CODES = new Set(["rate_limited", "model_unavailable"]);

/** Long enough for a rate limit window to pass, short enough for a person watching a progress bar. */
const RETRY_DELAY_MS = 4_000;

/**
 * A person is watching the progress screen while discovery runs, and one 429
 * from the model provider would otherwise end their onboarding. One more try
 * after a short pause; a second failure is reported as before.
 */
async function onceMoreIfTransient<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (thrown) {
    const error = toAppError(thrown);
    if (!TRANSIENT_CODES.has(error.code)) throw thrown;
    logger.warn("discovery.retried", { code: error.code });
    await new Promise((resolve) => {
      setTimeout(resolve, RETRY_DELAY_MS);
    });
    return run();
  }
}
