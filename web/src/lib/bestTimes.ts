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

  const slotScore = new Float32Array(grid.totalSlots);
  const slotSig: string[] = new Array(grid.totalSlots);
  for (let slot = 0; slot < grid.totalSlots; slot++) {
    let sig = '';
    let sc = 0;
    for (const p of participants) {
      const ch = p.availability[slot] ?? '0';
      sig += ch;
      if (ch === '1') sc += 1;
      else if (ch === '2') sc += 0.5;
    }
    slotSig[slot] = sig;
    slotScore[slot] = sc;
  }

  // distinct positive score levels, best first
  const levelSet = new Set<number>();
  for (let slot = 0; slot < grid.totalSlots; slot++) if (slotScore[slot] > 0) levelSet.add(slotScore[slot]);
  const thresholds = [...levelSet].sort((a, b) => b - a).slice(0, levels);

  const found = new Map<string, BestBlock>();
  const consider = (c: number, r0: number, r1: number) => {
    const id = `${c}:${r0}-${r1}`;
    if (found.has(id)) return;
    const slots: number[] = [];
    for (let k = r0; k <= r1; k++) slots.push(grid.cells[k * grid.cols + c]);
    let a = 0;
    let i = 0;
    for (let pi = 0; pi < total; pi++) {
      let all = true;
      let attends = true;
      for (const slot of slots) {
        const ch = slotSig[slot].charCodeAt(pi);
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
    found.set(id, {
      id,
      col: c,
      rowStart: r0,
      rowEnd: r1,
      startMinute: grid.rows[r0].minute,
      endMinute: grid.rows[r1].minute + grid.slotMinutes,
      slots,
      available: a,
      ifNeeded: i,
      total,
      score: a + 0.5 * i,
    });
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
        if (k > end || slotSig[slotAt(k)] !== slotSig[slotAt(s0)]) {
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
    (x, y) => y.score - x.score || y.slots.length - x.slots.length || x.col - y.col || x.rowStart - y.rowStart,
  );
  const out: BestBlock[] = [];
  for (const b of ranked) {
    if (out.some((o) => o.col === b.col && b.rowStart >= o.rowStart && b.rowEnd <= o.rowEnd)) continue;
    out.push(b);
    if (out.length >= limit) break;
  }
  return out;
}
