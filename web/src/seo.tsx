import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { HomeHero, HomeSections } from './components/HomeSections';

// Built with `vite build --ssr` and injected into index.html by scripts/prerender.mjs.
export const render = () =>
  renderToStaticMarkup(
    <StaticRouter location="/">
      <div className="m-seo-snapshot">
        <HomeHero />
        <HomeSections />
      </div>
    </StaticRouter>,
  );
