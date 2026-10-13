import { Link, Outlet } from 'react-router';
import { IconLogo } from './Icons';
import { ThemePicker } from './ThemePicker';

export function Layout() {
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
            <ThemePicker />
          </div>
        </div>
      </header>
      <main className="m-main">
        <Outlet />
      </main>
      <footer className="m-footer">Find a time that works for everyone.</footer>
    </div>
  );
}
