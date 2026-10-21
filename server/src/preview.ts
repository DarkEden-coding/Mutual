import type { EventDTO } from './model.js';

// Link unfurlers (iMessage, Slack, Discord…) never run the SPA, so the served index.html carries the
// preview tags. index.html marks the replaceable block with these comments; Vite keeps them in the build.
const block = /<!-- preview:start -->[\s\S]*?<!-- preview:end -->/;
const fallback = 'Find a time that works for everyone. Share a link, mark when you are free and see the best overlap.';
const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const clip = (value: string, max: number) => {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

export function previewTags(origin: string, path: string, event?: EventDTO) {
  const title = event ? clip(event.title, 100) : 'Mutual';
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
    ['property', 'og:image:alt', 'Mutual'],
    ['name', 'twitter:card', 'summary_large_image'],
  ].map(tag => typeof tag === 'string' ? tag : `<meta ${tag[0]}="${tag[1]}" content="${escape(tag[2])}" />`);
  return `<!-- preview:start -->\n    ${tags.join('\n    ')}\n    <!-- preview:end -->`;
}

export const withPreview = (html: string, tags: string) => html.replace(block, () => tags);
