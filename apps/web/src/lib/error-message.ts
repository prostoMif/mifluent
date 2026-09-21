/**
 * Turning a failed request into a sentence a person can act on.
 *
 * Browser code never sees an `AppError`; it sees whatever crossed the network.
 * This is the one place that decides what to show, so that no form invents its
 * own wording and none of them accidentally render an object.
 */

const FALLBACK_MESSAGE = "Something went wrong. Try again.";

/** Shape shared by Better Auth's error object and our own error envelope. */
interface MessageCarrier {
  readonly message?: unknown;
}

function readMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const message = (value as MessageCarrier).message;
  return typeof message === "string" && message.trim() !== "" ? message : undefined;
}

/**
 * Read a message out of anything a request can fail with.
 *
 * Deliberately does not fall through to `String(error)`: that is how a stack
 * trace or a driver message ends up on screen.
 */
export function toDisplayMessage(error: unknown): string {
  const direct = readMessage(error);
  if (direct !== undefined) {
    return direct;
  }

  if (typeof error === "object" && error !== null && "error" in error) {
    const nested = readMessage((error as { error: unknown }).error);
    if (nested !== undefined) {
      return nested;
    }
  }

  return FALLBACK_MESSAGE;
}
