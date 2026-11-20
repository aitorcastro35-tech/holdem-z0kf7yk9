import { describe, it, expect } from 'vitest';
import { parseCards } from '../src/engine/cards';
import { features, passes, filteredCombos } from '../src/engine/handclass';
import { parseRange } from '../src/engine/range';

const f = (h: string, b: string) => features(parseCards(h), parseCards(b));

describe('hand features', () => {
  it('pairs', () => {
    expect(f('Ah Kd', 'Ks 7c 2d').pair).toBe('top');
    expect(f('Qh Qd', 'Js 7c 2d').pair).toBe('overpair');
    expect(f('8h 7d', 'Ks 7c 2d').pair).toBe('second');
    expect(f('5h 5d', 'Ks 7c 2d').pair).toBe('underpair');
  });
  it('board pair does not count as hero improving', () => {
    const x = f('Ah Kd', '7s 7c 2d');
    expect(x.improvesBoard).toBe(false);
    expect(passes(x, 'pair-plus')).toBe(false);
  });
  it('draws', () => {
    expect(f('Ah 5h', 'Kh 9h 2c').flushDraw).toBe(true);
    expect(f('Ah 5h', 'Kh 9h 2c').nutFlushDraw).toBe(true);
    expect(f('Qh 5h', 'Kh 9h 2c').nutFlushDraw).toBe(false);
    expect(f('Kh 5h', 'Ah 9h 2c').nutFlushDraw).toBe(true);
    expect(f('9s 8d', '7c 6h 2s').oesd).toBe(true);
    expect(f('9s 8d', '6c 5h Ks').gutshot).toBe(true);
    expect(f('9s 8d', '6c 5h Ks').oesd).toBe(false);
  });
  it('filtered range counts respect blockers', () => {
    // QQ+, AK on K72r: KK set (3 combos), AK top pair (12 - with K on board: 3×4=12), QQ/AA overpair/underpair
    const combos = filteredCombos(parseRange('QQ+, AK'), parseCards('Ks 7c 2d'), [], 'top-pair-plus');
    // AA (6, overpair), KK (3, set), AK (12, top pair); QQ is an underpair → excluded
    expect(combos.length).toBe(6 + 3 + 12);
  });
});
