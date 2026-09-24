/**
 * Structured logging. One JSON object per line, to stdout.
 *
 * This is the only file in the codebase allowed to call `console` directly —
 * everywhere else, use a logger instance. Event names follow
 * `<domain>.<past-tense-action>`, the same names used in analytics, so that a
 * question asked of the logs can be asked of the product data too.
 *
 * Redaction is deliberate and conservative: a field whose name looks like a
 * secret is replaced, wherever it appears in the tree. Getting a secret into a
 * log is easy and getting it back out is impossible.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger that adds the given fields to every line it writes. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  /** Fields attached to every line, e.g. the process role. */
  readonly base?: LogFields;
  /** Pretty-print for a human reading a terminal. Never enable in production. */
  readonly pretty?: boolean;
}

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACTED = "[redacted]";

/**
 * Substrings that mark a field as secret. Matched case-insensitively against
 * the key name, so `apiKey`, `api_key` and `userApiKeyLastFour` all match —
 * over-redacting a log line is a non-event, under-redacting is an incident.
 */
const SECRET_KEY_PATTERNS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "session",
  "credential",
  "privatekey",
  "private_key",
  "encryptionkey",
  "encryption_key",
  "signature",
  "otp",
];

/**
 * Field names carrying what a person wrote, rather than a secret.
 *
 * Matched on the whole name rather than as a substring, because the substring
 * rule above would swallow `context`, `addedText` and every other field that
 * merely ends in the same four letters. The one that matters is `text`: a
 * decision is the reader's own strategy, and `docs/security.md` §8 keeps it
 * out of logs, telemetry and prompts alike. Nothing in the codebase passes it
 * to a logger — this is the backstop for the day something does.
 */
const CONTENT_KEY_NAMES: readonly string[] = ["text", "decisiontext"];

const MAX_REDACT_DEPTH = 6;

function isSecretKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z]/g, "");
  if (CONTENT_KEY_NAMES.includes(normalised)) return true;
  return SECRET_KEY_PATTERNS.some((pattern) => normalised.includes(pattern.replace(/[^a-z]/g, "")));
}

function redact(value: unknown, depth = 0): unknown {
  if (depth >= MAX_REDACT_DEPTH) {
    return "[truncated]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      result[key] = isSecretKey(key) ? REDACTED : redact(source[key], depth + 1);
    }
    return result;
  }

  return value;
}

function write(level: LogLevel, line: Record<string, unknown>, pretty: boolean): void {
  const serialised = pretty ? JSON.stringify(line, null, 2) : JSON.stringify(line);

  // Warnings and errors go to stderr so that piping stdout to a collector
  // still leaves problems visible in a terminal.
  if (level === "error" || level === "warn") {
    console.error(serialised);
    return;
  }
  // biome-ignore lint/suspicious/noConsole: this is the logger
  console.log(serialised);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minimumWeight = LEVEL_WEIGHT[options.level ?? "info"];
  const base = options.base ?? {};
  const pretty = options.pretty ?? false;

  function emit(level: LogLevel, event: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[level] < minimumWeight) {
      return;
    }

    const line: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      event,
      ...(redact(base) as Record<string, unknown>),
    };

    if (fields !== undefined) {
      Object.assign(line, redact(fields) as Record<string, unknown>);
    }

    write(level, line, pretty);
  }

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child: (fields) =>
      createLogger({
        ...options,
        base: { ...base, ...fields },
      }),
  };
}

/** Exported for tests. Not part of the logging interface. */
export const __testing = { redact, isSecretKey };
