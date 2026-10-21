import { useState } from 'react';
import { ApiError, api, type EventDTO, type ParticipantDTO, type SlotMinutes } from '../api';
import { formatDuration, remapImpact, snapHours } from '../lib/reslot';
import { formatMinute, formatMinuteRange } from '../lib/slots';
import { DatePicker, HoursFields, WeekdayPicker } from './EventFields';
import { Dialog } from './Dialog';
import { IconAlert } from './Icons';
import { Segmented } from './Segmented';
import { useToast } from './Toast';

const slotLabel = (m: number) => (m === 60 ? '1 hour' : `${m} min`);

interface Props {
  open: boolean;
  event: EventDTO;
  participants: ParticipantDTO[];
  onClose: () => void;
  onSaved: (event: EventDTO, participants: ParticipantDTO[]) => void;
  onDelete: () => void;
}

export function EditEventDialog({ open, event, participants, onClose, onSaved, onDelete }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Edit event" wide>
      {open && <EditForm event={event} participants={participants} onClose={onClose} onSaved={onSaved} onDelete={onDelete} />}
    </Dialog>
  );
}

function EditForm({ event, participants, onClose, onSaved, onDelete }: Omit<Props, 'open'>) {
  const toast = useToast();
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [dates, setDates] = useState(event.dates);
  const [weekdays, setWeekdays] = useState(event.weekdays);
  const [start, setStart] = useState(event.startMinute);
  const [end, setEnd] = useState(event.endMinute);
  const [slotMinutes, setSlotMinutes] = useState<SlotMinutes>(event.slotMinutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const daysOk = event.mode === 'dates' ? dates.length > 0 : weekdays.length > 0;
  const valid = title.trim().length > 0 && daysOk && end > start;

  function changeSlotSize(next: SlotMinutes) {
    setSlotMinutes(next);
    // Widen rather than trim the hours so a coarser grid never drops answered time.
    const snapped = snapHours(start, end, next);
    setStart(snapped.start);
    setEnd(snapped.end);
  }

  const draft = { ...event, dates, weekdays, startMinute: start, endMinute: end, slotMinutes };
  const impacts = participants
    .map((p) => ({ participant: p, ...remapImpact(event, draft, p.availability) }))
    .filter((i) => i.adjustedMinutes > 0 || i.clearedMinutes > 0);

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const patch: Parameters<typeof api.updateEvent>[1] = {};
      if (title.trim() !== event.title) patch.title = title.trim();
      if (description.trim() !== event.description) patch.description = description.trim();
      if (event.mode === 'dates' && dates.join() !== event.dates.join()) patch.dates = dates;
      if (event.mode === 'weekdays' && weekdays.join() !== event.weekdays.join()) patch.weekdays = weekdays;
      if (start !== event.startMinute) patch.startMinute = start;
      if (end !== event.endMinute) patch.endMinute = end;
      if (slotMinutes !== event.slotMinutes) patch.slotMinutes = slotMinutes;
      if (Object.keys(patch).length === 0) return onClose();
      const r = await api.updateEvent(event.id, patch);
      onSaved(r.event, r.participants);
      toast('Event updated', 'success');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="m-field">
        <label className="m-label" htmlFor="edit-title">
          Event name
        </label>
        <input id="edit-title" className="m-input" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="m-field">
        <label className="m-label" htmlFor="edit-desc">
          Description
        </label>
        <textarea id="edit-desc" className="m-textarea" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="m-field">
        <span className="m-label">{event.mode === 'dates' ? 'Dates' : 'Days of the week'}</span>
        {event.mode === 'dates' ? <DatePicker value={dates} onChange={setDates} /> : <WeekdayPicker value={weekdays} onChange={setWeekdays} />}
      </div>
      <HoursFields
        start={start}
        end={end}
        onChange={(s, e) => {
          setStart(s);
          setEnd(e);
        }}
      />
      <div className="m-field">
        <span className="m-label">Time slot size</span>
        <div>
          <Segmented<SlotMinutes>
            label="Time slot size"
            value={slotMinutes}
            onChange={changeSlotSize}
            options={[15, 30, 60].map((m) => ({
              value: m as SlotMinutes,
              label: slotLabel(m),
              tip: m === event.slotMinutes ? 'Current size' : undefined,
            }))}
          />
        </div>
      </div>
      <SlotSizeNotice from={event.slotMinutes} to={slotMinutes} hoursChanged={start !== event.startMinute || end !== event.endMinute} start={start} end={end} />
      {impacts.length > 0 && <ImpactWarning impacts={impacts} total={participants.length} merging={slotMinutes > event.slotMinutes} />}
      <p className="m-hint">
        Timezone ({event.timezone}) and day mode cannot be changed. Removing days or hours clears people&apos;s answers for those
        times (currently {formatMinute(event.startMinute)} to {formatMinute(event.endMinute)}).
      </p>
      {error && (
        <span className="m-error" role="alert">
          {error}
        </span>
      )}
      <div className="m-dialog-footer is-sticky">
        <button type="button" className="m-button is-danger" onClick={onDelete}>
          Delete event
        </button>
        <span className="m-spacer" />
        <button type="button" className="m-button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="m-button is-primary" disabled={!valid || busy} onClick={save}>
          {busy ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </>
  );
}

/** Explains how a slot-size change carries answers over, with a tiny before/after strip. */
function SlotSizeNotice({ from, to, hoursChanged, start, end }: { from: number; to: number; hoursChanged: boolean; start: number; end: number }) {
  if (from === to) return null;
  const merging = to > from;
  const ratio = merging ? to / from : from / to;
  // Someone free for all but the last part of the new slot: merging can't keep that.
  const before = merging ? [...Array(ratio - 1).fill('1'), '0'] : ['1'];
  const after = merging ? ['0'] : Array(ratio).fill('1');
  return (
    <div className={`m-reslot${merging ? ' is-merge' : ' is-split'}`} role="note">
      <div className="m-reslot-diagram" aria-hidden="true">
        <SlotStrip values={before} />
        <span className="m-reslot-arrow">→</span>
        <SlotStrip values={after} />
      </div>
      <div className="m-reslot-body">
        <div className="m-reslot-title">
          {merging ? `Merging ${slotLabel(from)} slots into ${slotLabel(to)}` : `Splitting ${slotLabel(from)} slots into ${slotLabel(to)}`}
        </div>
        <p>
          {merging
            ? `A ${slotLabel(to)} slot stays Available only if every part of it was; a partly free slot becomes Unavailable, and a mix with If needed becomes If needed.`
            : 'Every answer is copied into the smaller slots, so nothing is lost.'}
          {hoursChanged && merging && ` Hours snap to ${formatMinuteRange(start, end)} to fit the new size.`}
        </p>
      </div>
    </div>
  );
}

function SlotStrip({ values }: { values: string[] }) {
  return (
    <span className="m-reslot-strip">
      {values.map((v, i) => (
        <span key={i} className={`m-reslot-cell${v === '1' ? ' is-available' : v === '2' ? ' is-ifneeded' : ''}`} />
      ))}
    </span>
  );
}

interface Impact {
  participant: ParticipantDTO;
  adjustedMinutes: number;
  clearedMinutes: number;
}

function ImpactWarning({ impacts, total, merging }: { impacts: Impact[]; total: number; merging: boolean }) {
  const shown = impacts.slice(0, 6);
  return (
    <div className="m-impact" role="alert">
      <div className="m-impact-head">
        <span className="m-impact-icon">
          <IconAlert size={16} />
        </span>
        <span className="m-impact-title">
          This changes answers for {impacts.length} of {total} {total === 1 ? 'person' : 'people'}
        </span>
      </div>
      <ul className="m-impact-list">
        {shown.map(({ participant, adjustedMinutes, clearedMinutes }) => (
          <li key={participant.id}>
            <span className="m-impact-name">{participant.name}</span>
            <span className="m-impact-tags">
              {adjustedMinutes > 0 && <span className="m-badge is-warning">{formatDuration(adjustedMinutes)} merged</span>}
              {clearedMinutes > 0 && <span className="m-badge is-danger">{formatDuration(clearedMinutes)} cleared</span>}
            </span>
          </li>
        ))}
      </ul>
      {impacts.length > shown.length && <span className="m-hint">and {impacts.length - shown.length} more</span>}
      <span className="m-hint">
        Everyone can repaint their answers afterwards.{merging && ' Switching back to smaller slots will not restore the lost detail.'}
      </span>
    </div>
  );
}
