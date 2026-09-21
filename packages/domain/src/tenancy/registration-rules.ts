/**
 * Who is allowed to create an account on this instance.
 *
 * The rule, in one sentence: the first person to register owns the instance,
 * and after that registration is shut unless the operator deliberately opens it.
 *
 * Why it works this way. A self-hosted instance is reachable on the internet
 * from the moment it starts, and the gap between "container is up" and "owner
 * has signed up" is where a stranger walks in and takes it. Leaving sign-up
 * open by default and asking people to close it afterwards means the instances
 * that get taken are exactly the ones run by people who did not read that far.
 *
 * `REGISTRATION_OPEN` therefore defaults to false, in `packages/core/config.ts`.
 *
 * Pure, and in its own file, so that the decision can be tested — and read by a
 * browser — without a database anywhere near it.
 *
 * // TODO: security review — authentication
 */

import { AppError } from "@mifluent/core";

export interface RegistrationRules {
  /** Whether anybody has signed up yet. */
  readonly hasAnyAccount: boolean;
  /** From `REGISTRATION_OPEN`. */
  readonly isRegistrationOpen: boolean;
  /**
   * Whether this particular request carries a valid invitation for the address
   * it is trying to register.
   *
   * The reason invitations exist: `REGISTRATION_OPEN` admits one person by
   * opening the door to everybody who knows the address, for as long as it is
   * on. This admits one named person once.
   */
  readonly hasValidInvitation?: boolean | undefined;
}

export function assertRegistrationAllowed(rules: RegistrationRules): void {
  if (!rules.hasAnyAccount) {
    return;
  }

  if (rules.hasValidInvitation === true) {
    return;
  }

  if (rules.isRegistrationOpen) {
    return;
  }

  throw new AppError(
    "forbidden",
    "Registration is closed on this instance. Ask whoever runs it for an invitation.",
  );
}
