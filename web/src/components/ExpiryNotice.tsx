import { useState } from 'react';
import { ApiError, api, type EventDTO } from '../api';
import { canExtend, extendedExpiry, formatExpiryDate, timeLeft } from '../lib/expiry';
import { Dialog } from './Dialog';
import { IconHourglass } from './Icons';
import { useToast } from './Toast';
import { Tooltip } from './Tooltip';

interface Props {
  event: EventDTO;
  onExtended: (event: EventDTO) => void;
}

/**
 * Deletion date badge for the event header. In the last days before deletion the badge turns into
 * a warning button, and the keep-alive dialog opens once when the page is opened.
 */
export function ExpiryNotice({ event, onExtended }: Props) {
  const toast = useToast();
  const soon = canExtend(event.expiresAt);
  const [open, setOpen] = useState(soon);
  const [busy, setBusy] = useState(false);
  const left = timeLeft(event.expiresAt);
  const date = formatExpiryDate(event.expiresAt);

  async function extend() {
    setBusy(true);
    try {
      const r = await api.extendEvent(event.id);
      onExtended(r.event);
      toast(`Kept until ${formatExpiryDate(r.event.expiresAt)}`, 'success');
      setOpen(false);
    } catch (err) {
      // too_early means someone else just extended it; the live stream brings the new date.
      if (err instanceof ApiError && err.code === 'too_early') setOpen(false);
      else toast(err instanceof ApiError ? err.message : 'Could not extend the event', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {soon ? (
        <Tooltip content="Keep this event for another month.">
          <button type="button" className="m-expiry-badge is-soon" onClick={() => setOpen(true)}>
            <IconHourglass size={14} />
            Deleted in {left.value} {left.unit} · Keep it
          </button>
        </Tooltip>
      ) : (
        <Tooltip content={`Deleted automatically ${event.keepMonths} ${event.keepMonths === 1 ? 'month' : 'months'} after its last date. You can add more time during the last 10 days.`}>
          <span className="m-expiry-badge" tabIndex={0}>
            <IconHourglass size={14} />
            Kept until {date}
          </span>
        </Tooltip>
      )}
      <Dialog
        open={open && soon}
        onClose={() => !busy && setOpen(false)}
        title="This event will be deleted soon"
        footer={
          <>
            <button type="button" className="m-button" onClick={() => setOpen(false)} disabled={busy}>
              Not now
            </button>
            <button type="button" className="m-button is-primary" onClick={() => void extend()} disabled={busy}>
              {busy ? 'Extending...' : 'Keep for another month'}
            </button>
          </>
        }
      >
        <div className="m-expiry">
          <div className="m-expiry-count" aria-hidden="true">
            <span className="m-expiry-num">{left.value}</span>
            <span className="m-expiry-unit">{left.unit} left</span>
          </div>
          <div className="m-expiry-text">
            <p>
              <strong>{event.title}</strong> and everyone&apos;s responses will be permanently deleted on{' '}
              <strong>{formatExpiryDate(event.expiresAt, true)}</strong>.
            </p>
            <p className="m-hint">
              Still planning? Keep it until {formatExpiryDate(extendedExpiry(event.expiresAt))}. You can add another month whenever it gets
              this close again.
            </p>
          </div>
        </div>
      </Dialog>
    </>
  );
}
