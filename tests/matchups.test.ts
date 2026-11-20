import { describe, it, expect } from 'vitest';
import data from '../src/data/matchups.json';
import { parseCards } from '../src/engine/cards';
import { equityVsHand } from '../src/engine/equity';

describe('reference matchups table', () => {
  it.each(data.matchups.map((m) => [m.a, m.b, m] as const))('%s vs %s equals the engine (exact)', (a, b, m) => {
    const r = equityVsHand(parseCards(a), parseCards(b));
    expect(r.samples).toBe(1712304);
    expect(m.win).toBeCloseTo(r.win, 6);
    expect(m.tie).toBeCloseTo(r.tie, 6);
  });
});
