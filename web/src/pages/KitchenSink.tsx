import { useMemo, useState } from 'react';
import type { ParticipantDTO } from '../api';
import { Calendar } from '../components/Calendar';
import { Dialog } from '../components/Dialog';
import { EditGrid } from '../components/grid/EditGrid';
import { HeatGrid } from '../components/grid/HeatGrid';
import { BestTimes, BrushLegend, GroupLegend, ParticipantList } from '../components/GroupWidgets';
import { IconCheck, IconCopy, IconPencil, IconTrash } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { Tabs } from '../components/Tabs';
import { ThemeControls } from '../components/ThemePicker';
import { TimezoneSelect } from '../components/TimezoneSelect';
import { useToast } from '../components/Toast';
import { WeekdayPicker } from '../components/EventFields';
import { computeCounts, findBestBlocks } from '../lib/bestTimes';
import { buildViewGrid, type SlotEventShape } from '../lib/slots';

/** Dev-only "kitchen sink": every component with fake data, for theme authors. Route: /themes */

const EVENT: SlotEventShape = {
  mode: 'dates',
  dates: ['2030-03-04', '2030-03-05', '2030-03-06', '2030-03-07', '2030-03-08'],
  weekdays: [],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  slotMinutes: 30,
  timezone: 'America/New_York',
};

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Ada', 'Ben', 'Chioma', 'Dev', 'Elena', 'Farid', 'Grace', 'Hiro'];

function fakeParticipants(total: number, perDay: number): ParticipantDTO[] {
  return NAMES.map((name, i) => {
    const r = rng(i + 7);
    let s = '';
    for (let k = 0; k < total; k++) {
      const slotOfDay = k % perDay;
      const bias = Math.sin((slotOfDay / perDay) * Math.PI + i) * 0.35 + 0.35;
      const v = r();
      s += v < bias ? '1' : v < bias + 0.12 ? '2' : '0';
    }
    return { id: `p${i}`, name, hasPassword: i % 3 === 0, availability: s, updatedAt: '2030-01-01T00:00:00Z' };
  });
}

