/**
 * The example brief on the landing page. The competitors are invented, so
 * their quotes can be shown without putting words in a real company's mouth;
 * the two "market & rules" cards point at the real pages they are about and
 * carry no quote. Everything here is labelled "Example" where it is shown.
 */

import type { EventCardProps } from "./event-card";

export const HERO_CARD: EventCardProps = {
  kind: "price",
  target: "Northwind CRM",
  was: "$29",
  became: "$39 / seat",
  fact: "Raised the Team plan by a third and moved SSO up to Business.",
  quote: "Team is now $39 per seat per month, billed annually. SSO is included in Business.",
  why: "Your Team plan is now $10 cheaper than theirs — worth saying on your pricing page.",
  source: { label: "northwind.example/pricing", url: "https://example.com/pricing" },
  age: "changed yesterday",
  showActions: true,
};

export const DIGEST_CARDS: readonly EventCardProps[] = [
  {
    kind: "price",
    target: "Contoso Forms",
    was: "Free up to 1,000 responses",
    became: "Free up to 100",
    fact: "Cut the free plan tenfold; paid plans unchanged.",
    quote: "The Free plan now includes 100 responses per month.",
    why: "Their free users will be looking for somewhere to go this week.",
    source: { label: "contoso.example/pricing", url: "https://example.com/pricing" },
    age: "changed yesterday",
    showActions: true,
  },
  {
    kind: "feature",
    target: "Acme Analytics",
    fact: "Launched a free tier with 10,000 events a month.",
    quote: "Starting today, everyone gets 10k events per month free, forever.",
    why: "Your trial is the only free way in today; theirs no longer ends.",
    source: { label: "acme.example/changelog", url: "https://example.com/changelog" },
    age: "2 days ago",
  },
  {
    kind: "mention",
    target: "Your brand",
    fact: "Named in a comparison post on a top marketing blog — next to two competitors.",
    quote: "…for small teams, the cheapest of the three is the one we'd pick.",
    source: { label: "blog.example/best-tools", url: "https://example.com/blog" },
    age: "today",
  },
];

export const MARKET_CARDS: readonly EventCardProps[] = [
  {
    kind: "rule",
    target: "Apple App Store",
    fact: "App Review Guidelines updated: new rules for subscriptions and external purchase links.",
    effective: "on the date in Apple\u2019s notice",
    why: "If you sell in-app, check your paywall copy before the next submission.",
    source: {
      label: "developer.apple.com/app-store/review/guidelines",
      url: "https://developer.apple.com/app-store/review/guidelines/",
    },
    age: "example",
  },
  {
    kind: "rule",
    target: "European Union",
    fact: "AI Act: obligations for general-purpose AI providers begin to apply.",
    effective: "in stages from 2025",
    why: "If your product calls a model, you may need to tell users they are talking to AI.",
    source: {
      label: "digital-strategy.ec.europa.eu",
      url: "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai",
    },
    age: "example",
  },
];
