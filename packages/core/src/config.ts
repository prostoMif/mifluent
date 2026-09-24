/**
 * Configuration.
 *
 * This is the only file in the codebase that reads `process.env`. Everywhere
 * else imports the typed object it returns. Two reasons: a typo in a variable
 * name becomes a startup error instead of an `undefined` discovered three hours
 * later, and there is exactly one place to look when someone asks what a setting
 * is called.
 *
 * There is no configuration file — no YAML, no TOML, no JSON. Two sources of
 * configuration means two places to search when something is wrong, plus the
 * question of which one wins in every issue anyone ever files.
 *
 * The process fails fast. A missing required variable stops startup and prints
 * everything that is absent, rather than starting half-working and failing on
 * the first request that happens to need it.
 */

import { z } from "zod";
import { AppError } from "./errors.js";

const nonEmpty = z.string().min(1);

/** HH:MM, 24-hour. */
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be a time in HH:MM form, for example 07:00");

/**
 * A full http or https URL.
 *
 * Not `z.string().url()`: that accepts `localhost:3000`, reading it as the
 * scheme `localhost` with path `3000`. It is also exactly what someone types
 * when they mean `http://localhost:3000`, and the resulting failure surfaces
 * later as a broken login redirect rather than a startup error.
 *
 * Restricting to http and https is also the rule the rest of the codebase
 * follows for anything URL-shaped — see docs/security.md.
 */
const httpUrl = z.string().refine(
  (value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be a full http or https URL, for example http://localhost:3000" },
);

const booleanish = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(["true", "false", "1", "0", "yes", "no"]))
  .transform((value) => value === "true" || value === "1" || value === "yes");

const configSchema = z.object({
  // --- Required ---------------------------------------------------------
  DATABASE_URL: nonEmpty.describe("PostgreSQL connection string"),

  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "must be at least 32 characters — generate one with: openssl rand -base64 48"),

  BETTER_AUTH_URL: httpUrl,

  ENCRYPTION_KEY: z
    .string()
    .min(32, "must be at least 32 characters — generate one with: openssl rand -base64 32"),

  APP_URL: httpUrl,

  // --- Optional: each switches a feature on -----------------------------
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  LLM_MODEL_CHEAP: z.string().optional(),
  LLM_MODEL_DEEP: z.string().optional(),
  LLM_PRICE_CHEAP_IN: z.coerce.number().default(0),
  LLM_PRICE_CHEAP_OUT: z.coerce.number().default(0),
  LLM_PRICE_DEEP_IN: z.coerce.number().default(0),
  LLM_PRICE_DEEP_OUT: z.coerce.number().default(0),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /** The bot's @name without the @, shown in the "send /start" instruction. */
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9_]{5,32}$/, "must be the bot's username without @")
    .optional(),
  /**
   * Part of the webhook path and the value Telegram echoes back in a header.
   * Long enough that guessing it is not a plan.
   */
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .min(32, "must be at least 32 characters — generate one with: openssl rand -hex 32")
    .optional(),
  /**
   * Local development only: the worker asks Telegram for updates instead of
   * waiting for a webhook, because a laptop has no public address to receive one.
   */
  TELEGRAM_POLLING: booleanish.default(false),

  /** Shared secret for the billing stub. Absent means the endpoint refuses everything. */
  BILLING_WEBHOOK_SECRET: z
    .string()
    .min(32, "must be at least 32 characters — generate one with: openssl rand -hex 32")
    .optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),

  /**
   * Where a person reports a problem. Optional: an instance run by somebody
   * who does not use the public tracker still wants the report button, it just
   * has nowhere to send them.
   */
  ISSUE_TRACKER_URL: httpUrl.optional(),

  // --- Tuning: sensible defaults ----------------------------------------
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  REGISTRATION_OPEN: booleanish.default(false),
  DEFAULT_TIMEZONE: z.string().default("UTC"),
  DIGEST_DEFAULT_TIME: timeOfDay.default("07:00"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /**
   * Where the local embedding model is cached. Downloaded once, ~120 MB. In a
   * container this should be a volume, or every restart downloads it again.
   * Unset means `~/.cache/mifluent/models`.
   */
  MODELS_DIR: z.string().optional(),

  /**
   * Cosine similarity above which two events are the same story. 0.92 is where
   * multilingual-e5-small puts reprints of one press release and keeps two
   * different announcements by the same company apart; lower it and unrelated
   * news from one competitor starts merging.
   */
  CLUSTER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),

  /**
   * The worker touches this file once a minute. The container healthcheck
   * reads its age: a worker whose event loop is stuck stops touching it even
   * though the process is still alive.
   */
  WORKER_HEARTBEAT_FILE: z.string().optional(),

  /**
   * Hard ceiling on model spend for the whole instance per UTC day. When it is
   * crossed, every job that would call a model stops until midnight UTC.
   */
  DAILY_COST_CAP_USD: z.coerce.number().min(0).default(1),
});

