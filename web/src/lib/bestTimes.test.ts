import { describe, expect, it } from 'vitest';
import { computeCounts, findBestBlocks, heatIntensity, rosterForSlot } from './bestTimes';
import { buildViewGrid, type SlotEventShape } from './slots';

const event: SlotEventShape = {
  mode: 'dates',
  dates: ['2024-10-14', '2024-10-15'],
  weekdays: [],
  startMinute: 9 * 60,
  endMinute: 13 * 60,
  slotMinutes: 60,
  timezone: 'UTC',
};
// 4 slots/day: day0 = 0..3, day1 = 4..7
const people = [
  { id: 'a', name: 'Ann', availability: '11100000' },
  { id: 'b', name: 'Bo', availability: '01220000' },
  { id: 'c', name: 'Cy', availability: '01100011' },
];

describe('group counts', () => {
  it('counts and computes heat intensity', () => {
    const c = computeCounts(people, 8);
    expect(Array.from(c.available)).toEqual([1, 3, 2, 0, 0, 0, 1, 1]);
    expect(Array.from(c.ifNeeded)).toEqual([0, 0, 1, 1, 0, 0, 0, 0]);
    expect(heatIntensity(c, 2)).toBeCloseTo((2 + 0.5) / 3);
    expect(heatIntensity(computeCounts([], 8), 0)).toBe(0);
  });

  it('builds a roster', () => {
    const r = rosterForSlot(people, 2);
    expect(r.available).toEqual(['Ann', 'Cy']);
    expect(r.ifNeeded).toEqual(['Bo']);
    expect(r.unavailable).toEqual([]);
    expect(rosterForSlot(people, 0).unavailable).toEqual(['Bo', 'Cy']);
  });
});

describe('findBestBlocks', () => {
  const grid = buildViewGrid(event, 'UTC', 'en-US');

  it('merges adjacent identical slots and ranks by score then length', () => {
    const blocks = findBestBlocks(grid, people);
    // slot1: a,b?no (b=1 at idx1 -> '1'), so slots 1: a=1,b=1,c=1 ; slot2: a=1,b=2,c=1 ; differ
    expect(blocks[0].slots).toEqual([1]);
    expect(blocks[0].score).toBe(3);
    // [1,2] is a longer block everyone can attend (Bo is "if needed" in slot 2)
    expect(blocks[1].slots).toEqual([1, 2]);
    expect(blocks[1].score).toBe(2.5);
    expect(blocks[1].ifNeeded).toBe(1);
    // slot 2 alone is contained in [1,2], so it is not listed separately
    expect(blocks.some((b) => b.slots.length === 1 && b.slots[0] === 2)).toBe(false);
  });

  it('grows blocks across slots whose sets differ and scores by the whole-block intersection', () => {
    const p = [
      { id: 'a', availability: '11110000' },
      { id: 'b', availability: '01110000' },
      { id: 'c', availability: '00100000' },
    ];
    const blocks = findBestBlocks(grid, p);
    // slot 2 has all three; slots 1-3 have a+b; slot 0-3 has a only
    expect(blocks[0]).toMatchObject({ slots: [2], available: 3, score: 3 });
    expect(blocks[1]).toMatchObject({ slots: [1, 2, 3], available: 2, score: 2 });
    expect(blocks[2]).toMatchObject({ slots: [0, 1, 2, 3], available: 1, score: 1 });
  });

  it('ranks score desc, then duration desc, on demo-like alternating data', () => {
    const p = [
      { id: 'a', availability: '10101010' },
      { id: 'b', availability: '01101010' },
    ];
    const blocks = findBestBlocks(grid, p);
    for (let i = 1; i < blocks.length; i++) {
      const [x, y] = [blocks[i - 1], blocks[i]];
      expect(x.score > y.score || (x.score === y.score && x.slots.length >= y.slots.length)).toBe(true);
    }
    expect(blocks[0].score).toBe(2);
  });

  it('merges identical neighbours', () => {
    const same = [
      { id: 'a', availability: '11110000' },
      { id: 'b', availability: '11110000' },
    ];
    const blocks = findBestBlocks(grid, same);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].slots).toEqual([0, 1, 2, 3]);
    expect(blocks[0].startMinute).toBe(540);
    expect(blocks[0].endMinute).toBe(780);
  });

  it('never merges across days and drops empty blocks', () => {
    const p = [{ id: 'a', availability: '00110011' }];
    const blocks = findBestBlocks(grid, p);
    expect(blocks.map((b) => b.slots)).toEqual([[2, 3], [6, 7]]);
    expect(findBestBlocks(grid, [{ id: 'a', availability: '00000000' }])).toEqual([]);
    expect(findBestBlocks(grid, [])).toEqual([]);
  });

  it('prefers longer blocks on equal score, then chronological', () => {
    const p = [{ id: 'a', availability: '10110011' }];
    const blocks = findBestBlocks(grid, p);
    expect(blocks.map((b) => b.slots.length)).toEqual([2, 2, 1]);
    expect(blocks[0].col).toBe(0);
  });

  it('does not merge slots separated by a gap in viewer time', () => {
    const e: SlotEventShape = { ...event, timezone: 'Asia/Tokyo', dates: ['2024-10-14'], startMinute: 9 * 60, endMinute: 17 * 60 };
    const g = buildViewGrid(e, 'America/Los_Angeles', 'en-US');
    const p = [{ id: 'a', availability: '1'.repeat(8) }];
    const blocks = findBestBlocks(g, p);
    // the 00:00 slot (on the next local day) is its own column; the other 7 are one block
    expect(blocks.map((b) => b.slots.length).sort()).toEqual([1, 7]);
  });
});
