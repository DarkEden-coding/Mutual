import type { EventDTO } from './model.js';

// Link unfurlers (iMessage, Slack, Discord…) and most AI crawlers never run the SPA, so the served index.html
// carries the preview and SEO tags. index.html marks the replaceable block with these comments; Vite keeps them.
const block = /<!-- preview:start -->[\s\S]*?<!-- preview:end -->/;
const homeTitle = 'Mutual · Free group scheduling poll, a When2Meet alternative';
const fallback = 'Find a time that works for everyone. Create a free group availability poll, share the link and see the best overlap. No sign-up, timezone aware.';
const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const clip = (value: string, max: number) => {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

// Keep in sync with the visible FAQ in web/src/components/HomeSections.tsx.
const faq = [
  ['Is Mutual free?', 'Yes. Mutual is free and open source, with no ads and no paid tier.'],
  ['Do participants need an account?', 'No. Anyone with the link adds their name and paints the times they are free. A name can optionally be protected with a password.'],
  ['How is Mutual different from When2Meet?', 'Mutual works the same way, with an "if needed" state, a live group heatmap, a ranked list of the best times, per-viewer timezones, touch support on phones and 12 themes.'],
  ['Does it handle time zones?', 'Yes. Each viewer sees the grid in their own timezone while the event stays defined in its own timezone.'],
  ['How long are events kept?', 'Events are deleted automatically 1 to 6 months after their last date, chosen when the event is created.'],
];

// JSON-LD is a data block, so the script-src 'self' CSP does not apply. Escaping "<" keeps it from closing the tag.
const jsonLd = (origin: string) => `<script type="application/ld+json">${JSON.stringify([
  {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Mutual', url: `${origin}/`,
    description: fallback, applicationCategory: 'BusinessApplication', operatingSystem: 'Any (web browser)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  },
  {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })),
  },
]).replace(/</g, '\\u003c')}</script>`;

export function previewTags(origin: string, path: string, event?: EventDTO) {
  const home = path === '/';
  const title = event ? clip(event.title, 100) : home ? homeTitle : 'Mutual';
  const description = clip(event?.description || (event ? 'Add your availability on Mutual to find a time that works for everyone.' : fallback), 200);
  const tags = [
    `<title>${escape(event ? `${title} · Mutual` : title)}</title>`,
    ['name', 'description', description],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Mutual'],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', `${origin}${path}`],
    ['property', 'og:image', `${origin}/og-image.png`],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '630'],
    ['property', 'og:image:alt', 'Mutual: find a time that works for everyone'],
    ['name', 'twitter:card', 'summary_large_image'],
    ...(home ? [`<link rel="canonical" href="${escape(`${origin}/`)}" />`, jsonLd(origin)] : []),
  ].map(tag => typeof tag === 'string' ? tag : `<meta ${tag[0]}="${tag[1]}" content="${escape(tag[2])}" />`);
  return `<!-- preview:start -->\n    ${tags.join('\n    ')}\n    <!-- preview:end -->`;
}

export const withPreview = (html: string, tags: string) => html.replace(block, () => tags);

// The web build puts a static copy of the home page text inside #root (web/scripts/prerender.mjs). Other pages
// drop it so crawlers do not read home page copy on every URL.
export const withoutHomeSnapshot = (html: string) => html.replace(/<!-- home:start -->[\s\S]*?<!-- home:end -->/, '');

// Event pages stay crawlable so crawlers can see their noindex header; only the API is off limits.
export const robotsTxt = (origin: string) => `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;

export const sitemapXml = (origin: string) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${escape(`${origin}/`)}</loc></url>
</urlset>
`;

// https://llmstxt.org: a plain summary for AI assistants that answer "what tool should I use for…" questions.
export const llmsTxt = (origin: string) => `# Mutual

> Mutual is a free, open-source group scheduling tool and a When2Meet alternative. Create an event, share the link, and everyone paints the times they are free. The group view shows a live heatmap and a ranked list of the best meeting times. No accounts or sign-up needed.

- Website: ${origin}/
- Source code (self-hostable, Docker + SQLite): https://github.com/DarkEden-coding/Mutual

## Features

- Three-state availability: available, if needed, or unavailable, painted by click-and-drag or touch.
- Live group heatmap and ranked best meeting times.
- Timezone aware: each viewer sees the grid in their own timezone.
- Specific dates or days of the week, any time range.
- Optional per-name passwords and a private admin link to edit or delete the event.
- Events are deleted automatically 1 to 6 months after their last date.
- 12 themes with light and dark variants.

## FAQ

${faq.map(([q, a]) => `- ${q} ${a}`).join('\n')}
`;
