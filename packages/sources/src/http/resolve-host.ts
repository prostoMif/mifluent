/**
 * Turning a hostname into an address this application is allowed to connect to.
 *
 * The subtlety worth naming is DNS rebinding. Checking a hostname and then
 * connecting by hostname resolves it twice, and the attacker only has to make
 * the second answer differ from the first: the check sees a public address, the
 * connection goes to `127.0.0.1`. The gap is milliseconds wide and entirely
 * winnable with a one-second time-to-live.
 *
 * So this resolves once and hands back the address itself. The caller connects
 * to that address and never asks the resolver again — there is no second answer
 * to poison.
 *
 * // TODO: security review — fetches user-supplied URLs
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@mifluent/core";
import { describeAddress, isPublicAddress } from "./address-rules.js";

export interface ResolvedHost {
  readonly address: string;
  /** 4 or 6, as Node's socket layer wants it. */
  readonly family: number;
}

/**
 * Resolve a hostname, refusing it unless every answer is a public address.
 *
 * Every answer, not merely the one being used. A name that resolves to a public
 * address and a private one is either broken or hostile, and there is no
 * reading of it under which fetching it is the right thing to do.
 */
export async function resolvePublicHost(hostname: string): Promise<ResolvedHost> {
  const bare = stripBrackets(hostname);

  // A literal address in the URL skips resolution but not the check.
  if (isIP(bare) !== 0) {
    return checkLiteral(bare);
  }

  const answers = await lookupOrFail(hostname);

  const refused = answers.find((answer) => !isPublicAddress(answer.address));
  if (refused !== undefined) {
    throw new AppError("url_not_allowed", "That address cannot be reached from here.", {
      hostname,
      reason: describeAddress(refused.address),
    });
  }

  const [first] = answers;
  if (first === undefined) {
    throw new AppError("url_not_allowed", "That address cannot be reached from here.", {
      hostname,
      reason: "resolved to nothing",
    });
  }

  return { address: first.address, family: first.family };
}

/**
 * A URL holds an IPv6 address in square brackets, and `URL.hostname` hands them
 * back with the brackets still attached. Without this, `[::1]` fails the
 * literal check, falls through to name resolution, and is refused only because
 * no such hostname exists — which is luck rather than a control.
 */
function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function checkLiteral(hostname: string): ResolvedHost {
  if (!isPublicAddress(hostname)) {
    throw new AppError("url_not_allowed", "That address cannot be reached from here.", {
      hostname,
      reason: describeAddress(hostname),
    });
  }

  return { address: hostname, family: isIP(hostname) };
}

async function lookupOrFail(
  hostname: string,
): Promise<readonly { address: string; family: number }[]> {
  try {
    return await lookup(hostname, { all: true, verbatim: true });
  } catch {
    // The resolver's own message names the system's DNS configuration, which
    // is nothing the person who pasted the URL needs or should see.
    throw new AppError("source_unreachable", "That address could not be found.", { hostname });
  }
}
