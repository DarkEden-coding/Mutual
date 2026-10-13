import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError, api, type EventDTO, type ParticipantDTO } from '../api';
import { Dialog } from '../components/Dialog';
import { EditEventDialog } from '../components/EditEventDialog';
import { EditGrid } from '../components/grid/EditGrid';
import { HeatGrid } from '../components/grid/HeatGrid';
import { BestTimes, BrushLegend, GroupLegend, ParticipantList } from '../components/GroupWidgets';
import { IconCheck, IconCopy, IconGlobe, IconLink, IconPencil } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { SignInPanel } from '../components/SignIn';
import { Tabs } from '../components/Tabs';
import { TimezoneSelect } from '../components/TimezoneSelect';
import { useToast } from '../components/Toast';
import { useCopy } from '../hooks/useCopy';
import { useEventData } from '../hooks/useEventData';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { computeCounts, findBestBlocks } from '../lib/bestTimes';
import { removeRecent, recordVisit } from '../lib/recent';
import { buildViewGrid, normalizeAvailability } from '../lib/slots';
import { browserTimeZone } from '../lib/tz';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type MobileTab = 'mine' | 'group';

export function EventPage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  // ---- admin claim (?admin=<token>) happens before the first load ----
  const adminToken = search.get('admin');
  const [claimDone, setClaimDone] = useState(!adminToken);
  useEffect(() => {
    if (!adminToken) return;
    let cancelled = false;
    api
      .claimAdmin(id, adminToken)
      .then(() => !cancelled && toast('Admin access enabled on this device', 'success'))
      .catch((err) => {
        if (!cancelled) toast(err instanceof ApiError && err.code === 'forbidden' ? 'That admin link is not valid' : 'Could not claim admin access', 'error');
      })
      .finally(() => {
        if (cancelled) return;
        navigate({ pathname: location.pathname, search: '' }, { replace: true, state: location.state });
        setClaimDone(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, id]);

  // ---- one-time post-create panel ----
  const [created, setCreated] = useState<{ adminToken: string } | null>(
    () => (location.state as { created?: { adminToken: string } } | null)?.created ?? null,
  );
  useEffect(() => {
    if (created && (location.state as { created?: unknown } | null)?.created) {
      window.history.replaceState({ ...window.history.state, usr: null }, '');
    }
  }, [created, location.state]);

  const data = useEventData(id, claimDone);
  const { state } = data;

  useEffect(() => {
    if (state.status === 'notfound' || state.status === 'deleted') removeRecent(id);
  }, [state.status, id]);

  const event = state.status === 'ready' ? state.event : null;
  useEffect(() => {
    document.title = event ? `${event.title} · Mutual` : 'Mutual';
    return () => {
      document.title = 'Mutual';
    };
  }, [event?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAdmin = state.status === 'ready' && state.viewer.isAdmin;
  const readyTitle = state.status === 'ready' ? state.event.title : null;
  useEffect(() => {
    if (readyTitle !== null) recordVisit({ id, title: readyTitle, isAdmin });
  }, [readyTitle, isAdmin, id]);

  if (state.status === 'loading') {
    return (
      <div className="m-loading" role="status" aria-label="Loading event">
        <div className="m-spinner" />
      </div>
    );
  }
  if (state.status === 'notfound') {
    return (
      <StateScreen title="We could not find that event" body="The link may be mistyped, or the event may have been removed.">
        <Link className="m-button is-primary" to="/">
          Create a new event
        </Link>
      </StateScreen>
    );
  }
  if (state.status === 'deleted') {
    return (
      <StateScreen title="This event was deleted" body="The organizer removed it, so it is no longer available.">
        <Link className="m-button is-primary" to="/">
          Create a new event
        </Link>
      </StateScreen>
    );
  }
  if (state.status === 'error') {
    return (
      <StateScreen title="Could not load the event" body={state.message}>
        <button type="button" className="m-button is-primary" onClick={() => void data.refetch()}>
          Try again
        </button>
      </StateScreen>
    );
  }

  return (
    <EventView
      event={state.event}
      participants={state.participants}
      viewer={state.viewer}
      data={data}
      created={created}
      onDismissCreated={() => setCreated(null)}
    />
  );
}

function StateScreen({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="m-state">
      <h1 className="m-state-title">{title}</h1>
      <p>{body}</p>
      {children}
    </div>
  );
}

interface ViewProps {
  event: EventDTO;
  participants: ParticipantDTO[];
  viewer: { isAdmin: boolean; participantId: string | null };
  data: ReturnType<typeof useEventData>;
  created: { adminToken: string } | null;
  onDismissCreated: () => void;
}

function EventView({ event, participants, viewer, data, created, onDismissCreated }: ViewProps) {
  const toast = useToast();
  const copy = useCopy();
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 859px)');
  const coarse = useMediaQuery('(pointer: coarse)');

  const [viewerTz, setViewerTz] = useState(browserTimeZone);
  const [tab, setTab] = useState<MobileTab>('mine');
  const [brush, setBrush] = useState<'1' | '2'>('1');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const view = useMemo(() => buildViewGrid(event, viewerTz), [event, viewerTz]);
  const total = view.totalSlots;

  // ---- my availability (local draft + debounced autosave) ----
  const me = participants.find((p) => p.id === viewer.participantId) ?? null;
  const [mine, setMine] = useState(() => normalizeAvailability(me?.availability, total));
  const [syncKey, setSyncKey] = useState(`${me?.id}|${event.updatedAt}|${total}`);
  const nextKey = `${me?.id}|${event.updatedAt}|${total}`;
  if (syncKey !== nextKey) {
    // Re-sync from the server when sign-in changes or the admin edits the event (slots remapped).
    setSyncKey(nextKey);
    setMine(normalizeAvailability(me?.availability, total));
  }

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const mineRef = useRef(mine);
  mineRef.current = mine;
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef(false);
  const dirty = useRef(false);
  const idRef = useRef(event.id);
  idRef.current = event.id;

  const live = useRef({ data, viewer, toast });
  live.current = { data, viewer, toast };

  const flush = useCallback(async function run(): Promise<void> {
    window.clearTimeout(timer.current);
    if (!dirty.current || inflight.current) return; // a running request re-checks `dirty` when it ends
    inflight.current = true;
    dirty.current = false;
    let retryIn = 0;
    try {
      const r = await api.saveAvailability(idRef.current, mineRef.current);
      live.current.data.upsertParticipant(r.participant);
      if (!dirty.current) setSaveState('saved');
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'unauthorized' || err.code === 'forbidden')) {
        live.current.toast('Your session expired. Please sign in again.', 'error');
        live.current.data.setViewer({ ...live.current.viewer, participantId: null });
        setSaveState('idle');
      } else {
        dirty.current = true;
        setSaveState('error');
        retryIn = 2500;
      }
    } finally {
      inflight.current = false;
    }
    if (retryIn || dirty.current) timer.current = window.setTimeout(() => void run(), retryIn || 400);
  }, []);

  const onMineChange = (next: string) => {
    setMine(next);
    dirty.current = true;
    setSaveState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 400);
  };

  // Flush pending edits when leaving the page or hiding the tab.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      void flush();
    };
  }, [flush]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const t = window.setTimeout(() => setSaveState('idle'), 2500);
    return () => window.clearTimeout(t);
  }, [saveState]);

  // ---- group data ----
  const groupParticipants = useMemo(
    () => (me ? participants.map((p) => (p.id === me.id ? { ...p, availability: mine } : p)) : participants),
    [participants, me, mine],
  );
  const counts = useMemo(() => computeCounts(groupParticipants, total), [groupParticipants, total]);
  const blocks = useMemo(() => findBestBlocks(view, groupParticipants), [view, groupParticipants]);

  const [bestId, setBestId] = useState<string | null>(null);
  const [bestHoverId, setBestHoverId] = useState<string | null>(null);
  const best = blocks.find((b) => b.id === (bestHoverId ?? bestId)) ?? null;
  const bestSlots = useMemo(() => (best ? new Set(best.slots) : null), [best]);

  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [pinnedSlot, setPinnedSlot] = useState<number | null>(null);
  const activeSlot = hoverSlot ?? pinnedSlot;
  const [personId, setPersonId] = useState<string | null>(null);
  const personAvail = useMemo(
    () => (personId ? (groupParticipants.find((p) => p.id === personId)?.availability ?? null) : null),
    [personId, groupParticipants],
  );

  // ---- actions ----
  const eventUrl = `${window.location.origin}/e/${event.id}`;

  async function signOut() {
    await flush();
    try {
      await api.signOut(event.id);
    } catch {
      /* cookie may already be gone */
    }
    data.setViewer({ ...viewer, participantId: null });
  }

  async function deleteEvent() {
    setDeleting(true);
    try {
      await api.deleteEvent(event.id);
      removeRecent(event.id);
      data.markDeleted();
      setDeleteOpen(false);
      setEditOpen(false);
      navigate('/', { replace: true });
      toast('Event deleted', 'success');
    } catch (err) {
      setDeleting(false);
      toast(err instanceof ApiError ? err.message : 'Could not delete the event', 'error');
    }
  }

  const showMine = !isMobile || tab === 'mine';
  const showGroup = !isMobile || tab === 'group';
  const tzDiffers = viewerTz !== event.timezone;

  return (
    <div className="m-page m-event">
      {created && (
        <section className="m-banner is-success" aria-label="Event created">
          <div className="m-banner-title">Your event is ready. Share it with your group.</div>
          <div className="m-field">
            <label className="m-label" htmlFor="created-share">
              Share link
            </label>
            <div className="m-copy-row">
              <input id="created-share" className="m-input" readOnly value={eventUrl} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="m-button" onClick={() => void copy(eventUrl, 'Share link')}>
                <IconCopy /> Copy
              </button>
            </div>
          </div>
          <div className="m-field">
            <label className="m-label" htmlFor="created-admin">
              Admin link
            </label>
            <div className="m-copy-row">
              <input
                id="created-admin"
                className="m-input"
                readOnly
                value={`${eventUrl}?admin=${created.adminToken}`}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" className="m-button" onClick={() => void copy(`${eventUrl}?admin=${created.adminToken}`, 'Admin link')}>
                <IconCopy /> Copy
              </button>
            </div>
            <span className="m-hint">Keep this private. It lets you edit or delete the event from any device. This device is already an admin.</span>
          </div>
          <div>
            <button type="button" className="m-button is-small" onClick={onDismissCreated}>
              <IconCheck size={16} /> Got it
            </button>
          </div>
        </section>
      )}

      <header className="m-event-head">
        <div className="m-event-head-top">
          <div>
            <h1 className="m-event-title">{event.title}</h1>
            {event.description && <p className="m-event-desc">{event.description}</p>}
          </div>
          <div className="m-event-tools">
            <button type="button" className="m-button" onClick={() => void copy(eventUrl)}>
              <IconLink /> Copy link
            </button>
            {viewer.isAdmin && (
              <button type="button" className="m-button" onClick={() => setEditOpen(true)}>
                <IconPencil /> Edit event
              </button>
            )}
          </div>
        </div>
        <div className="m-event-tz">
          <IconGlobe size={16} />
          <span id="tz-label">Showing times in</span>
          <div style={{ minWidth: '13rem' }}>
            <TimezoneSelect value={viewerTz} onChange={setViewerTz} label="Viewer timezone" compact />
          </div>
          {tzDiffers && (
            <>
              <span className="m-badge">Event timezone: {event.timezone}</span>
              <button type="button" className="m-button is-ghost is-small" onClick={() => setViewerTz(browserTimeZone())}>
                Reset
              </button>
            </>
          )}
        </div>
      </header>

      {isMobile && (
        <Tabs<MobileTab>
          idPrefix="ev"
          label="Availability view"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'mine', label: 'Mine' },
            { id: 'group', label: `Group (${participants.length})` },
          ]}
        />
      )}

      <div className="m-event-layout">
        {showMine && (
          <section className="m-panel" id="ev-panel-mine" role={isMobile ? 'tabpanel' : undefined} aria-labelledby={isMobile ? 'ev-tab-mine' : 'mine-title'}>
            {!isMobile && (
              <div className="m-toolbar">
                <h2 className="m-card-title" id="mine-title">
                  Your availability
                </h2>
              </div>
            )}
            {!me ? (
              <SignInPanel
                eventId={event.id}
                onSignedIn={(p, v) => {
                  data.upsertParticipant(p);
                  data.setViewer(v);
                }}
              />
            ) : (
              <>
                <div className="m-panel-controls">
                  <div className="m-toolbar">
                    <div className="m-signed-in">
                      <span>
                        Signed in as <strong>{me.name}</strong>
                      </span>
                      <button type="button" className="m-button is-ghost is-small" onClick={() => void signOut()}>
                        Not you?
                      </button>
                    </div>
                    <span className={`m-saved is-${saveState}`} role="status" aria-live="polite">
                      {saveState === 'saving' && 'Saving...'}
                      {saveState === 'saved' && (
                        <>
                          <IconCheck size={14} /> Saved
                        </>
                      )}
                      {saveState === 'error' && 'Could not save. Retrying...'}
                    </span>
                  </div>
                  <div className="m-toolbar">
                    <Segmented<'1' | '2'>
                      label="Brush"
                      value={brush}
                      onChange={setBrush}
                      options={[
                        { value: '1', label: (<><span className="m-swatch-dot is-available" /> Available</>) },
                        { value: '2', label: (<><span className="m-swatch-dot is-ifneeded" /> If needed</>) },
                      ]}
                    />
                    <button
                      type="button"
                      className="m-button is-ghost is-small"
                      onClick={() => onMineChange('0'.repeat(total))}
                      disabled={!mine.includes('1') && !mine.includes('2')}
                    >
                      Clear all
                    </button>
                  </div>
                  <BrushLegend />
                </div>
                <div className="m-panel-main">
                  <EditGrid view={view} value={mine} onChange={onMineChange} brush={brush} ariaLabel="Your availability" />
                  <p className="m-grid-hint">
                    {coarse ? 'Tap a time, or touch and hold then drag to paint.' : 'Click and drag to paint.'} Start on a filled time to
                    erase.
                  </p>
                </div>
              </>
            )}
          </section>
        )}

        {showGroup && (
          <section className="m-panel" id="ev-panel-group" role={isMobile ? 'tabpanel' : undefined} aria-labelledby={isMobile ? 'ev-tab-group' : 'group-title'}>
            {!isMobile && (
              <div className="m-toolbar">
                <h2 className="m-card-title" id="group-title">
                  Group availability
                </h2>
                <span className="m-badge">
                  {data.live ? 'Live' : 'Offline'} · {participants.length} {participants.length === 1 ? 'response' : 'responses'}
                </span>
              </div>
            )}
            <div className="m-panel-controls">
              <BestTimes blocks={blocks} view={view} activeId={bestId} onSelect={setBestId} onHover={setBestHoverId} />
              <GroupLegend participants={participants.length} />
            </div>
            <div className="m-panel-main">
              <HeatGrid
                view={view}
                counts={counts}
                activeSlot={activeSlot}
                onHoverSlot={setHoverSlot}
                onTapSlot={(s) => setPinnedSlot((cur) => (cur === s ? null : s))}
                pinnedSlot={pinnedSlot}
                onDismissPin={() => setPinnedSlot(null)}
                participants={groupParticipants}
                bestSlots={bestSlots}
                personAvailability={personAvail}
                ariaLabel="Group availability"
              />
            </div>
          </section>
        )}
      </div>

      <section className="m-card m-responses" aria-labelledby="people-title">
        <div className="m-card-header">
          <h2 className="m-card-title" id="people-title">
            Responses ({participants.length})
          </h2>
        </div>
        <ParticipantList participants={participants} meId={me?.id ?? null} activeId={personId} onActive={setPersonId} />
      </section>

      {viewer.isAdmin && (
        <>
          <EditEventDialog
            open={editOpen}
            event={event}
            onClose={() => setEditOpen(false)}
            onSaved={(ev, ps) => data.setSnapshot(ev, ps)}
            onDelete={() => setDeleteOpen(true)}
          />
          <Dialog
            open={deleteOpen}
            onClose={() => !deleting && setDeleteOpen(false)}
            title="Delete this event?"
            footer={
              <>
                <button type="button" className="m-button" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                  Keep event
                </button>
                <button type="button" className="m-button is-danger is-solid" onClick={() => void deleteEvent()} disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete forever'}
                </button>
              </>
            }
          >
            <p>
              This permanently removes <strong>{event.title}</strong> and everyone&apos;s responses. This cannot be undone.
            </p>
          </Dialog>
        </>
      )}
    </div>
  );
}
