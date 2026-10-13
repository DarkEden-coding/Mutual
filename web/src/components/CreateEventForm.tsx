import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, api, type EventMode, type SlotMinutes } from '../api';
import { browserTimeZone, todayKey } from '../lib/tz';
import { recordVisit } from '../lib/recent';
import { DatePicker, HoursFields, WeekdayPicker } from './EventFields';
import { Segmented } from './Segmented';
import { TimezoneSelect } from './TimezoneSelect';

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';

const SLUG_RE = /^[a-z0-9-]{3,48}$/;

export function CreateEventForm() {
  const navigate = useNavigate();
  const uid = useId();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<EventMode>('dates');
  const [dates, setDates] = useState<string[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [startMinute, setStartMinute] = useState(9 * 60);
  const [endMinute, setEndMinute] = useState(17 * 60);
  const [slotMinutes, setSlotMinutes] = useState<SlotMinutes>(15);
  const [timezone, setTimezone] = useState(browserTimeZone);
  const [slug, setSlug] = useState('');
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const checkSeq = useRef(0);

  // Debounced slug availability check
  useEffect(() => {
    if (!slug) {
      setSlugStatus('idle');
      return;
    }
    if (!SLUG_RE.test(slug)) {
      setSlugStatus('invalid');
      return;
    }
    setSlugStatus('checking');
    const seq = ++checkSeq.current;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const r = await api.checkSlug(slug, ctrl.signal);
        if (seq !== checkSeq.current) return;
        setSlugStatus(!r.valid ? 'invalid' : r.available ? 'available' : 'taken');
      } catch (e) {
        if ((e as Error).name === 'AbortError' || seq !== checkSeq.current) return;
        setSlugStatus('error');
      }
    }, 350);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [slug]);

  const titleOk = title.trim().length >= 1 && title.trim().length <= 100;
  const daysOk = mode === 'dates' ? dates.length > 0 : weekdays.length > 0;
  const slugOk = slugStatus !== 'taken' && slugStatus !== 'invalid';
  const valid = titleOk && daysOk && slugOk && description.length <= 1000;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const { event, adminToken } = await api.createEvent({
        title: title.trim(),
        description: description.trim() || undefined,
        mode,
        ...(mode === 'dates' ? { dates } : { weekdays }),
        startMinute,
        endMinute,
        slotMinutes,
        timezone,
        slug: slug || undefined,
      });
      recordVisit({ id: event.id, title: event.title, isAdmin: true });
      navigate(`/e/${event.id}`, { state: { created: { adminToken } } });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'slug_taken') setSlugStatus('taken');
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  const slugHint =
    slugStatus === 'checking' ? (
      <span className="m-hint" aria-live="polite">
        Checking availability...
      </span>
    ) : slugStatus === 'available' ? (
      <span className="m-ok" aria-live="polite">
        /e/{slug} is available
      </span>
    ) : slugStatus === 'taken' ? (
      <span className="m-error" role="alert">
        That link is already taken
      </span>
    ) : slugStatus === 'invalid' ? (
      <span className="m-error" role="alert">
        Use 3 to 48 lowercase letters, numbers or hyphens
      </span>
    ) : slugStatus === 'error' ? (
      <span className="m-hint">Could not check right now. We will verify when you create the event.</span>
    ) : (
      <span className="m-hint">Leave blank for a random link.</span>
    );

  return (
    <form className="m-form" onSubmit={onSubmit} noValidate>
      <section className="m-card" aria-labelledby={`${uid}-basics`}>
        <div className="m-card-header">
          <h2 className="m-card-title" id={`${uid}-basics`}>
            What are you planning?
          </h2>
        </div>
        <div className="m-card-body">
          <div className="m-field">
            <label className="m-label" htmlFor={`${uid}-title`}>
              Event name
            </label>
            <input
              id={`${uid}-title`}
              className="m-input"
              value={title}
              maxLength={100}
              placeholder="Team offsite planning"
              aria-invalid={touched && !titleOk}
              aria-describedby={touched && !titleOk ? `${uid}-title-err` : undefined}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            {touched && !titleOk && (
              <span className="m-error" id={`${uid}-title-err`} role="alert">
                Give your event a name
              </span>
            )}
          </div>
          <div className="m-field">
            <label className="m-label" htmlFor={`${uid}-desc`}>
              Description <span className="m-optional">(optional)</span>
            </label>
            <textarea
              id={`${uid}-desc`}
              className="m-textarea"
              value={description}
              maxLength={1000}
              placeholder="Anything people should know?"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="m-field">
            <label className="m-label" htmlFor={`${uid}-slug`}>
              Custom URL <span className="m-optional">(optional)</span>
            </label>
            <div className="m-input-group">
              <span className="m-input-prefix">{window.location.host}/e/</span>
              <input
                id={`${uid}-slug`}
                className="m-input"
                value={slug}
                maxLength={48}
                placeholder="team-offsite"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={slugStatus === 'taken' || slugStatus === 'invalid'}
                aria-describedby={`${uid}-slug-hint`}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              />
            </div>
            <div id={`${uid}-slug-hint`}>{slugHint}</div>
          </div>
        </div>
      </section>

      <section className="m-card" aria-labelledby={`${uid}-when`}>
        <div className="m-card-header">
          <h2 className="m-card-title" id={`${uid}-when`}>
            When could it happen?
          </h2>
          <Segmented<EventMode>
            label="Day selection mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'dates', label: 'Specific dates' },
              { value: 'weekdays', label: 'Days of the week' },
            ]}
          />
        </div>
        <div className="m-card-body m-when-grid">
          <div className="m-when-days">
          {mode === 'dates' ? (
            <DatePicker value={dates} onChange={setDates} min={todayKey(timezone)} />
          ) : (
            <WeekdayPicker value={weekdays} onChange={setWeekdays} />
          )}
          {touched && !daysOk && (
            <span className="m-error" role="alert">
              Pick at least one {mode === 'dates' ? 'date' : 'day'}
            </span>
          )}
          </div>
          <div className="m-when-times">
          <HoursFields
            start={startMinute}
            end={endMinute}
            onChange={(s, e) => {
              setStartMinute(s);
              setEndMinute(e);
            }}
          />
          <div className="m-field">
            <span className="m-label" id={`${uid}-slot`}>
              Time slot size
            </span>
            <div>
              <Segmented<SlotMinutes>
                label="Time slot size"
                value={slotMinutes}
                onChange={setSlotMinutes}
                options={[
                  { value: 15, label: '15 min' },
                  { value: 30, label: '30 min' },
                  { value: 60, label: '1 hour' },
                ]}
              />
            </div>
          </div>
          <div className="m-field">
            <label className="m-label" htmlFor={`${uid}-tz`}>
              Timezone
            </label>
            <TimezoneSelect id={`${uid}-tz`} value={timezone} onChange={setTimezone} />
            <span className="m-hint">Everyone sees times converted to their own timezone.</span>
          </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="m-banner is-danger" role="alert">
          {error}
        </div>
      )}

      <div>
        <button type="submit" className="m-button is-primary" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create event'}
        </button>
      </div>
    </form>
  );
}
