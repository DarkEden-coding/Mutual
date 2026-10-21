import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError, adminLogin, adminLogout, adminStats, type AdminStats } from '../api';
import { HistoryChart, Sparkline } from '../components/AdminCharts';
import {
  deltaFromHistory,
  formatBytes,
  formatClock,
  formatDelta,
  formatStamp,
  formatUptime,
  fraction,
  plural,
  secondsSince,
} from '../lib/admin';
import '../styles/admin.css';

const REFRESH_MS = 15_000;

type View =
  | { kind: 'loading' }
  | { kind: 'disabled' }
  | { kind: 'login' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; stats: AdminStats; fetchedAt: number };

export function Admin() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    document.title = 'Admin · Mutual';
    return () => {
      document.title = 'Mutual';
    };
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const stats = await adminStats(signal);
      setView({ kind: 'ready', stats, fetchedAt: Date.now() });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      if (err instanceof ApiError && err.status === 404) setView({ kind: 'disabled' });
      else if (err instanceof ApiError && err.status === 401) setView({ kind: 'login' });
      // Keep showing the last good numbers when a refresh fails for another reason.
      else setView((v) => (v.kind === 'ready' ? v : { kind: 'error', message: err instanceof Error ? err.message : 'Could not load stats.' }));
    }
  }, []);

  const ready = view.kind === 'ready';
  useEffect(() => {
    const ctrl = new AbortController();
    if (!ready) {
      void load(ctrl.signal);
      return () => ctrl.abort();
    }
    let timer: number | undefined;
    const stop = () => window.clearInterval(timer);
    const start = () => {
      stop();
      timer = window.setInterval(() => void load(ctrl.signal), REFRESH_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else {
        void load(ctrl.signal);
        start();
      }
    };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      ctrl.abort();
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready, load]);

  if (view.kind === 'loading') {
    return (
      <div className="m-page m-admin" aria-busy="true" aria-label="Loading admin dashboard">
        <div className="m-admin-skeleton m-admin-skeleton-head" />
        <div className="m-admin-kpis">
          {[0, 1, 2].map((i) => (
            <div key={i} className="m-admin-skeleton m-admin-skeleton-card" />
          ))}
        </div>
      </div>
    );
  }
  if (view.kind === 'disabled') {
    return (
      <div className="m-state">
        <h1 className="m-state-title">Admin dashboard unavailable</h1>
        <p>The admin dashboard is not enabled on this server.</p>
        <p>
          Set <code className="m-admin-code">ADMIN_TOKEN</code> in the server environment to turn it on.
        </p>
      </div>
    );
  }
  if (view.kind === 'error') {
    return (
      <div className="m-state">
        <h1 className="m-state-title">Could not load stats</h1>
        <p>{view.message}</p>
        <button className="m-button is-primary" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (view.kind === 'login') return <Login onDone={() => load()} />;
  return <Dashboard stats={view.stats} fetchedAt={view.fetchedAt} onSignedOut={() => setView({ kind: 'login' })} />;
}

/* ---------- login ---------- */

function Login({ onDone }: { onDone: () => Promise<void> }) {
  const uid = useId();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setError('Enter the admin token.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminLogin(token);
      setToken('');
      await onDone();
      setBusy(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'forbidden') setError('That token is not correct.');
      else if (err instanceof ApiError && err.code === 'rate_limited') setError('Too many attempts. Wait a few minutes, then try again.');
      else setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="m-admin-login">
      <form className="m-card" onSubmit={submit} aria-labelledby={`${uid}-t`} noValidate>
        <div className="m-card-header">
          <h1 className="m-card-title" id={`${uid}-t`}>
            Admin sign in
          </h1>
        </div>
        <div className="m-card-body">
          <div className="m-field">
            <label className="m-label" htmlFor={`${uid}-k`}>
              Admin token
            </label>
            <input
              id={`${uid}-k`}
              className="m-input"
              type="password"
              value={token}
              maxLength={200}
              autoComplete="current-password"
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? `${uid}-e` : undefined}
              onChange={(e) => setToken(e.target.value)}
            />
            {error && (
              <p className="m-error" id={`${uid}-e`} role="alert">
                {error}
              </p>
            )}
          </div>
          <button type="submit" className="m-button is-primary is-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- dashboard ---------- */

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function Dashboard({ stats, fetchedAt, onSignedOut }: { stats: AdminStats; fetchedAt: number; onSignedOut: () => void }) {
  const now = useNow();
  const [signingOut, setSigningOut] = useState(false);
  const { server, events, people, storage, live, history } = stats;

  async function signOut() {
    setSigningOut(true);
    try {
      await adminLogout();
    } catch {
      /* the session cookie is HttpOnly; show the login either way */
    }
    onSignedOut();
  }

  const uptime = server.uptimeSeconds + Math.max(0, Math.floor((now - fetchedAt) / 1000));
  const used = storage.databaseBytes + storage.walBytes;

  return (
    <div className="m-page m-admin">
      <div className="m-admin-head">
        <h1 className="m-admin-title">
          Admin <span className="m-badge is-accent">Console</span>
        </h1>
        <div className="m-admin-status">
          <span className="m-admin-live">
            <span className="m-admin-live-dot" aria-hidden="true" />
            {live.streams} viewing live
          </span>
          <span>up {formatUptime(uptime)}</span>
          <span>updated {Math.max(0, Math.floor((now - fetchedAt) / 1000))}s ago</span>
          <button className="m-button is-ghost is-small" onClick={() => void signOut()} disabled={signingOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="m-admin-kpis">
        <Kpi
          title="Active events"
          figure={events.active}
          of={events.total}
          caption="≥ 2 people"
          series={history.map((d) => d.activeEvents)}
        />
        <Kpi
          title="Unique people"
          figure={people.unique}
          caption="distinct names"
          sub={`${people.entries.toLocaleString()} entries total`}
          series={history.map((d) => d.uniquePeople)}
        />
        <section className="m-card m-admin-kpi" aria-labelledby="adm-storage">
          <h2 className="m-admin-kpi-title" id="adm-storage">
            Storage
          </h2>
          <div className="m-admin-figure">
            <span className="m-admin-num">{formatBytes(used)}</span>
            <span className="m-admin-caption">db + wal</span>
          </div>
          <p className="m-admin-sub">
            {storage.volume
              ? `volume ${formatBytes(storage.volume.totalBytes - storage.volume.freeBytes)} of ${formatBytes(storage.volume.totalBytes)} used`
              : 'volume size unavailable'}
          </p>
          <StorageBar storage={storage} />
        </section>
      </div>

      <div className="m-admin-cols">
        <Resources stats={stats} />
        <Backups backups={stats.backups} now={now} />
      </div>

      <div className="m-admin-cols">
        <TopEvents events={stats.topEvents} />
        <RateLimits rl={stats.rateLimits} />
      </div>

      <section className="m-card" aria-labelledby="adm-30">
        <div className="m-card-header">
          <h2 className="m-card-title" id="adm-30">
            Last 30 days
          </h2>
        </div>
        <HistoryChart history={history} />
        <dl className="m-admin-totals">
          <Total label="Events created" value={sum(history.map((d) => d.eventsCreated))} />
          <Total label="People joined" value={sum(history.map((d) => d.participantsJoined))} />
          <Total label="Availability saves" value={sum(history.map((d) => d.availabilitySaves))} />
          <Total label="Throttled" value={sum(history.map((d) => d.throttled))} />
        </dl>
      </section>

      <p className="m-admin-foot">
        Mutual v{server.version} · Node {server.node} · generated at {formatClock(stats.generatedAt)}
      </p>
    </div>
  );
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="m-admin-total">
      <dt>{label}</dt>
      <dd>{value.toLocaleString()}</dd>
    </div>
  );
}

function Kpi(props: {
  title: string;
  figure: number;
  of?: number;
  caption: string;
  sub?: string;
  series: (number | null)[];
}) {
  const id = useId();
  const delta = deltaFromHistory(props.figure, props.series);
  return (
    <section className="m-card m-admin-kpi" aria-labelledby={id}>
      <h2 className="m-admin-kpi-title" id={id}>
        {props.title}
      </h2>
      <div className="m-admin-figure">
        <span className="m-admin-num">
          {props.figure.toLocaleString()}
          {props.of !== undefined && <span className="m-admin-of"> / {props.of.toLocaleString()}</span>}
        </span>
        <span className="m-admin-caption">{props.caption}</span>
      </div>
      {props.sub && <p className="m-admin-sub">{props.sub}</p>}
      <div className="m-admin-kpi-foot">
        {delta ? (
          <span className={`m-badge ${delta.diff > 0 ? 'is-success' : ''}`}>
            {formatDelta(delta.diff)} <span className="m-admin-faint">vs 30d ago</span>
          </span>
        ) : (
          <span />
        )}
        {props.series.filter((v) => v !== null).length >= 2 ? (
          <Sparkline values={props.series} label={`${props.title} over the last 30 days`} />
        ) : (
          <span className="m-admin-trend-note">Trend starts after a day of tracking</span>
        )}
      </div>
    </section>
  );
}

function StorageBar({ storage }: { storage: AdminStats['storage'] }) {
  const total = storage.databaseBytes + storage.walBytes;
  const top = storage.tables.slice(0, 3);
  const tableSum = storage.tables.reduce((s, t) => s + t.bytes, 0);
  const free = Math.min(storage.freeBytes, storage.databaseBytes);
  const segs: { label: string; bytes: number; cls: string }[] = [
    ...top.map((t, i) => ({ label: t.name, bytes: t.bytes, cls: `is-t${i}` })),
  ];
  const other = Math.max(0, (storage.tables.length ? tableSum : storage.databaseBytes - free) - top.reduce((s, t) => s + t.bytes, 0));
  if (other > 0) segs.push({ label: storage.tables.length ? 'other' : 'data', bytes: other, cls: 'is-other' });
  if (storage.walBytes > 0) segs.push({ label: 'WAL', bytes: storage.walBytes, cls: 'is-wal' });
  if (free > 0) segs.push({ label: 'free', bytes: free, cls: 'is-free' });
  const summary = segs.map((s) => `${s.label} ${formatBytes(s.bytes)}`).join(', ');
  return (
    <div className="m-admin-storage">
      <div className="m-admin-seg" role="img" aria-label={`Storage breakdown: ${summary || 'empty'}`}>
        {segs.map((s) => (
          <span key={s.label} className={`m-admin-seg-part ${s.cls}`} style={{ flexGrow: s.bytes / Math.max(1, total) }} />
        ))}
      </div>
      <ul className="m-admin-seg-legend" aria-hidden="true">
        {segs.map((s) => (
          <li key={s.label}>
            <span className={`m-admin-seg-dot ${s.cls}`} />
            {s.label} <span className="m-admin-faint">{formatBytes(s.bytes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Meter({
  label,
  value,
  frac,
  tone,
  summary,
}: {
  label: string;
  value: ReactNode;
  frac: number;
  tone?: 'warning' | 'danger';
  summary: string;
}) {
  return (
    <div className="m-admin-meter">
      <span className="m-admin-meter-label">{label}</span>
      <span className="m-admin-track" role="img" aria-label={summary}>
        <span className={`m-admin-fill ${tone ? `is-${tone}` : ''}`} style={{ width: `${frac > 0 ? Math.max(frac * 100, 1.5) : 0}%` }} />
      </span>
      <span className="m-admin-meter-value">{value}</span>
    </div>
  );
}

const toneFor = (f: number) => (f >= 0.9 ? 'danger' : f >= 0.75 ? 'warning' : undefined);

function Resources({ stats }: { stats: AdminStats }) {
  const { storage, server, live, people } = stats;
  const scale = storage.volume?.totalBytes ?? storage.databaseBytes + storage.walBytes;
  const mem = server.memory;
  const memFrac = mem.limit ? fraction(mem.rss, mem.limit) : fraction(mem.heapUsed, mem.rss);
  const streamFrac = fraction(live.streams, live.streamLimit);
  return (
    <section className="m-card" aria-labelledby="adm-res">
      <div className="m-card-header">
        <h2 className="m-card-title" id="adm-res">
          Resources
        </h2>
      </div>
      <div className="m-admin-meters">
        <Meter
          label="Database"
          value={formatBytes(storage.databaseBytes)}
          frac={fraction(storage.databaseBytes, scale)}
          summary={`Database ${formatBytes(storage.databaseBytes)}`}
        />
        <Meter
          label="WAL"
          value={formatBytes(storage.walBytes)}
          frac={fraction(storage.walBytes, scale)}
          summary={`Write-ahead log ${formatBytes(storage.walBytes)}`}
        />
        <Meter
          label="Memory"
          value={mem.limit ? `${formatBytes(mem.rss)} / ${formatBytes(mem.limit)}` : formatBytes(mem.rss)}
          frac={memFrac}
          tone={mem.limit ? toneFor(memFrac) : undefined}
          summary={
            mem.limit
              ? `Memory ${formatBytes(mem.rss)} of ${formatBytes(mem.limit)}`
              : `Memory ${formatBytes(mem.rss)}, heap ${formatBytes(mem.heapUsed)}; no limit set`
          }
        />
        <Meter
          label="Live streams"
          value={`${live.streams} / ${live.streamLimit}`}
          frac={streamFrac}
          tone={toneFor(streamFrac)}
          summary={`${live.streams} of ${live.streamLimit} live streams in use`}
        />
        <Meter
          label="Responses"
          value={`${people.responded.toLocaleString()} / ${people.entries.toLocaleString()}`}
          frac={fraction(people.responded, people.entries)}
          summary={`${people.responded} of ${plural(people.entries, 'participant')} ${people.responded === 1 ? 'has' : 'have'} responded`}
        />
      </div>
    </section>
  );
}

const WEEK_S = 7 * 86400;

function Backups({ backups, now }: { backups: AdminStats['backups']; now: number }) {
  const age = backups.latestAt ? secondsSince(backups.latestAt, now) : null;
  return (
    <section className="m-card" aria-labelledby="adm-bak">
      <div className="m-card-header">
        <h2 className="m-card-title" id="adm-bak">
          Backups
        </h2>
      </div>
      {!backups.configured ? (
        <p className="m-hint">
          Mount <code className="m-admin-code">./backups</code> at <code className="m-admin-code">BACKUP_DIR</code> to list backups
        </p>
      ) : (
        <div className="m-admin-rows">
          <div className="m-admin-row">
            <span className="m-admin-row-label">Latest</span>
            {age === null ? (
              <span className="m-badge is-danger">None</span>
            ) : (
              <span className={`m-badge ${age < WEEK_S ? 'is-success' : 'is-warning'}`}>
                {formatStamp(backups.latestAt!)} · {formatUptime(age)} ago
              </span>
            )}
          </div>
          {backups.snapshots.slice(0, 5).map((s) => (
            <div key={s.name} className="m-admin-row">
              <span className="m-admin-mono m-admin-ellipsis" title={s.name}>
                {s.name}
              </span>
              <span className="m-admin-faint m-admin-nowrap">
                {formatBytes(s.bytes)}
                {s.hasSecret ? ' + secret' : ''}
              </span>
            </div>
          ))}
          <div className="m-admin-row is-total">
            <span>
              {plural(backups.count, 'snapshot')}
            </span>
            <span>{formatBytes(backups.totalBytes)}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function TopEvents({ events }: { events: AdminStats['topEvents'] }) {
  const max = Math.max(1, ...events.map((e) => e.participants));
  return (
    <section className="m-card" aria-labelledby="adm-top">
      <div className="m-card-header">
        <h2 className="m-card-title" id="adm-top">
          Most active events
        </h2>
      </div>
      {events.length === 0 ? (
        <p className="m-hint">No events yet.</p>
      ) : (
        <ol className="m-admin-top">
          {events.map((e) => (
            <li key={e.id} className="m-admin-top-item">
              <div className="m-admin-top-text">
                <span className="m-admin-top-title">{e.title}</span>
                <Link className="m-admin-mono m-admin-slug" to={`/e/${e.id}`}>
                  /e/{e.id}
                </Link>
              </div>
              <span className="m-admin-track" aria-hidden="true">
                <span className="m-admin-fill" style={{ width: `${(e.participants / max) * 100}%` }} />
              </span>
              <span className="m-admin-top-count">
                {e.live > 0 && (
                  <span className="m-admin-live-dot" role="img" aria-label={`${e.live} viewing live`} title={`${e.live} viewing live`} />
                )}
                <span aria-label={plural(e.participants, 'participant')}>{e.participants}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RateLimits({ rl }: { rl: AdminStats['rateLimits'] }) {
  return (
    <section className="m-card" aria-labelledby="adm-rl">
      <div className="m-card-header">
        <h2 className="m-card-title" id="adm-rl">
          Rate limits <span className="m-admin-faint">· last hour</span>
        </h2>
      </div>
      <div className="m-admin-rows">
        <div className="m-admin-row">
          <span className="m-admin-row-label">Throttled requests</span>
          <span className={`m-admin-num-sm ${rl.throttledLastHour > 0 ? 'is-danger' : ''}`}>{rl.throttledLastHour.toLocaleString()}</span>
        </div>
        <div className="m-admin-row">
          <span className="m-admin-row-label">Password lockouts</span>
          <span className="m-admin-num-sm">{rl.passwordLockoutsLastHour.toLocaleString()}</span>
        </div>
        <div className="m-admin-row">
          <span className="m-admin-row-label">Tracked clients</span>
          <span className="m-admin-num-sm">{rl.trackedClients.toLocaleString()}</span>
        </div>
        {rl.clients.map((c) => {
          const low = c.capacity > 0 && c.tokens / c.capacity < 0.25;
          return (
            <div key={`${c.scope}:${c.key}`} className="m-admin-row">
              <span className="m-admin-mono m-admin-ellipsis" title={c.key}>
                {c.key}
              </span>
              <span className={`m-badge ${c.blocked ? 'is-danger' : low ? 'is-warning' : ''}`}>
                {c.scope} · {c.blocked ? 'blocked' : `${Math.floor(c.tokens)} left`}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