export type RawConfig = z.infer<typeof configSchema>;

/**
 * Which optional features are switched on.
 *
 * Derived once here rather than checked inline, so that "is Telegram
 * configured" has one answer instead of four slightly different ones.
 */
export interface Features {
  readonly llm: boolean;
  readonly telegram: boolean;
  readonly email: boolean;
  readonly googleSignIn: boolean;
  readonly reddit: boolean;
}

export interface Config extends RawConfig {
  readonly features: Features;
  /**
   * `PLAN_<NAME>_<FIELD>` variables, keyed as `{ free: { maxTargets: "5" } }`.
   * Left as strings: which fields exist and what type each has is the plans
   * module's knowledge, not configuration's, and it validates them there.
   */
  readonly planOverrides: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
}

const PLAN_OVERRIDE_PATTERN = /^PLAN_([A-Z]+)_([A-Z][A-Z_]*)$/;

/** `MAX_TARGETS` → `maxTargets`. */
function toCamelCase(screaming: string): string {
  return screaming
    .toLowerCase()
    .replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function readPlanOverrides(
  source: Record<string, string | undefined>,
): Record<string, Record<string, string>> {
  const overrides: Record<string, Record<string, string>> = {};

  for (const [name, value] of Object.entries(source)) {
    const match = PLAN_OVERRIDE_PATTERN.exec(name);
    const plan = match?.[1];
    const field = match?.[2];
    if (value === undefined || plan === undefined || field === undefined) continue;

    const planName = plan.toLowerCase();
    overrides[planName] = { ...overrides[planName], [toCamelCase(field)]: value };
  }

  return overrides;
}

function deriveFeatures(raw: RawConfig): Features {
  return {
    llm: Boolean(raw.LLM_API_KEY && raw.LLM_MODEL_CHEAP && raw.LLM_MODEL_DEEP),
    telegram: Boolean(raw.TELEGRAM_BOT_TOKEN),
    email: Boolean(raw.SMTP_HOST && raw.SMTP_USER && raw.SMTP_PASSWORD && raw.SMTP_FROM),
    googleSignIn: Boolean(raw.GOOGLE_CLIENT_ID && raw.GOOGLE_CLIENT_SECRET),
    reddit: Boolean(raw.REDDIT_CLIENT_ID && raw.REDDIT_CLIENT_SECRET),
  };
}

/** Structural, so this compiles against either Zod 3 or Zod 4. */
interface ConfigIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

function formatIssues(issues: readonly ConfigIssue[]): string {
  const lines = issues.map((issue) => {
    const name = issue.path.map(String).join(".") || "(root)";
    return `  ${name}: ${issue.message}`;
  });

  return [
    "Configuration is invalid. The process cannot start.",
    "",
    ...lines,
    "",
    "See .env.example for what each variable does.",
  ].join("\n");
}

/**
 * Parse configuration from an environment-like object.
 *
 * Takes the source as an argument so it can be tested without touching the real
 * environment — a config module that can only be tested by mutating
 * `process.env` ends up not being tested.
 */
/**
 * A variable that is present but empty means "not set".
 *
 * `.env.example` ships every key present and blank, so an optional setting
 * nobody touched arrives as `""` rather than as absent — and `""` is not
 * missing, it is a value that fails whatever the setting actually requires.
 * The failure it produces is baffling: the process refuses to start over a
 * feature the operator never asked for.
 *
 * Done once here so that no schema below has to remember it.
 */
function withoutBlanks(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};

  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== "") {
      result[name] = value;
    }
  }

  return result;
}

export function parseConfig(source: Record<string, string | undefined>): Config {
  const present = withoutBlanks(source);
  const result = configSchema.safeParse(present);

  if (!result.success) {
    throw new AppError("configuration_invalid", formatIssues(result.error.issues), {
      issues: result.error.issues,
    });
  }

  return {
    ...result.data,
    features: deriveFeatures(result.data),
    planOverrides: readPlanOverrides(present),
    isProduction: result.data.NODE_ENV === "production",
    isDevelopment: result.data.NODE_ENV === "development",
  };
}

let cached: Config | undefined;

/**
 * The configuration for this process.
 *
 * Cached after the first call: parsing is cheap, but configuration changing
 * underneath a running process is a class of bug nobody needs.
 */
export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}

/** For tests only. */
export function resetConfigCache(): void {
  cached = undefined;
}
