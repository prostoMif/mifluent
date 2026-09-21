/**
 * Which network addresses this application is willing to talk to.
 *
 * Users add sources by pasting a URL, so every outbound request is an address
 * chosen by somebody else. The attack is server-side request forgery: a
 * hostname the attacker controls resolves to `127.0.0.1` or to
 * `169.254.169.254`, and the server obligingly fetches something that was never
 * meant to be reachable from outside — a database on localhost, a cloud
 * metadata endpoint handing out credentials.
 *
 * Two decisions here, and both are about failing closed.
 *
 * **An allowlist, not a blocklist.** The obvious implementation is a list of
 * ranges to refuse: 10/8, 127/8, 169.254/16 and so on. Every such list is
 * missing something — carrier-grade NAT, 6to4, Teredo, IPv4-mapped IPv6, the
 * benchmarking range, whatever gets standardised next year — and a missing
 * entry is a hole rather than an inconvenience. So the rule is inverted: an
 * address is refused unless it is ordinary public unicast.
 *
 * **Parsing is not hand-rolled.** Expanding an IPv6 address correctly, with its
 * compressed zero runs and embedded IPv4 forms, is exactly the sort of code
 * that looks right and has a bypass in it. `ipaddr.js` does that job, is used
 * by Express for the same purpose, and knows the special-range registry.
 *
 * // TODO: security review — fetches user-supplied URLs
 */

import ipaddr from "ipaddr.js";

/**
 * The one category worth talking to.
 *
 * Everything else `ipaddr.js` can report — `loopback`, `private`, `linkLocal`,
 * `uniqueLocal`, `carrierGradeNat`, `multicast`, `broadcast`, `reserved`,
 * `unspecified`, `6to4`, `teredo`, `ipv4Mapped`, `rfc6052`, `rfc6145` — is
 * refused.
 *
 * `ipv4Mapped` is refused along with the rest even though `::ffff:93.184.x.x`
 * describes a perfectly ordinary public address. Name resolution returns plain
 * IPv4 for an A record, so a mapped address arriving here means something
 * unusual is going on, and unwrapping it would add a branch to the one function
 * that must not have a subtle branch in it.
 */
const ALLOWED_RANGE = "unicast";

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) {
    return false;
  }

  return ipaddr.parse(address).range() === ALLOWED_RANGE;
}

/**
 * Why an address was refused, for the log.
 *
 * Never shown to the person who submitted the URL: "this resolved to a
 * loopback address" confirms what their probe hit, which is the reconnaissance
 * step of the attack this file exists to stop.
 */
export function describeAddress(address: string): string {
  if (!ipaddr.isValid(address)) {
    return "not an IP address";
  }

  return ipaddr.parse(address).range();
}
