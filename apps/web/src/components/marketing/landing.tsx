/**
 * mifluent.com: the hosted service's front page. English only — Russian
 * readers are pointed at the bot in one line. Mobile first.
 */

import { EARLY_PRO_TABLE, PRICE_TABLE } from "@mifluent/domain/billing/pricing";
import Link from "next/link";
import { EventCard } from "./event-card";
import { DIGEST_CARDS, HERO_CARD, MARKET_CARDS } from "./examples";
import styles from "./landing.module.css";
import { ThemeToggle } from "./theme-toggle";

export interface LandingProps {
  readonly botUsername: string | undefined;
  readonly githubStars: number | null;
  readonly earlySeatsLeft: number;
  readonly contactEmail: string | undefined;
}

const GITHUB_URL = "https://github.com/prostoMif/mifluent";

export function Landing({ botUsername, githubStars, earlySeatsLeft, contactEmail }: LandingProps) {
  return (
    <div className={styles["page"]}>
      <nav className={styles["nav"]} aria-label="Main">
        <Link href="/" className={styles["logo"]}>
          Mifluent
        </Link>
        <div className={styles["navLinks"]}>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link href="/changes">Radar</Link>
          <Link href="/sign-in">Sign in</Link>
          <ThemeToggle />
        </div>
      </nav>

      <header className={styles["hero"]}>
        <div className={styles["heroText"]}>
          <h1 className={styles["title"]}>
            Know when a competitor changes prices — the next morning, not three weeks later.
          </h1>
          <p className={styles["lead"]}>
            Give Mifluent your website. It finds your competitors, the platforms you depend on and
            the rules that apply to you — and every morning sends a short brief of what changed,
            each line quoted from the source.
          </p>
          <form className={styles["siteForm"]} action="/start" method="get">
            <label htmlFor="hero-site" className={styles["srOnly"]}>
              Your website
            </label>
            <input
              id="hero-site"
              name="site"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="yourcompany.com"
              className={styles["siteInput"]}
            />
            <button type="submit" className={styles["primary"]}>
              See who to watch — free
            </button>
          </form>
          <p className={styles["small"]}>
            Free plan, no card. By email, Telegram or in the app.
            {botUsername === undefined ? null : (
              <>
                {" "}
                По-русски — <a href={`https://t.me/${botUsername}`}>в Telegram</a>.
              </>
            )}
          </p>
        </div>
        <div className={styles["heroCard"]}>
          <p className={styles["caption"]}>Example card from a morning brief</p>
          <EventCard {...HERO_CARD} />
        </div>
      </header>

      <section id="how" className={styles["section"]} aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol className={styles["steps"]}>
          <li>
            <span className={styles["stepNumber"]}>1</span>
            <h3>Type your site</h3>
            <p>Mifluent reads it and works out what you sell, to whom, and where.</p>
          </li>
          <li>
            <span className={styles["stepNumber"]}>2</span>
            <h3>Check who it found</h3>
            <p>
              Competitors, the platforms you sell on, the rules of your country. Untick anything
              wrong, add what is missing.
            </p>
          </li>
          <li>
            <span className={styles["stepNumber"]}>3</span>
            <h3>Read it with your coffee</h3>
            <p>
              Each morning: only what changed and why it matters to you. A quiet day says so in one
              line.
            </p>
          </li>
        </ol>
      </section>

      <section className={styles["section"]} aria-labelledby="digest-title">
        <h2 id="digest-title">A morning brief</h2>
        <p className={styles["sectionLead"]}>
          Example — the competitors here are made up; the format is exactly what arrives.
        </p>
        <div className={styles["digest"]}>
          {DIGEST_CARDS.map((card) => (
            <EventCard key={card.target} {...card} />
          ))}
          <p className={styles["quiet"]}>
            Quiet at Contoso and Fabrikam · 34 sources checked since yesterday
          </p>
        </div>
      </section>

      <section className={styles["section"]} aria-labelledby="market-title">
        <h2 id="market-title">Your market &amp; rules</h2>
        <p className={styles["sectionLead"]}>
          Not only competitors: app stores, marketplaces and the law where you sell. Example cards.
        </p>
        <div className={styles["twoUp"]}>
          {MARKET_CARDS.map((card) => (
            <EventCard key={card.target} {...card} />
          ))}
        </div>
      </section>

      <section className={styles["section"]} aria-labelledby="why-title">
        <h2 id="why-title">Why not Google Alerts or ChatGPT</h2>
        <div className={styles["reasons"]}>
          <div>
            <h3>It finds what to watch</h3>
            <p>
              You do not list keywords. It reads your site and proposes the companies and rules.
            </p>
          </div>
          <div>
            <h3>It remembers last month</h3>
            <p>
              Pricing pages are compared with what they said before, so a quiet price rise shows up
              as “was → became”.
            </p>
          </div>
          <div>
            <h3>Every line has its source</h3>
            <p>
              Each fact carries a word-for-word quote and a link. If the quote is not on the page,
              the fact is dropped.
            </p>
          </div>
        </div>
      </section>

      <section id="pricing" className={styles["section"]} aria-labelledby="pricing-title">
        <h2 id="pricing-title">Pricing</h2>
        <div className={styles["plans"]}>
          <Plan name="Free" price="$0" note="forever" points={["3 competitors", "Weekly brief"]} />
          <Plan
            name="Starter"
            price={perMonth(PRICE_TABLE.USD.starter[12])}
            note="/ month, billed yearly"
            points={["7 competitors and platforms", "Daily brief", "Brand mentions"]}
          />
          <Plan
            name="Pro"
            price={perMonth(EARLY_PRO_TABLE.USD[12])}
            note={`/ month, billed yearly — early price, ${earlySeatsLeft} of 100 left`}
            points={["15 competitors and platforms", "Pages checked every 6 h", "Full history"]}
            isFeatured
          />
          <Plan
            name="Team"
            price={perMonth(PRICE_TABLE.USD.team[12])}
            note="/ month, billed yearly"
            points={["50 competitors", "Up to 5 businesses", "Reports for clients"]}
          />
        </div>
        <p className={styles["small"]}>
          Monthly, 3- and 6-month terms too — <Link href="/pricing">see all prices</Link>. Refund
          within 14 days, no questions.
        </p>
      </section>

      <section className={styles["section"]} aria-labelledby="oss-title">
        <h2 id="oss-title">Open source</h2>
        <p className={styles["sectionLead"]}>
          AGPL. Run it on your own server with Docker in about five minutes, with your own model
          key.
        </p>
        <a className={styles["secondary"]} href={GITHUB_URL} rel="noopener">
          GitHub{githubStars === null ? "" : ` · ★ ${githubStars}`}
        </a>
      </section>

      <section className={styles["section"]} aria-labelledby="faq-title">
        <h2 id="faq-title">Questions</h2>
        <div className={styles["faq"]}>
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className={styles["footer"]}>
        <span>© Mifluent</span>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/contacts">Contacts</Link>
        <a href={GITHUB_URL}>Self-host</a>
        {contactEmail === undefined ? null : <a href={`mailto:${contactEmail}`}>Contact</a>}
        {botUsername === undefined ? null : (
          <a href={`https://t.me/${botUsername}`} lang="ru">
            По-русски
          </a>
        )}
      </footer>
    </div>
  );
}

