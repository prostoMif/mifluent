/**
 * The job-board connector: public postings from Greenhouse, Lever and Ashby.
 *
 * Hiring is one of the clearest signals a competitor gives off — a first
 * payments engineer, a country manager for Germany — and these three boards
 * publish postings as JSON without a key. Nothing else is supported: a careers
 * page without one of them is watched as a page diff instead.
 *
 * The locator may be either the board a person sees (`jobs.lever.co/acme`) or
 * the API address discovery found (`api.lever.co/v0/postings/acme`). Both are
 * reduced to a provider and a board token, and the API address is rebuilt from
 * those — the connector never fetches a host it did not choose itself.
 *
 * Responses are parsed with Zod. The formats were checked against live boards
 * of each provider; a board whose answer does not fit is a source failure, not
 * something to guess around.
 *
 * Nothing here touches the database. The caller decides what to store.
 *
 * // TODO: security review — fetches a user-supplied URL
 */

import { AppError, httpUrlSchema, parseOrThrow } from "@mifluent/core";
import { z } from "zod";
import { htmlToText } from "../feeds/html-text.js";
import { fingerprintItem } from "../feeds/identity.js";
import { decodeXmlEntities } from "../feeds/xml-entities.js";
import { safeFetch } from "../http/safe-fetch.js";

export const atsLocatorSchema = httpUrlSchema;

export type AtsProvider = "greenhouse" | "lever" | "ashby";

export interface PolledItem {
  readonly fingerprint: string;
  readonly externalId: string;
  readonly url: string | null;
  readonly title: string;
  readonly author: string | null;
  readonly content: string;
  readonly publishedAt: Date | null;
  readonly metadata: Record<string, unknown>;
}

/** What is remembered between polls, so a posting that disappears can be named. */
export interface KnownJob {
  readonly id: string;
  readonly title: string;
}

export interface AtsPollOptions {
  readonly boardUrl: string;
  readonly userAgent: string;
  /** Postings seen on the previous poll. Absent on the first one. */
  readonly previousJobs?: readonly KnownJob[] | undefined;
  readonly now?: Date | undefined;
}

export interface AtsPollResult {
  readonly items: readonly PolledItem[];
  /** Store this and pass it back as `previousJobs` next time. */
  readonly currentJobs: readonly KnownJob[];
  readonly closedItems: readonly PolledItem[];
}

interface Board {
  readonly provider: AtsProvider;
  readonly token: string;
}

interface Posting {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly department: string | null;
  readonly location: string | null;
  readonly description: string;
  readonly publishedAt: Date | null;
}

/** Enough for a posting to be judged; the rest of a long description is benefits boilerplate. */
const MAX_CONTENT_LENGTH = 4_000;

/** A large company's board is a few hundred postings; two megabytes is generous. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const FIRST_ERROR_STATUS = 400;

/** Board tokens are slugs. Anything else in that position is not a board. */
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Where a token sits in each address shape, by exact host. Exact rather than
 * `endsWith`, so `greenhouse.io.example.com` is not mistaken for Greenhouse.
 */
const TOKEN_POSITION: Readonly<Record<string, { provider: AtsProvider; segment: number }>> = {
  "boards.greenhouse.io": { provider: "greenhouse", segment: 0 },
  "job-boards.greenhouse.io": { provider: "greenhouse", segment: 0 },
  "job-boards.eu.greenhouse.io": { provider: "greenhouse", segment: 0 },
  "boards-api.greenhouse.io": { provider: "greenhouse", segment: 2 },
  "jobs.lever.co": { provider: "lever", segment: 0 },
  "api.lever.co": { provider: "lever", segment: 2 },
  "jobs.ashbyhq.com": { provider: "ashby", segment: 0 },
  "api.ashbyhq.com": { provider: "ashby", segment: 2 },
};

const API_URL: Readonly<Record<AtsProvider, (token: string) => string>> = {
  greenhouse: (token) => `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
  lever: (token) => `https://api.lever.co/v0/postings/${token}?mode=json`,
  ashby: (token) => `https://api.ashbyhq.com/posting-api/job-board/${token}`,
};

const nullableText = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const greenhouseSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      title: z.string(),
      absolute_url: nullableText,
      updated_at: nullableText,
      location: z.object({ name: nullableText }).nullish(),
      content: z.string().nullish(),
      departments: z.array(z.object({ name: z.string() })).nullish(),
    }),
  ),
});

const leverSchema = z.array(
  z.object({
    id: z.string(),
    /** Lever calls the job title `text`. */
    text: z.string(),
    hostedUrl: nullableText,
    createdAt: z.number().nullish(),
    descriptionPlain: z.string().nullish(),
    categories: z
      .object({ location: nullableText, team: nullableText, department: nullableText })
      .nullish(),
  }),
);

const ashbySchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      jobUrl: nullableText,
      department: nullableText,
      location: nullableText,
      publishedAt: nullableText,
      isListed: z.boolean().nullish(),
      descriptionPlain: z.string().nullish(),
      descriptionHtml: z.string().nullish(),
    }),
  ),
});

