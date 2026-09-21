import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";

function captureStdout(): { lines: () => Record<string, unknown>[] } {
  const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  return {
    lines: () =>
      spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>),
  };
}

function captureStderr(): { lines: () => Record<string, unknown>[] } {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  return {
    lines: () =>
      spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLogger", () => {
  it("writes one json object per line with time, level and event", () => {
    const out = captureStdout();
    createLogger().info("digest.delivered", { cardCount: 5 });

    const [line] = out.lines();
    expect(line).toMatchObject({ level: "info", event: "digest.delivered", cardCount: 5 });
    expect(typeof line?.["time"]).toBe("string");
  });

  it("drops events below the configured level", () => {
    const out = captureStdout();
    const logger = createLogger({ level: "warn" });

    logger.debug("noisy.thing");
    logger.info("also.noisy");

    expect(out.lines()).toHaveLength(0);
  });

  it("sends warn and error to stderr, not stdout", () => {
    const out = captureStdout();
    const err = captureStderr();

    createLogger().error("pipeline.failed", { jobId: "abc" });

    expect(out.lines()).toHaveLength(0);
    expect(err.lines()[0]).toMatchObject({ level: "error", event: "pipeline.failed" });
  });

  it("merges child fields into every line", () => {
    const out = captureStdout();
    const logger = createLogger({ base: { role: "worker" } }).child({ tenantId: "t-1" });

    logger.info("source.polled");

    expect(out.lines()[0]).toMatchObject({ role: "worker", tenantId: "t-1" });
  });
});

describe("redaction", () => {
  it("redacts secrets whatever the key is spelled like", () => {
    const out = captureStdout();

    createLogger().info("byok.saved", {
      apiKey: "secret-value-should-never-appear",
      api_key: "secret-value-should-never-appear",
      userPassword: "hunter2",
      sessionToken: "abc.def.ghi",
      ENCRYPTION_KEY: "nope",
      tenantId: "t-1",
    });

    const line = out.lines()[0];
    expect(line).toMatchObject({
      apiKey: "[redacted]",
      api_key: "[redacted]",
      userPassword: "[redacted]",
      sessionToken: "[redacted]",
      ENCRYPTION_KEY: "[redacted]",
      // Not a secret, must survive — otherwise the logs become useless.
      tenantId: "t-1",
    });
    expect(JSON.stringify(line)).not.toContain("should-never-appear");
    expect(JSON.stringify(line)).not.toContain("hunter2");
  });

  it("redacts secrets nested inside objects and arrays", () => {
    const out = captureStdout();

    createLogger().info("provider.called", {
      request: {
        headers: { authorization: "Bearer sk-live-nested" },
        retries: [{ token: "sk-live-in-array" }],
      },
    });

    expect(JSON.stringify(out.lines()[0])).not.toContain("sk-live");
  });

  it("serialises errors without losing the message", () => {
    const out = captureStdout();

    createLogger().info("job.retried", { cause: new Error("connection reset") });

    expect(JSON.stringify(out.lines()[0])).toContain("connection reset");
  });

  it("stops at a bounded depth instead of recursing forever", () => {
    const out = captureStdout();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    expect(() => createLogger().info("weird.input", { cyclic })).not.toThrow();
    expect(JSON.stringify(out.lines()[0])).toContain("[truncated]");
  });
});
