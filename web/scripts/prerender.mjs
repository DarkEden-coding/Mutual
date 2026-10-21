// Puts the static home page copy inside #root so crawlers that do not run JavaScript can read it. The server
// strips the block on every page but the home page, and React replaces it on mount.
import { readFile, rm, writeFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url), ssr = new URL('../dist-ssr/', import.meta.url);
const { render } = await import(new URL('seo.js', ssr));
const file = new URL('index.html', dist);
const html = await readFile(file, 'utf8');
const root = '<div id="root"></div>';
if (!html.includes(root)) throw new Error(`prerender: ${root} not found in dist/index.html`);
await writeFile(file, html.replace(root, () => `<div id="root"><!-- home:start -->${render()}<!-- home:end --></div>`));
await rm(ssr, { recursive: true, force: true });