export function KitchenSink() {
  const toast = useToast();
  const [viewerTz, setViewerTz] = useState('America/New_York');
  const view = useMemo(() => buildViewGrid(EVENT, viewerTz), [viewerTz]);
  const people = useMemo(() => fakeParticipants(view.totalSlots, view.totalSlots / EVENT.dates.length), [view.totalSlots]);
  const counts = useMemo(() => computeCounts(people, view.totalSlots), [people, view.totalSlots]);
  const blocks = useMemo(() => findBestBlocks(view, people), [view, people]);

  const [mine, setMine] = useState(() => people[0].availability);
  const [brush, setBrush] = useState<'1' | '2'>('1');
  const [seg, setSeg] = useState('b');
  const [tab, setTab] = useState<'one' | 'two'>('one');
  const [dates, setDates] = useState<string[]>(['2030-03-04', '2030-03-05']);
  const [weekdays, setWeekdays] = useState([0, 2, 4]);
  const [tz, setTz] = useState('Europe/London');
  const [dialog, setDialog] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [bestId, setBestId] = useState<string | null>(blocks[0]?.id ?? null);

  const best = blocks.find((b) => b.id === bestId);
  const active = hover ?? pinned;

  return (
    <div className="m-page">
      <div className="m-hero">
        <h1>Theme kitchen sink</h1>
        <p>Every component with fake data. Switch themes and modes below; no backend needed. Dev only.</p>
      </div>

      <section className="m-card m-sink-bar" aria-label="Theme switcher">
        <div className="m-card-header">
          <h2 className="m-card-title">Theme and mode</h2>
        </div>
        <ThemeControls />
      </section>

      <section className="m-card m-sink-section">
        <h2 className="m-card-title">Typography</h2>
        <h1>Heading one</h1>
        <h2>Heading two</h2>
        <h3>Heading three</h3>
        <p>Body text with a <a href="#x">link</a>, plus <span style={{ fontFamily: 'var(--font-mono)' }}>monospace</span>.</p>
        <p style={{ color: 'var(--text-muted)' }}>Muted text sits here.</p>
        <p style={{ color: 'var(--text-faint)' }}>Faint text, hints and placeholders.</p>
      </section>

      <section className="m-card m-sink-section">
        <h2 className="m-card-title">Buttons, badges, chips</h2>
        <div className="m-sink-row">
          <button className="m-button">Default</button>
          <button className="m-button is-primary">Primary</button>
          <button className="m-button is-ghost">Ghost</button>
          <button className="m-button is-danger">Danger</button>
          <button className="m-button" disabled>Disabled</button>
          <button className="m-button is-small"><IconCopy size={16} /> Small</button>
          <button className="m-button is-icon" aria-label="Edit"><IconPencil /></button>
          <button className="m-button is-icon is-danger" aria-label="Delete"><IconTrash /></button>
        </div>
        <div className="m-sink-row">
          <span className="m-badge">Neutral</span>
          <span className="m-badge is-accent">Accent</span>
          <span className="m-badge is-success">Success</span>
          <span className="m-badge is-warning">Warning</span>
          <span className="m-badge is-danger">Danger</span>
        </div>
        <WeekdayPicker value={weekdays} onChange={setWeekdays} />
      </section>

      <section className="m-card m-sink-section">
        <h2 className="m-card-title">Form controls</h2>
        <div className="m-form-row">
          <div className="m-field">
            <label className="m-label" htmlFor="k-input">Input</label>
            <input id="k-input" className="m-input" placeholder="Placeholder" />
            <span className="m-hint">A hint underneath.</span>
          </div>
          <div className="m-field">
            <label className="m-label" htmlFor="k-invalid">Invalid input</label>
            <input id="k-invalid" className="m-input" aria-invalid="true" defaultValue="oops" />
            <span className="m-error">Something is wrong.</span>
          </div>
          <div className="m-field">
            <label className="m-label" htmlFor="k-select">Select</label>
            <select id="k-select" className="m-select"><option>One</option><option>Two</option></select>
          </div>
          <div className="m-field">
            <label className="m-label" htmlFor="k-slug">Input group</label>
            <div className="m-input-group">
              <span className="m-input-prefix">mutual.app/e/</span>
              <input id="k-slug" className="m-input" defaultValue="team-sync" />
            </div>
            <span className="m-ok">Available</span>
          </div>
        </div>
        <div className="m-field">
          <label className="m-label" htmlFor="k-text">Textarea</label>
          <textarea id="k-text" className="m-textarea" defaultValue={'Multi-line text\nSecond line'} />
        </div>
        <div className="m-field">
          <label className="m-label" htmlFor="k-tz">Timezone combobox</label>
          <TimezoneSelect id="k-tz" value={tz} onChange={setTz} />
        </div>
        <div className="m-sink-row">
          <Segmented label="Segmented" value={seg} onChange={setSeg} options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }]} />
          <Segmented<'1' | '2'> label="Brush" value={brush} onChange={setBrush} options={[{ value: '1', label: <><span className="m-swatch-dot is-available" /> Available</> }, { value: '2', label: <><span className="m-swatch-dot is-ifneeded" /> If needed</> }]} />
        </div>
        <Tabs idPrefix="k" label="Tabs" value={tab} onChange={setTab} tabs={[{ id: 'one', label: 'Mine' }, { id: 'two', label: 'Group' }]} />
      </section>

      <section className="m-card m-sink-section">
        <h2 className="m-card-title">Feedback</h2>
        <div className="m-banner is-success">
          <div className="m-banner-title">Banner (success)</div>
          <div className="m-copy-row">
            <input className="m-input" readOnly value="https://example.com/e/team-sync" aria-label="Link" />
            <button className="m-button"><IconCopy /> Copy</button>
          </div>
        </div>
        <div className="m-banner is-danger" role="note">Banner (danger)</div>
        <div className="m-sink-row">
          <button className="m-button" onClick={() => toast('Link copied', 'success')}>Success toast</button>
          <button className="m-button" onClick={() => toast('Neutral toast')}>Toast</button>
          <button className="m-button" onClick={() => toast('Something failed', 'error')}>Error toast</button>
          <button className="m-button" onClick={() => setDialog(true)}>Open dialog</button>
          <span className="m-saved is-saved"><IconCheck size={14} /> Saved</span>
          <span className="m-saved is-saving">Saving...</span>
          <span className="m-spinner is-small" />
        </div>
        <div className="m-sink-row">
          <div className="m-tooltip" style={{ position: 'static' }}>
            <div className="m-tooltip-title">Tue, Mar 5 · 10:00-10:30 AM</div>
            <div className="m-tooltip-summary">5/8 available (1 if needed)</div>
            <div className="m-roster">
              <div className="m-roster-group is-available">
                <span className="m-roster-heading"><span className="m-roster-dot" aria-hidden="true" />Available<span className="m-roster-count">4</span></span>
                <span className="m-roster-names"><span className="m-roster-name">Ava,</span><span className="m-roster-name">Ben,</span><span className="m-roster-name">Chloe,</span><span className="m-roster-name">Dev</span></span>
              </div>
              <div className="m-roster-group is-ifneeded">
                <span className="m-roster-heading"><span className="m-roster-dot" aria-hidden="true" />If needed<span className="m-roster-count">1</span></span>
                <span className="m-roster-names"><span className="m-roster-name">Elena</span></span>
              </div>
              <div className="m-roster-group is-unavailable">
                <span className="m-roster-heading"><span className="m-roster-dot" aria-hidden="true" />Unavailable<span className="m-roster-count">3</span></span>
                <span className="m-roster-names"><span className="m-roster-name is-unavailable">Farah,</span><span className="m-roster-name is-unavailable">Gus,</span><span className="m-roster-name is-unavailable">Hana</span></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="m-card m-sink-section">
        <h2 className="m-card-title">Calendar</h2>
        <Calendar selected={dates} onChange={setDates} />
      </section>

      <section className="m-card m-sink-section">
        <div className="m-card-header">
          <h2 className="m-card-title">Grids</h2>
          <div style={{ minWidth: '14rem' }}>
            <TimezoneSelect value={viewerTz} onChange={setViewerTz} label="Viewer timezone" compact />
          </div>
        </div>
        <div className="m-event-layout">
          <div className="m-panel">
            <h3>Your availability</h3>
            <EditGrid view={view} value={mine} onChange={setMine} brush={brush} ariaLabel="Sample editable grid" />
            <BrushLegend />
          </div>
          <div className="m-panel">
            <h3>Group availability</h3>
            <GroupLegend participants={people.length} />
            <HeatGrid
              view={view}
              counts={counts}
              activeSlot={active}
              onHoverSlot={setHover}
              onTapSlot={(s) => setPinned((c) => (c === s ? null : s))}
              pinnedSlot={pinned}
              onDismissPin={() => setPinned(null)}
              participants={people}
              bestSlots={best ? new Set(best.slots) : null}
              personAvailability={person ? (people.find((p) => p.id === person)?.availability ?? null) : null}
              ariaLabel="Sample group grid"
            />
          </div>
        </div>
        <div className="m-event-lower">
          <div>
            <BestTimes blocks={blocks} view={view} activeId={bestId} onSelect={setBestId} />
          </div>
          <div>
            <h3 style={{ marginBottom: 'var(--space-3)' }}>Participants</h3>
            <ParticipantList participants={people} meId="p0" activeId={person} onActive={setPerson} />
          </div>
        </div>
      </section>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Sample dialog"
        footer={
          <>
            <button className="m-button" onClick={() => setDialog(false)}>Cancel</button>
            <button className="m-button is-primary" onClick={() => setDialog(false)}>Confirm</button>
          </>
        }
      >
        <p>Dialog body copy. Backdrop, header, body and footer all take their styling from tokens.</p>
        <div className="m-field">
          <label className="m-label" htmlFor="k-dlg">Name</label>
          <input id="k-dlg" className="m-input" />
        </div>
      </Dialog>
    </div>
  );
}
