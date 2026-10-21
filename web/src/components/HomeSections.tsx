import { IconCheck, IconGlobe, IconHourglass, IconLock, IconPalette, IconUsers, IconX } from './Icons';

// Static home page copy. src/seo.tsx renders it into index.html at build time for crawlers that do not run
// JavaScript, so nothing here may use hooks, the router or browser APIs. Keep the FAQ in sync with the
// FAQPage structured data in server/src/preview.ts.

const steps = [
  ['Create an event', 'Pick specific dates or days of the week and a time range. No account needed.'],
  ['Share the link', 'Send it to the group in any chat. Everyone adds their name and paints when they are free.'],
  ['Pick the best time', 'The live heatmap and ranked list show when the most people can make it.'],
];

const features = [
  [IconCheck, '"If needed" times', 'Mark times as available or only if needed, so you see real preferences instead of a yes or no.'],
  [IconUsers, 'Live group heatmap', 'Results update in real time as people respond, with the best times ranked for you.'],
  [IconGlobe, 'Timezone aware', 'Everyone sees the grid in their own timezone. Great for remote teams and friends abroad.'],
  [IconLock, 'Optional passwords', 'Protect your name so nobody else can change your row. The creator gets a private admin link.'],
  [IconHourglass, 'Deleted automatically', 'Events and responses are removed 1 to 6 months after the last date. No tracking, no ads.'],
  [IconPalette, '12 themes', 'From minimal to retro, each with light and dark modes. Works with touch on phones.'],
] as const;

// When2Meet facts checked October 2026: binary grid, ad supported, events cannot be renamed, no "pick the
// winner" ranking, and the desktop grid shrunk down on phones.
const comparison: [string, boolean | 'partial'][] = [
  ['Free, no sign-up', true],
  ['No ads', false],
  ['"If needed" availability', false],
  ['Ranked list of best times', false],
  ['Edit the event after creating it', false],
  ['Built for phones and touch', 'partial'],
  ['Open source and self-hostable', false],
];

export const faq = [
  ['Is Mutual free?', 'Yes. Mutual is free and open source, with no ads and no paid tier.'],
  ['Do participants need an account?', 'No. Anyone with the link adds their name and paints the times they are free. A name can optionally be protected with a password.'],
  ['How is Mutual different from When2Meet?', 'Mutual works the same way, with an "if needed" state, a live group heatmap, a ranked list of the best times, per-viewer timezones, touch support on phones and 12 themes.'],
  ['Does it handle time zones?', 'Yes. Each viewer sees the grid in their own timezone while the event stays defined in its own timezone.'],
  ['How long are events kept?', 'Events are deleted automatically 1 to 6 months after their last date, chosen when the event is created.'],
];

const useCases = ['Team meetings', 'Study groups', 'D&D and game nights', 'Club meetings', 'Band practice', 'Interviews', 'Family calls', 'Remote teams'];

const mark = (value: boolean | 'partial') =>
  value === 'partial' ? (
    <span className="m-home-partial">Limited</span>
  ) : value ? (
    <IconCheck size={18} className="m-home-yes" role="img" aria-hidden={false} aria-label="Yes" />
  ) : (
    <IconX size={18} className="m-home-no" role="img" aria-hidden={false} aria-label="No" />
  );

export function HomeHero() {
  return (
    <div className="m-hero">
      <div className="m-home-badges">
        <span className="m-badge is-accent">Free</span>
        <span className="m-badge">No sign-up</span>
        <span className="m-badge">Open source</span>
      </div>
      <h1>Find a time that works for everyone.</h1>
      <p>
        Mutual is a free group scheduling poll. Create an event, share the link, and everyone paints when they are free. A simpler, prettier When2Meet
        alternative with live results.
      </p>
    </div>
  );
}

export function HomeSections() {
  return (
    <>
      <section className="m-home-section" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol className="m-home-steps">
          {steps.map(([title, text], i) => (
            <li key={title} className="m-card m-home-tile">
              <span className="m-home-step-number">{i + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="m-home-section" aria-labelledby="features-title">
        <h2 id="features-title">Everything a group poll needs, nothing it does not</h2>
        <div className="m-home-features">
          {features.map(([Icon, title, text]) => (
            <div key={title} className="m-card m-home-tile">
              <span className="m-home-feature-icon">
                <Icon size={20} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="m-home-section" aria-labelledby="uses-title">
        <h2 id="uses-title">Made for any group</h2>
        <ul className="m-home-tags">
          {useCases.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      </section>

      <section className="m-home-section" aria-labelledby="compare-title">
        <h2 id="compare-title">Mutual vs When2Meet</h2>
        <div className="m-card m-home-compare">
          <table>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col">Mutual</th>
                <th scope="col">When2Meet</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map(([feature, theirs]) => (
                <tr key={feature}>
                  <th scope="row">{feature}</th>
                  <td>{mark(true)}</td>
                  <td>{mark(theirs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="m-home-section" aria-labelledby="faq-title">
        <h2 id="faq-title">Frequently asked questions</h2>
        <div className="m-home-faq">
          {faq.map(([q, a]) => (
            <details key={q} className="m-card">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}

