/**
 * Set an account's password from the server console.
 *
 * The recovery path that does not involve email. An instance with no SMTP
 * settings — which is every instance on its first day — has no other way back
 * in once somebody forgets their password, and "reinstall it" is not an answer
 * anybody should have to give.
 *
 * Usage, from the repository root:
 *
 *   npm run account:set-password -- someone@example.com
 *
 * The password is typed in, never passed as an argument: an argument ends up in
 * the shell history and in the process list, where every other user on the
 * machine can read it.
 *
 * Hashing and storage go through Better Auth's own context rather than writing
 * to the accounts table directly. The library decides how a password is hashed,
 * and a second implementation here would be a second thing to get wrong — and
 * would silently stop matching if the library ever changed algorithm.
 *
 * // TODO: security review — authentication, credential handling
 */

import { parseOrThrow } from "@mifluent/core";
import { emailSchema, passwordSchema } from "@mifluent/domain/schemas";
import { getAuth } from "../src/lib/auth";

/** Better Auth's name for an email-and-password login. */
const CREDENTIAL_PROVIDER_ID = "credential";

const EXIT_FAILURE = 1;

/*
 * Control characters by code point rather than by escape sequence. `\u007f` in
 * a source file is a character nobody can see when they read the line; the
 * number and the name together say what it is.
 */
const END_OF_TEXT = 3;
const BACKSPACE = 8;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const DELETE = 127;

const NEWLINE = String.fromCharCode(LINE_FEED);

function say(line: string): void {
  process.stdout.write(line + NEWLINE);
}

function fail(line: string): never {
  process.stderr.write(line + NEWLINE);
  process.exit(EXIT_FAILURE);
}

/** What a keypress means while a password is being typed. */
type KeyAction = "submit" | "cancel" | "erase" | "append";

function classify(character: string): KeyAction {
  const code = character.charCodeAt(0);

  if (code === CARRIAGE_RETURN || code === LINE_FEED) return "submit";
  // Ctrl+C. Raw mode swallows the usual interrupt, so it is handled here or
  // the terminal is left stuck with its echo turned off.
  if (code === END_OF_TEXT) return "cancel";
  if (code === DELETE || code === BACKSPACE) return "erase";
  return "append";
}

/**
 * Stdin is a pipe rather than a terminal. There is nothing to echo and nothing
 * to hide, so the first line is taken as-is — which is what makes this usable
 * from a provisioning script.
 */
async function readPipedLine(): Promise<string> {
  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return chunks.join("").split(NEWLINE)[0]?.trim() ?? "";
}

/**
 * Read one line from a terminal without printing it back.
 *
 * Raw mode rather than the muted-readline trick, which reaches into a private
 * field of Node's readline and breaks whenever that field changes.
 */
async function readHiddenLine(): Promise<string> {
  const { stdin } = process;

  return new Promise((resolve, reject) => {
    let typed = "";

    const stop = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write(NEWLINE);
    };

    function onData(chunk: string): void {
      for (const character of chunk) {
        const action = classify(character);

        if (action === "submit") {
          stop();
          resolve(typed);
          return;
        }

        if (action === "cancel") {
          stop();
          reject(new Error("Cancelled."));
          return;
        }

        typed = action === "erase" ? typed.slice(0, -1) : typed + character;
      }
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

async function readSecretLine(): Promise<string> {
  return process.stdin.isTTY ? readHiddenLine() : readPipedLine();
}

async function main(): Promise<void> {
  const [rawEmail] = process.argv.slice(2);

  if (rawEmail === undefined) {
    fail("Usage: npm run account:set-password -- someone@example.com");
  }

  const email = parseOrThrow(emailSchema, rawEmail);
  const context = await getAuth().$context;
  const found = await context.internalAdapter.findUserByEmail(email);

  if (found === null) {
    // Said plainly, unlike on the sign-in screen. Whoever is running this is
    // already on the server; there is nobody left to hide the answer from.
    fail(`No account with the address ${email}.`);
  }

  process.stdout.write("New password: ");
  const password = parseOrThrow(passwordSchema, await readSecretLine());

  process.stdout.write("Repeat it: ");
  const confirmation = await readSecretLine();

  if (password !== confirmation) {
    fail("The two passwords do not match. Nothing was changed.");
  }

  const hashedPassword = await context.password.hash(password);
  const accounts = await context.internalAdapter.findAccounts(found.user.id);
  const hasCredentialAccount = accounts.some(
    (account) => account.providerId === CREDENTIAL_PROVIDER_ID,
  );

  // An account created through a social provider has no password row to update.
  if (hasCredentialAccount) {
    await context.internalAdapter.updatePassword(found.user.id, hashedPassword);
  } else {
    await context.internalAdapter.createAccount({
      userId: found.user.id,
      providerId: CREDENTIAL_PROVIDER_ID,
      accountId: found.user.id,
      password: hashedPassword,
    });
  }

  // Same rule as a reset by email: everyone else signed in is signed out.
  await context.internalAdapter.deleteUserSessions(found.user.id);

  say(`Password changed for ${email}. Every other session has been signed out.`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    fail(error instanceof Error ? error.message : "Something went wrong.");
  });
