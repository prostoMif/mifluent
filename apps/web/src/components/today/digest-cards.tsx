/**
 * A built digest, as the web and the Mini App show it — the same cards
 * Telegram gets, in the profile's language, grouped the same way: the
 * profile's own news first, then "your market & rules".
 *
 * Everything shown came from someone else's page or from a model; React
 * escapes it, and links are rendered only from addresses the digest builder
 * already checked, with `rel="noopener noreferrer nofollow"` (docs/security.md).
 */

import { formatPeriod, stringsFor } from "@mifluent/delivery";
import type { DigestBlockView, DigestCardView, DigestView } from "@mifluent/digest";
import Link from "next/link";
import { type CardActionLabels, CardActions } from "./card-actions";
import styles from "./today.module.css";

type Strings = ReturnType<typeof stringsFor>;

export interface DigestCardsProps {
  readonly digest: DigestView;
  readonly canAct: boolean;
  readonly timezone: string;
}

export function DigestCards({ digest, canAct, timezone }: DigestCardsProps) {
  const strings = stringsFor(digest.language);
  const main = digest.cards.filter((card) => card.section === "main");
  const market = digest.cards.filter((card) => card.section === "market");
  const labels = actionLabels(strings);
  const summary = summarise(digest, strings);

  return (
    <section aria-label={digest.isUrgent ? strings.urgentTitle(digest.profileName) : "Digest"}>
      <header className={styles["digestHeader"]}>
        <p className={styles["period"]}>
          {digest.isUrgent ? `${strings.urgentTitle("").replace(/\s—\s$/, "")} · ` : ""}
          {formatPeriod(digest.periodStart, digest.periodEnd, digest.language, timezone)}
        </p>
        {summary === "" ? null : <p className={styles["summary"]}>{summary}</p>}
      </header>

      {digest.notices.map((notice) => (
        <p
          className={styles["notice"]}
          key={notice.code === "target_quiet" ? notice.targetName : notice.code}
        >
          {notice.code === "target_quiet"
            ? strings.notices.targetQuiet(notice.targetName)
            : notice.code === "cost_cap_reached"
              ? strings.notices.costCapReached
              : strings.notices.baselineRecorded}
        </p>
      ))}

      {digest.cards.length === 0 ? (
        <EmptyDigest digest={digest} strings={strings} timezone={timezone} />
      ) : (
        <>
          <CardList cards={main} canAct={canAct} strings={strings} labels={labels} />
          {market.length === 0 ? null : (
            <>
              <h2 className={styles["sectionTitle"]}>{strings.marketSection}</h2>
              <CardList cards={market} canAct={canAct} strings={strings} labels={labels} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function CardList(props: {
  readonly cards: readonly DigestCardView[];
  readonly canAct: boolean;
  readonly strings: Strings;
  readonly labels: CardActionLabels;
}) {
  if (props.cards.length === 0) return null;
  return (
    <ol className={styles["cards"]}>
      {props.cards.map((card) => (
        <DigestCard
          card={card}
          canAct={props.canAct}
          key={card.id}
          strings={props.strings}
          labels={props.labels}
        />
      ))}
    </ol>
  );
}

const KIND_CLASS: Readonly<Record<string, string>> = {
  price: "kindPrice",
  plan: "kindPrice",
  policy: "kindRule",
  market_rule: "kindRule",
  feature: "kindFeature",
};

function DigestCard(props: {
  readonly card: DigestCardView;
  readonly canAct: boolean;
  readonly strings: Strings;
  readonly labels: CardActionLabels;
}) {
  const { card, strings } = props;
  const kindClass =
    card.targetKind === "self" ? "kindMention" : (KIND_CLASS[card.eventKind ?? ""] ?? "");
  const headline =
    card.kind === "group"
      ? card.targetKind === "self"
        ? strings.selfGroupHeadline(card.blocks.length + card.moreCount)
        : strings.groupHeadline(card.headline, card.blocks.length + card.moreCount)
      : card.headline;

  return (
    <li
      className={`${styles["card"]} ${kindClass === "" ? "" : styles[kindClass]} ${card.isUrgent ? styles["cardUrgent"] : ""}`}
    >
      <div className={styles["cardHead"]}>
        <h3 className={styles["headline"]}>{headline}</h3>
        {card.eventKind === null ? null : (
          <span className={styles["badge"]}>{strings.kindLabel(card.eventKind)}</span>
        )}
      </div>
      {card.blocks.map((block, index) => (
        <Block block={block} key={`${card.id}-${index}`} strings={strings} />
      ))}
      <p className={styles["cardFoot"]}>
        {card.ageDays === null ? null : <span>{strings.age(card.ageDays)}</span>}
        {card.moreCount > 0 ? <span>{strings.more(card.moreCount)}</span> : null}
        {card.targetId !== null && card.targetKind !== "self" ? (
          <Link href={`/targets/${card.targetId}`}>{strings.buttons.openTarget}</Link>
        ) : null}
      </p>
      {props.canAct ? <CardActions cardId={card.id} labels={props.labels} /> : null}
    </li>
  );
}

function Block({ block, strings }: { readonly block: DigestBlockView; readonly strings: Strings }) {
  switch (block.kind) {
    case "fact":
      return (
        <div className={styles["fact"]}>
          <p>{block.content}</p>
          {block.quote === null ? null : (
            <blockquote className={styles["quote"]}>
              {block.quote}
              {block.sourceUrl === null ? null : (
                <>
                  {" "}
                  <a href={block.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
                    {strings.source}
                  </a>
                </>
              )}
            </blockquote>
          )}
          {block.quote === null && block.sourceUrl !== null ? (
            <a href={block.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
              {strings.source}
            </a>
          ) : null}
        </div>
      );
    case "implication":
      return (
        <p className={styles["implication"]}>
          <strong>{strings.whyItMatters}</strong> {block.content}
        </p>
      );
    case "model_interpretation":
      return (
        <p className={styles["interpretation"]}>
          <strong>{strings.modelInterpretation}:</strong> {block.content}
        </p>
      );
    case "analyst_opinion":
      return <p className={styles["implication"]}>{block.content}</p>;
  }
}

function EmptyDigest(props: {
  readonly digest: DigestView;
  readonly strings: Strings;
  readonly timezone: string;
}) {
  const { digest, strings } = props;
  const period = formatPeriod(
    digest.periodStart,
    digest.periodEnd,
    digest.language,
    props.timezone,
  );
  return (
    <div className={styles["empty"]}>
      <p className={styles["emptyText"]}>
        {strings.emptyDigest(period, digest.sourcesChecked, digest.itemsConsidered)}
      </p>
      {digest.nearMisses.length === 0 ? null : (
        <>
          <p className={styles["period"]}>{strings.closest}</p>
          <ul className={styles["misses"]}>
            {digest.nearMisses.map((miss) => (
              <li key={`${miss.title}-${miss.reason}`}>
                {miss.url === null ? (
                  miss.title || "—"
                ) : (
                  <a href={miss.url} rel="noopener noreferrer nofollow" target="_blank">
                    {miss.title || "—"}
                  </a>
                )}{" "}
                — {strings.rejectedBecause} {strings.rejectionReason(miss.reason)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function summarise(digest: DigestView, strings: Strings): string {
  if (digest.isUrgent || digest.cards.length === 0) return "";
  const main = digest.cards.filter((card) => card.section === "main");
  const changes = main.reduce(
    (sum, card) =>
      sum + Math.max(1, card.blocks.filter((b) => b.kind === "fact").length) + card.moreCount,
    0,
  );
  const targets = new Set(main.map((card) => card.targetId ?? card.id)).size;
  return strings.summary(changes, targets, digest.cards.length - main.length);
}

function actionLabels(strings: Strings): CardActionLabels {
  return {
    buttons: {
      not_following_target: strings.buttons.notFollowing,
      not_important: strings.buttons.notImportant,
      saved: strings.buttons.save,
      influenced: strings.buttons.influenced,
    },
    done: strings.callback.recorded,
  };
}