function Plan(props: {
  readonly name: string;
  readonly price: string;
  readonly note: string;
  readonly points: readonly string[];
  readonly isFeatured?: boolean;
}) {
  return (
    <div className={`${styles["plan"]} ${props.isFeatured === true ? styles["featured"] : ""}`}>
      <h3>{props.name}</h3>
      <p className={styles["price"]}>{props.price}</p>
      <p className={styles["priceNote"]}>{props.note}</p>
      <ul>
        {props.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}

function perMonth(yearly: number): string {
  const monthly = yearly / 12;
  return `$${Number.isInteger(monthly) ? monthly : monthly.toFixed(2).replace(/0$/, "")}`;
}

const FAQ: readonly { q: string; a: string }[] = [
  {
    q: "What does it watch?",
    a: "Public pages only: pricing and plan pages, changelogs and blogs, job boards, app store and payment platform policies, news about marketplace rules, and the regulators of your country. Nothing behind a login: a marketplace's own seller offer is followed through the news about it, not read from your seller account.",
  },
  {
    q: "Where do the sources come from?",
    a: "From your site: Mifluent reads it, names your competitors and the platforms you rely on, and checks where each one publishes changes. You can add or remove any of them.",
  },
  {
    q: "What happens to my data?",
    a: "Your profile and history are used only to build your brief. We do not sell or share them, there are no trackers on this site, and you can ask for everything to be deleted.",
  },
  {
    q: "Can I use my own model key?",
    a: "On a self-hosted instance, yes — any OpenAI-compatible API and key. The hosted service includes model costs in the price.",
  },
  {
    q: "How do I cancel?",
    a: "Plans are prepaid for a term and never renew on their own, so there is nothing to cancel. Within 14 days of paying you can ask for a refund.",
  },
  {
    q: "How is this different from Visualping or Changeflow?",
    a: "Visualping tells you a page changed; Changeflow summarises the change, but you bring the list of pages. Mifluent starts from your own site: it proposes who and what to watch, keeps only what matters to your business, and quotes the source for every line.",
  },
];
