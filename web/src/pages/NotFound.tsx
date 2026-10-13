import { Link } from 'react-router';

export function NotFound() {
  return (
    <div className="m-state">
      <h1 className="m-state-title">Page not found</h1>
      <p>That page does not exist.</p>
      <Link className="m-button is-primary" to="/">
        Go home
      </Link>
    </div>
  );
}
