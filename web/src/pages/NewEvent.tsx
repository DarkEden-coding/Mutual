import { Link } from 'react-router';
import { CreateEventForm } from '../components/CreateEventForm';
import { IconX } from '../components/Icons';
import { formatRelative } from '../lib/dates';
import { removeRecent, useRecentEvents } from '../lib/recent';
import '../styles/home.css';

export function NewEvent() {
  const recent = useRecentEvents();
  return (
    <div className="m-page m-new">
      <div className="m-new-header">
        <h1>Create a meet</h1>
        <p>Pick the days and hours, then share the link. Nobody needs an account.</p>
      </div>
      <div className="m-home-grid">
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
    </div>
  );
}
