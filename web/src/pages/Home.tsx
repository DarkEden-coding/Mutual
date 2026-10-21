import { useRef } from 'react';
import { Link } from 'react-router';
import { CreateEventForm } from '../components/CreateEventForm';
import { HomeHero, HomeSections } from '../components/HomeSections';
import { IconX } from '../components/Icons';
import { formatRelative } from '../lib/dates';
import { removeRecent, useRecentEvents } from '../lib/recent';
import '../styles/home.css';

export function Home() {
  const recent = useRecentEvents();
  const create = useRef<HTMLDivElement>(null);
  const startEvent = () => {
    create.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    create.current?.querySelector('input')?.focus({ preventScroll: true });
  };
  return (
    <div className="m-page m-home">
      <HomeHero />
      <div className="m-home-grid" ref={create}>
        <CreateEventForm />
        <aside className="m-card" aria-labelledby="recent-title">
          <div className="m-card-header">
            <h2 className="m-card-title" id="recent-title">
              Recent events
            </h2>
          </div>
          {recent.length === 0 && <p className="m-hint">Events you create or visit on this device will show up here.</p>}
          <ul className="m-recent-list">
            {recent.map((r) => (
              <li key={r.id} className="m-recent-item">
                <Link to={`/e/${r.id}`} className="m-recent-link">
                  <span className="m-recent-title">{r.title}</span>
                  <span className="m-recent-meta">
                    {formatRelative(r.lastVisited)}
                    {r.isAdmin ? ' · Admin' : ''}
                  </span>
                </Link>
                <button
                  type="button"
                  className="m-button is-ghost is-icon is-small"
                  aria-label={`Remove ${r.title} from recent events`}
                  onClick={() => removeRecent(r.id)}
                >
                  <IconX size={16} />
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <HomeSections />
      <section className="m-card m-home-cta" aria-labelledby="cta-title">
        <h2 id="cta-title">Ready to find a time?</h2>
        <p>It takes about 30 seconds and nobody needs an account.</p>
        <button type="button" className="m-button is-primary" onClick={startEvent}>
          Create a free poll
        </button>
      </section>
    </div>
  );
}
