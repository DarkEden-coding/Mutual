import { Link, Outlet, useLocation } from 'react-router';
import { IconGitHub, IconLogo } from './Icons';
import { ThemePicker } from './ThemePicker';

export function Layout() {
  const { pathname } = useLocation();
  return (
    <div className="m-app">
      <header className="m-header">
        <div className="m-header-inner">
          <Link to="/" className="m-brand" aria-label="Mutual home">
            <span className="m-brand-mark">
              <IconLogo size={26} />
            </span>
            <span className="m-brand-name">Mutual</span>
          </Link>
          <div className="m-header-actions">
            {pathname === '/' && (
              <a className="m-button is-ghost is-small" href="https://github.com/DarkEden-coding/Mutual" target="_blank" rel="noopener noreferrer">
                <IconGitHub />
                <span>GitHub</span>
              </a>
            )}
            <ThemePicker />
          </div>
        </div>
      </header>
      <main className="m-main">
        <Outlet />
      </main>
      <footer className="m-footer">
        {pathname === '/' || pathname === '/new' ? (
          'Find a time that works for everyone.'
        ) : (
          <>
            Made with Mutual · <Link to="/new">Create your own free scheduling poll</Link>
          </>
        )}
      </footer>
    </div>
  );
}
