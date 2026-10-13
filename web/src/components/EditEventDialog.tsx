import { useState } from 'react';
import { ApiError, api, type EventDTO, type ParticipantDTO } from '../api';
import { formatMinute } from '../lib/slots';
import { DatePicker, HoursFields, WeekdayPicker } from './EventFields';
import { Dialog } from './Dialog';
import { useToast } from './Toast';

interface Props {
  open: boolean;
  event: EventDTO;
  onClose: () => void;
  onSaved: (event: EventDTO, participants: ParticipantDTO[]) => void;
  onDelete: () => void;
}

export function EditEventDialog({ open, event, onClose, onSaved, onDelete }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Edit event" wide>
      {open && <EditForm event={event} onClose={onClose} onSaved={onSaved} onDelete={onDelete} />}
    </Dialog>
  );
}

function EditForm({ event, onClose, onSaved, onDelete }: Omit<Props, 'open'>) {
  const toast = useToast();
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [dates, setDates] = useState(event.dates);
  const [weekdays, setWeekdays] = useState(event.weekdays);
  const [start, setStart] = useState(event.startMinute);
  const [end, setEnd] = useState(event.endMinute);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const daysOk = event.mode === 'dates' ? dates.length > 0 : weekdays.length > 0;
  const valid = title.trim().length > 0 && daysOk && end > start;

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
      <p className="m-hint">
        Slot size ({event.slotMinutes} min), timezone ({event.timezone}) and day mode cannot be changed. Removing days or hours
        clears people&apos;s answers for those times (currently {formatMinute(event.startMinute)} to {formatMinute(event.endMinute)}).
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
