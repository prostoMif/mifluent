import { createLogger, type Logger, type LogLevel } from "@mifluent/core";

/**
 * The logger for the web process.
 *
 * Reads `LOG_LEVEL` directly rather than through `getConfig()`. Configuration
 * parsing can itself fail, and when it does the one thing that has to still
 * work is the ability to say so.
 */
function resolveLevel(): LogLevel {
  const raw = process.env["LOG_LEVEL"];
  return raw === "debug" || raw === "warn" || raw === "error" ? raw : "info";
}

export const logger: Logger = createLogger({
  level: resolveLevel(),
  base: { role: "web" },
  pretty: process.env["NODE_ENV"] !== "production",
});
