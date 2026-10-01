# Source packs

Shared sources that many businesses need and nobody should poll twice: a
marketplace's rules, a tax authority's notices, a niche's trade press. Each
`.yaml` file here is one pack. The worker fetches a pack's sources once, and
every profile the pack applies to gets the material judged for its own
business — the same relevance check and the same quoted cards as its own
sources.

A profile follows a pack when **all** of these hold:

1. the pack's `market` is the profile's market (`ru` or `en`);
2. one of the profile's countries is in `countries` (`["*"]` = every country of
   the market) — which country is decided by `applies_to`;
3. `regions` is empty, or contains the profile's region;
4. `niches` is empty, or shares a niche with the profile;
5. `applies_when` is empty, or the profile uses one of `platforms_any`, or is in
   one of `niches_any`.

Niches are detected from the profile's description with the dictionary in
`packages/domain/src/packs/niches.ts`.

## Format

```yaml
# One line on what this pack is for.
key: ru.platforms.wildberries        # market + 2–4 parts, unique
title:
  ru: "Wildberries — правила и комиссии для продавцов"
  en: "Wildberries — seller rules and fees"
market: ru                           # ru | en
countries: [RU]                      # ISO 3166-1 alpha-2, or ["*"]
regions: []                          # ISO 3166-2, e.g. RU-MOW; empty = whole country
applies_to: sales                    # home | sales | any
kind: platform                       # platform | regulator | media | niche_media | events
niches: []                           # keys from niches.ts; empty = every niche
applies_when:
  platforms_any: [wildberries]       # matched against the profile's platforms
  niches_any: []
sources:
  - label: "Новости о правилах для продавцов"
    type: query                      # feed | query (both RSS/Atom) | diff (page text)
    url: "https://…"
    interval_minutes: 180            # 60 … 10080
    # broken: "HTTP 403 since 2026-10-01"   # set by hand to take a source out
max_cards_per_digest: 3              # 1 … 6
```

`applies_to` decides which of the profile's countries count:

- `home` — where the person lives or the business is registered: taxes, rules
  for sole traders, currency control.
- `sales` — where the business sells: marketplaces, consumer protection.
- `any` — either.

`platform` and `regulator` packs are judged before general news; a `diff`
source in any pack skips the similarity filter, because following the pack
already says the page matters.

## Adding or changing a pack

```bash
npm run packs:verify   # fetches every source once; non-zero exit if any failed
npm run packs:sync     # writes the catalogue and sources into the database
```

`packs:verify` must pass before a pull request is merged. A source that stops
answering is marked `broken: <reason>` in its file rather than deleted, so the
history of what was tried stays visible. `packs:sync` is idempotent: run it
after every deploy that touches this directory. A pack whose file is removed
has its sources paused, not deleted, so cards already built from them keep
their links.
