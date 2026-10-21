import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AdminHistoryDay } from '../api';

/** Small area sparkline over the non-null points; renders nothing with fewer than two. */
export function Sparkline({ values, label }: { values: readonly (number | null)[]; label: string }) {
  const pts = values.filter((v): v is number => v !== null);
  if (pts.length < 2) return null;
  const w = 120;
  const h = 36;
  const pad = 3;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - pad - ((v - lo) / span) * (h - pad * 2)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg className="m-admin-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path className="m-admin-spark-area" d={`${line} L${w} ${h} L0 ${h} Z`} />
      <path className="m-admin-spark-line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const H = 200;
const PAD_T = 8;
const PAD_B = 4;

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Events created (bars) and people joined (line) per day, with a hover card. */
export function HistoryChart({ history }: { history: readonly AdminHistoryDay[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [W, setW] = useState(0);
  const n = history.length;
  const empty = n === 0;

  // Draw in pixel coordinates so the plot always spans the measured width.
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => entry && setW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [empty]);

  const { max, step, bars, line } = useMemo(() => {
    const max = Math.max(1, ...history.map((d) => Math.max(d.eventsCreated, d.participantsJoined)));
    const step = W / Math.max(1, history.length);
    const y = (v: number) => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B);
    const bars = history.map((d, i) => ({ x: i * step + step * 0.18, w: step * 0.64, y: y(d.eventsCreated) }));
    const line = history
      .map((d, i) => `${i ? 'L' : 'M'}${(i * step + step / 2).toFixed(1)} ${y(d.participantsJoined).toFixed(1)}`)
      .join(' ');
    return { max, step, bars, line };
  }, [history, W]);

  if (empty) return null;

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
    setHover({ i, x: e.clientX, y: e.clientY });
  };

  const created = history.reduce((s, d) => s + d.eventsCreated, 0);
  const joined = history.reduce((s, d) => s + d.participantsJoined, 0);
  const mid = history[Math.floor((n - 1) / 2)]!;
  const hovered = hover ? history[hover.i]! : null;

  return (
    <div className="m-admin-chart">
      <div className="m-admin-legend" aria-hidden="true">
        <span className="m-admin-legend-item">
          <span className="m-admin-legend-bar" /> Events created
        </span>
        <span className="m-admin-legend-item">
          <span className="m-admin-legend-line" /> People joined
        </span>
        <span className="m-admin-legend-peak">peak {max}/day</span>
      </div>
      <svg
        ref={svgRef}
        className="m-admin-chart-svg"
        width="100%"
        height={H}
        role="img"
        aria-label={`Daily activity over the last ${n} days: ${created} events created and ${joined} people joined.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} className="m-admin-grid-line" x1={0} x2={W} y1={PAD_T + f * (H - PAD_T - PAD_B)} y2={PAD_T + f * (H - PAD_T - PAD_B)} />
        ))}
        {hover && <rect className="m-admin-hover-col" x={hover.i * step} y={0} width={step} height={H} />}
        {bars.map((b, i) => (
          <rect key={history[i]!.day} className="m-admin-bar" x={b.x} y={b.y} width={b.w} height={Math.max(0, H - PAD_B - b.y)} rx={2} />
        ))}
        <path className="m-admin-line" d={line} />
        {hover && (
          <circle
            className="m-admin-dot"
            cx={hover.i * step + step / 2}
            cy={PAD_T + (1 - hovered!.participantsJoined / max) * (H - PAD_T - PAD_B)}
            r={4}
          />
        )}
      </svg>
      <div className="m-admin-axis" aria-hidden="true">
        <span>{dayLabel(history[0]!.day)}</span>
        <span>{dayLabel(mid.day)}</span>
        <span>{dayLabel(history[n - 1]!.day)}</span>
      </div>
      {hover && hovered && <ChartTip x={hover.x} y={hover.y} day={hovered} />}
    </div>
  );
}

function ChartTip({ x, y, day }: { x: number; y: number; day: AdminHistoryDay }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 14, top: y + 14 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = x + 14 + w > window.innerWidth - 8 ? x - 14 - w : x + 14;
    const top = y + 14 + h > window.innerHeight - 8 ? y - 14 - h : y + 14;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);
  // Portalled: cards may set a backdrop-filter, which would re-anchor position: fixed.
  return createPortal(
    <div ref={ref} className="m-tooltip m-admin-tip" style={pos} role="presentation">
      <div className="m-tooltip-title">{dayLabel(day.day)}</div>
      <div className="m-tooltip-summary">
        {day.eventsCreated} created · {day.participantsJoined} joined
      </div>
      <div className="m-tooltip-summary">
        {day.availabilitySaves} saves · {day.throttled} throttled
      </div>
    </div>,
    document.body,
  );
}
