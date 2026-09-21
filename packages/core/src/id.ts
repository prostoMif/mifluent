/**
 * UUIDv7 — time-ordered identifiers.
 *
 * Written out rather than pulled from a package: it is forty lines, the layout
 * is fixed by RFC 9562, and every dependency in a public repository is one more
 * thing to audit.
 *
 * Why v7 and not v4: identifiers are primary keys on tables that will hold a lot
 * of rows (raw items, chunks, embeddings). Random keys scatter inserts across a
 * B-tree; time-ordered keys append. Why not an auto-increment integer: in the
 * hosted version identifiers appear in URLs, and a counter tells anyone looking
 * how many tenants and how much material exist.
 *
 * Layout (RFC 9562 §5.7):
 *
 *   0                   1                   2                   3
 *   | 48 bits unix_ts_ms          | ver | 12 bits rand_a | var | 62 bits rand_b |
 *
 * `rand_a` carries a counter rather than random bits, so identifiers generated
 * inside the same millisecond still sort in creation order.
 */

const MAX_COUNTER = 0xfff; // 12 bits of rand_a

let lastTimestamp = -1;
let counter = 0;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Generate a UUIDv7.
 *
 * Identifiers are generated in the application, never as a column default, so
 * that an object has an identity before it is written and can be named in a log
 * line when the write fails.
 */
export function uuidv7(): string {
  const now = Date.now();

  if (now === lastTimestamp) {
    counter += 1;
    if (counter > MAX_COUNTER) {
      // More than 4096 identifiers inside one millisecond. Borrowing from the
      // next millisecond keeps ordering intact; the clock catches up.
      lastTimestamp += 1;
      counter = 0;
    }
  } else if (now > lastTimestamp) {
    lastTimestamp = now;
    counter = 0;
  } else {
    // The clock went backwards (NTP correction, suspend). Never emit an
    // identifier that sorts before one already handed out.
    counter += 1;
    if (counter > MAX_COUNTER) {
      lastTimestamp += 1;
      counter = 0;
    }
  }

  const timestamp = lastTimestamp;
  const bytes = new Uint8Array(16);
  const random = randomBytes(8);

  // 48 bits of millisecond timestamp, big-endian.
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Version 7 in the high nibble, then the 12-bit counter.
  bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  // Variant 10 in the top two bits, then 62 bits of randomness.
  bytes[8] = 0x80 | ((random[0] ?? 0) & 0x3f);
  for (let index = 9; index < 16; index += 1) {
    bytes[index] = random[index - 8] ?? 0;
  }

  const hex = toHex(bytes);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Read the creation time back out of a v7 identifier. Useful in debugging. */
export function uuidv7Timestamp(id: string): Date {
  const hex = id.replaceAll("-", "").slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}
