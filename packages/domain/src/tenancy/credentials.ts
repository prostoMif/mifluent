/**
 * What counts as a valid email address, password and display name.
 *
 * One definition, used in three places: the Better Auth options, the browser
 * form, and any server route that takes credentials. The failure this prevents
 * is mundane and common — a form that accepts a ten-character password and a
 * server that rejects it, leaving the person staring at an error they cannot
 * read.
 *
 * // TODO: security review — authentication
 */

import { z } from "zod";

/**
 * Length is the only rule. Composition requirements — a digit, a symbol, a
 * capital — measurably push people towards `Password1!` and away from a long
 * phrase, which is the opposite of what they are for. Twelve is the floor
 * because eight is now cheap to brute-force offline.
 */
export const MINIMUM_PASSWORD_LENGTH = 12;

/**
 * An upper bound exists only so that a megabyte of text cannot be fed to the
 * password hasher, which is deliberately slow and would happily chew on it.
 */
export const MAXIMUM_PASSWORD_LENGTH = 256;

export const MAXIMUM_NAME_LENGTH = 120;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter an email address."));

export const passwordSchema = z
  .string()
  .min(MINIMUM_PASSWORD_LENGTH, `Use at least ${MINIMUM_PASSWORD_LENGTH} characters.`)
  .max(MAXIMUM_PASSWORD_LENGTH, "That password is too long.");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(MAXIMUM_NAME_LENGTH, "That name is too long.");

export const signUpSchema = z.object({
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: an old account may predate a change to the minimum,
  // and refusing to even attempt the sign-in would lock that person out of the
  // reset flow as well.
  password: z.string().min(1, "Enter your password."),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
