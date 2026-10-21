/**
 * Group aggregation and "Best times" ranking. Pure functions, no DOM.
 */
import type { ViewGrid } from './slots';

export interface AvailabilityLike {
  id: string;
  availability: string;
}

export interface GroupCounts {
  available: Uint16Array;
  ifNeeded: Uint16Array;
  participants: number;
}

export function computeCounts(participants: AvailabilityLike[], totalSlots: number): GroupCounts {
  const available = new Uint16Array(totalSlots);
  const ifNeeded = new Uint16Array(totalSlots);
  for (const p of participants) {
    const a = p.availability;
    const n = Math.min(a.length, totalSlots);
    for (let i = 0; i < n; i++) {
      const c = a.charCodeAt(i);
      if (c === 49) available[i]++;
      else if (c === 50) ifNeeded[i]++;
    }
  }
  return { available, ifNeeded, participants: participants.length };
}

/** (available + 0.5 * ifNeeded) / participantCount, 0..1 */
export function heatIntensity(counts: GroupCounts, slot: number): number {
  if (counts.participants === 0) return 0;
  return (counts.available[slot] + 0.5 * counts.ifNeeded[slot]) / counts.participants;
}

export interface SlotRoster {
  available: string[];
  ifNeeded: string[];
  unavailable: string[];
}

export function rosterForSlot(
  participants: (AvailabilityLike & { name: string })[],
  slot: number,
): SlotRoster {
  const out: SlotRoster = { available: [], ifNeeded: [], unavailable: [] };
  for (const p of participants) {
    const c = p.availability[slot];
    if (c === '1') out.available.push(p.name);
    else if (c === '2') out.ifNeeded.push(p.name);
    else out.unavailable.push(p.name);
  }
  return out;
}

export interface BestBlock {
  id: string;
  col: number;
  rowStart: number;
  rowEnd: number; // inclusive
  /** viewer-local minute range */
  startMinute: number;
  endMinute: number;
  slots: number[];
  available: number; // fully available people
  ifNeeded: number; // "if needed" people
  total: number;
  /** available + 0.5 * ifNeeded */
  score: number;
}

export interface BestOptions {
  limit?: number;
  /** How many of the highest distinct score levels to grow blocks at (default 8). */
  levels?: number;
}

/**
 * Best-time blocks. Candidates per viewer-local day (never across gaps):
 *  1. runs of adjacent slots with an identical set of people (exact merge), and
 *  2. for each of the top score levels t, maximal runs of adjacent slots whose
 *     per-slot score (available + 0.5 * ifNeeded) is >= t. Such a run is scored by the
 *     people who can attend the WHOLE block (so "5/8 available" is always truthful).
 * Ranked by score desc, then length desc, then chronologically. A block that is fully
 * contained in a better-ranked block is dropped; blocks nobody can attend are dropped.
 */
export function findBestBlocks(
  grid: ViewGrid,
  participants: AvailabilityLike[],
  opts: BestOptions = {},
): BestBlock[] {
  const limit = opts.limit ?? 6;
  const levels = opts.levels ?? 8;
  const total = participants.length;
  if (total === 0 || grid.totalSlots === 0) return [];

  // Read people's availability strings directly instead of building a per-slot signature of every
  // participant (up to slots x people characters, rebuilt on every paint stroke). Missing chars read as '0'.
  const code = (pi: number, slot: number) => participants[pi].availability.charCodeAt(slot) || 48;
  const slotScore = new Float32Array(grid.totalSlots);
  for (let slot = 0; slot < grid.totalSlots; slot++) {
    let sc = 0;
    for (let pi = 0; pi < total; pi++) {
      const ch = code(pi, slot);
      if (ch === 49) sc += 1;
      else if (ch === 50) sc += 0.5;
    }
    slotScore[slot] = sc;
  }
  const sameSet = (x: number, y: number) => {
    for (let pi = 0; pi < total; pi++) if (code(pi, x) !== code(pi, y)) return false;
    return true;
  };

  // distinct positive score levels, best first
  const levelSet = new Set<number>();
  for (let slot = 0; slot < grid.totalSlots; slot++) if (slotScore[slot] > 0) levelSet.add(slotScore[slot]);
  const thresholds = [...levelSet].sort((a, b) => b - a).slice(0, levels);

  // Candidates stay lightweight (numeric key, no slot list) until they make the final cut.
  type Candidate = { col: number; rowStart: number; rowEnd: number; available: number; ifNeeded: number; score: number };
  const found = new Map<number, Candidate>();
  const consider = (c: number, r0: number, r1: number) => {
    const key = (c * grid.nrows + r0) * grid.nrows + r1;
    if (found.has(key)) return;
    let a = 0;
    let i = 0;
    for (let pi = 0; pi < total; pi++) {
      let all = true;
      let attends = true;
      for (let k = r0; k <= r1; k++) {
        const ch = code(pi, grid.cells[k * grid.cols + c]);
        if (ch !== 49) all = false;
        if (ch !== 49 && ch !== 50) {
          attends = false;
          break;
        }
      }
      if (!attends) continue;
      if (all) a++;
      else i++;
    }
    if (a + i === 0) return;
    found.set(key, { col: c, rowStart: r0, rowEnd: r1, available: a, ifNeeded: i, score: a + 0.5 * i });
  };

  for (let c = 0; c < grid.cols; c++) {
    // contiguous segments of real slots (no gaps, no disabled cells)
    let r = 0;
    while (r < grid.nrows) {
      if (grid.cells[r * grid.cols + c] < 0) {
        r++;
        continue;
      }
      let end = r;
      while (
        end + 1 < grid.nrows &&
        grid.cells[(end + 1) * grid.cols + c] >= 0 &&
        grid.rows[end + 1].minute - grid.rows[end].minute === grid.slotMinutes
      ) {
        end++;
      }
      const slotAt = (k: number) => grid.cells[k * grid.cols + c];
      // 1. identical-set runs
      let s0 = r;
      for (let k = r + 1; k <= end + 1; k++) {
        if (k > end || !sameSet(slotAt(k), slotAt(s0))) {
          consider(c, s0, k - 1);
          s0 = k;
        }
      }
      // 2. threshold runs
      for (const t of thresholds) {
        let start = -1;
        for (let k = r; k <= end + 1; k++) {
          const ok = k <= end && slotScore[slotAt(k)] >= t;
          if (ok && start < 0) start = k;
          else if (!ok && start >= 0) {
            consider(c, start, k - 1);
            start = -1;
          }
        }
      }
      r = end + 1;
    }
  }

  const ranked = [...found.values()].sort(
    (x, y) => y.score - x.score || y.rowEnd - y.rowStart - (x.rowEnd - x.rowStart) || x.col - y.col || x.rowStart - y.rowStart,
  );
  const out: BestBlock[] = [];
  for (const b of ranked) {
    if (out.some((o) => o.col === b.col && b.rowStart >= o.rowStart && b.rowEnd <= o.rowEnd)) continue;
    const slots: number[] = [];
    for (let k = b.rowStart; k <= b.rowEnd; k++) slots.push(grid.cells[k * grid.cols + b.col]);
    out.push({
      id: `${b.col}:${b.rowStart}-${b.rowEnd}`,
      col: b.col,
      rowStart: b.rowStart,
      rowEnd: b.rowEnd,
      startMinute: grid.rows[b.rowStart].minute,
      endMinute: grid.rows[b.rowEnd].minute + grid.slotMinutes,
      slots,
      available: b.available,
      ifNeeded: b.ifNeeded,
      total,
      score: b.score,
    });
    if (out.length >= limit) break;
  }
  return out;
}