export async function pollAtsBoard(options: AtsPollOptions): Promise<AtsPollResult> {
  const board = readBoard(parseOrThrow(atsLocatorSchema, options.boardUrl));
  const now = options.now ?? new Date();

  const response = await safeFetch({
    url: API_URL[board.provider](board.token),
    userAgent: options.userAgent,
    maxBytes: MAX_RESPONSE_BYTES,
  });

  if (response.status >= FIRST_ERROR_STATUS) {
    throw new AppError("source_unreachable", "That job board answered with an error.", {
      provider: board.provider,
      httpStatus: response.status,
    });
  }

  const postings = parsePostings(board.provider, response.body);
  const boardKey = `${board.provider}:${board.token}`;
  const items = postings.map((posting) => toItem(posting, board, boardKey));
  const currentJobs = postings.map((posting) => ({
    id: externalIdOf(board.provider, posting.id),
    title: posting.title,
  }));

  const stillOpen = new Set(currentJobs.map((job) => job.id));
  const closedItems = (options.previousJobs ?? [])
    .filter((job) => !stillOpen.has(job.id))
    .map((job) => toClosedItem(job, board.provider, boardKey, now));

  return { items, currentJobs, closedItems };
}

/** Provider and token from any supported address, or a refusal. */
export function readBoard(locator: string): Board {
  const url = new URL(locator);
  const position = TOKEN_POSITION[url.hostname.toLowerCase()];

  if (position === undefined) {
    throw new AppError(
      "source_unsupported",
      "Only Greenhouse, Lever and Ashby job boards can be read.",
      { host: url.hostname },
    );
  }

  const token = url.pathname.split("/").filter(Boolean)[position.segment];

  if (token === undefined || !TOKEN_PATTERN.test(token)) {
    throw new AppError("source_unsupported", "That address does not name a job board.", {
      provider: position.provider,
    });
  }

  return { provider: position.provider, token };
}

function parsePostings(provider: AtsProvider, body: Buffer): Posting[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf-8"));
  } catch {
    throw new AppError("source_unsupported", "That job board did not answer with JSON.", {
      provider,
    });
  }

  switch (provider) {
    case "greenhouse":
      return readGreenhouse(payload);
    case "lever":
      return readLever(payload);
    case "ashby":
      return readAshby(payload);
  }
}

function readGreenhouse(payload: unknown): Posting[] {
  const { jobs } = parseBoard(greenhouseSchema, payload, "greenhouse");
  return jobs.map((job) => ({
    id: String(job.id),
    title: job.title,
    url: job.absolute_url,
    department: job.departments?.[0]?.name ?? null,
    location: job.location?.name ?? null,
    // Greenhouse escapes the HTML inside its JSON, so it is decoded to
    // markup first and only then reduced to text.
    description: htmlToText(decodeXmlEntities(job.content ?? "")),
    publishedAt: toDate(job.updated_at),
  }));
}

function readLever(payload: unknown): Posting[] {
  const postings = parseBoard(leverSchema, payload, "lever");
  return postings.map((job) => ({
    id: job.id,
    title: job.text,
    url: job.hostedUrl,
    department: job.categories?.team ?? job.categories?.department ?? null,
    location: job.categories?.location ?? null,
    description: job.descriptionPlain ?? "",
    publishedAt:
      job.createdAt === null || job.createdAt === undefined ? null : new Date(job.createdAt),
  }));
}

function readAshby(payload: unknown): Posting[] {
  const { jobs } = parseBoard(ashbySchema, payload, "ashby");
  return jobs
    .filter((job) => job.isListed !== false)
    .map((job) => ({
      id: job.id,
      title: job.title,
      url: job.jobUrl,
      department: job.department,
      location: job.location,
      description: job.descriptionPlain ?? htmlToText(job.descriptionHtml ?? null),
      publishedAt: toDate(job.publishedAt),
    }));
}

function parseBoard<T>(schema: z.ZodType<T>, payload: unknown, provider: AtsProvider): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new AppError("source_unsupported", "That job board answered in an unexpected format.", {
      provider,
      issues: result.error.issues.slice(0, 5),
    });
  }
  return result.data;
}

function toItem(posting: Posting, board: Board, boardKey: string): PolledItem {
  const externalId = externalIdOf(board.provider, posting.id);
  const content = [
    posting.department === null ? null : `Department: ${posting.department}`,
    posting.location === null ? null : `Location: ${posting.location}`,
    posting.description,
  ]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join("\n\n")
    .slice(0, MAX_CONTENT_LENGTH);

  return {
    fingerprint: fingerprintItem({
      externalId,
      url: posting.url,
      title: posting.title,
      content,
      feedUrl: boardKey,
    }),
    externalId,
    url: posting.url,
    title: posting.title,
    author: null,
    content,
    publishedAt: posting.publishedAt,
    metadata: {
      provider: board.provider,
      department: posting.department,
      location: posting.location,
    },
  };
}

function toClosedItem(
  job: KnownJob,
  provider: AtsProvider,
  boardKey: string,
  now: Date,
): PolledItem {
  const externalId = `closed-${job.id}`;
  const title = `Closed: ${job.title}`;
  const content = `The posting "${job.title}" is no longer listed on the job board.`;

  return {
    // The date is part of the identity: a role closed, reopened and closed
    // again is two events, and must not be swallowed as a duplicate.
    fingerprint: fingerprintItem({
      externalId: `${externalId}:${now.toISOString().slice(0, 10)}`,
      url: null,
      title,
      content,
      feedUrl: boardKey,
    }),
    externalId,
    url: null,
    title,
    author: null,
    content,
    publishedAt: now,
    metadata: { provider, closed: true, originalExternalId: job.id },
  };
}

function externalIdOf(provider: AtsProvider, id: string): string {
  const prefix = provider === "greenhouse" ? "gh" : provider === "lever" ? "lv" : "ab";
  return `${prefix}-${id}`;
}

function toDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
