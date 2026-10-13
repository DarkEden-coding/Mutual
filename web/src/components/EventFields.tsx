import { useId } from 'react';
import { WEEKDAY_NAMES_LONG, WEEKDAY_NAMES_SHORT, formatHourOption } from '../lib/dates';
import { Calendar } from './Calendar';
import { useToast } from './Toast';

/** Weekday toggle chips (Mon..Sun). */
export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const short = WEEKDAY_NAMES_SHORT();
  const long = WEEKDAY_NAMES_LONG();
  const set = new Set(value);
  const toggle = (i: number) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    onChange([...next].sort((a, b) => a - b));
  };
  return (
    <div className="m-field">
      <div className="m-chip-row" role="group" aria-label="Days of the week">
        {short.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`m-chip${set.has(i) ? ' is-active' : ''}`}
            aria-pressed={set.has(i)}
            aria-label={long[i]}
            onClick={() => toggle(i)}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="m-chip-row">
        <button type="button" className="m-button is-ghost is-small" onClick={() => onChange([0, 1, 2, 3, 4])}>
          Mon to Fri
        </button>
        <button type="button" className="m-button is-ghost is-small" onClick={() => onChange([5, 6])}>
          Weekend
        </button>
        <button type="button" className="m-button is-ghost is-small" onClick={() => onChange([0, 1, 2, 3, 4, 5, 6])}>
          Every day
        </button>
      </div>
    </div>
  );
}

/** Dates calendar with a friendly message when the 62-date cap is hit. */
export function DatePicker({ value, onChange, min }: { value: string[]; onChange: (v: string[]) => void; min?: string }) {
  const toast = useToast();
  return (
    <Calendar selected={value} onChange={onChange} min={min} maxDates={62} onLimit={() => toast('You can pick up to 62 dates', 'error')} />
  );
}

function withExtra(list: number[], v: number) {
  return list.includes(v) ? list : [...list, v].sort((a, b) => a - b);
}

/** "No earlier than" / "No later than" selects (whole hours). */
export function HoursFields({
  start,
  end,
  onChange,
}: {
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}) {
  const id = useId();
  const starts = withExtra(Array.from({ length: 24 }, (_, h) => h * 60), start);
  const ends = withExtra(Array.from({ length: 24 }, (_, h) => (h + 1) * 60), end);
  return (
    <div className="m-form-row">
      <div className="m-field">
        <label className="m-label" htmlFor={`${id}-s`}>
          No earlier than
        </label>
        <select
          id={`${id}-s`}
          className="m-select"
          value={start}
          onChange={(e) => {
            const s = Number(e.target.value);
            onChange(s, end <= s ? s + 60 : end);
          }}
        >
          {starts.map((m) => (
            <option key={m} value={m}>
              {formatHourOption(m)}
            </option>
          ))}
        </select>
      </div>
      <div className="m-field">
        <label className="m-label" htmlFor={`${id}-e`}>
          No later than
        </label>
        <select
          id={`${id}-e`}
          className="m-select"
          value={end}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange(start >= v ? v - 60 : start, v);
          }}
        >
          {ends.map((m) => (
            <option key={m} value={m}>
              {formatHourOption(m)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
