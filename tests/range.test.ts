import { describe, it, expect } from 'vitest';
import { parseCards } from '../src/engine/cards';
import {
  parseRange, rangeComboCount, formatRange, classCombos, ALL_CLASSES, classComboCount, gridLabel, classOfCards,
} from '../src/engine/range';

describe('hand classes', () => {
  it('169 distinct classes, 1,326 combos', () => {
    expect(new Set(ALL_CLASSES).size).toBe(169);
    expect(ALL_CLASSES.reduce((s, c) => s + classComboCount(c), 0)).toBe(1326);
    expect(ALL_CLASSES.filter((c) => c.length === 2).length).toBe(13);
    expect(ALL_CLASSES.filter((c) => c.endsWith('s')).length).toBe(78);
    expect(ALL_CLASSES.filter((c) => c.endsWith('o')).length).toBe(78);
  });
  it('grid layout: pairs diagonal, suited above, offsuit below', () => {
    expect(gridLabel(0, 0)).toBe('AA');
    expect(gridLabel(0, 1)).toBe('AKs');
    expect(gridLabel(1, 0)).toBe('AKo');
    expect(gridLabel(12, 12)).toBe('22');
    expect(gridLabel(4, 5)).toBe('T9s');
  });
  it('combo counts: pair 6, suited 4, offsuit 12', () => {
    expect(classCombos('QQ').length).toBe(6);
    expect(classCombos('AKs').length).toBe(4);
    expect(classCombos('AKo').length).toBe(12);
  });
  it('classOfCards', () => {
    const [a, b] = parseCards('Kh Ah');
    expect(classOfCards(a, b)).toBe('AKs');
    const [c, d] = parseCards('7c 9d');
    expect(classOfCards(c, d)).toBe('97o');
  });
});

describe('range parser', () => {
  it('22+ is all 13 pairs = 78 combos', () => {
    expect(rangeComboCount(parseRange('22+'))).toBe(78);
  });
  it('A2s+ is 12 suited aces = 48 combos', () => {
    expect(rangeComboCount(parseRange('A2s+'))).toBe(48);
  });
  it('KTo+ = KTo, KJo, KQo = 36 combos', () => {
    const r = parseRange('KTo+');
    expect([...r.keys()].sort()).toEqual(['KJo', 'KQo', 'KTo']);
    expect(rangeComboCount(r)).toBe(36);
  });
  it('mixed example from spec: 22+, A2s+, KTo+, 76s = 166 combos', () => {
    expect(rangeComboCount(parseRange('22+, A2s+, KTo+, 76s'))).toBe(78 + 48 + 36 + 4);
  });
  it('dash ranges', () => {
    expect([...parseRange('77-99').keys()].sort()).toEqual(['77', '88', '99']);
    expect(rangeComboCount(parseRange('A2s-A5s'))).toBe(16);
    expect(rangeComboCount(parseRange('K9o-KJo'))).toBe(36);
  });
  it('no suffix means suited + offsuit', () => {
    expect(rangeComboCount(parseRange('AK'))).toBe(16);
    expect(rangeComboCount(parseRange('AT+'))).toBe(16 * 4);
  });
  it('weights', () => {
    expect(rangeComboCount(parseRange('AKo:0.5'))).toBe(6);
    expect(rangeComboCount(parseRange('AQs@25'))).toBe(1);
  });
  it('random = 1326', () => {
    expect(rangeComboCount(parseRange('random'))).toBe(1326);
  });
  it('rejects garbage', () => {
    expect(() => parseRange('AXs')).toThrow();
    expect(() => parseRange('AKs-QJs')).toThrow();
  });
});

describe('blocker removal', () => {
  it('one ace on board leaves 3 AA combos and 9 AKo combos', () => {
    const dead = parseCards('As 7d 2c');
    expect(rangeComboCount(parseRange('AA'), dead)).toBe(3);
    expect(rangeComboCount(parseRange('AKo'), dead)).toBe(9);
    expect(rangeComboCount(parseRange('AKs'), dead)).toBe(3);
  });
  it('hero holding Ah Kh blocks AK combos: 9 remain of 16', () => {
    expect(rangeComboCount(parseRange('AK'), parseCards('Ah Kh'))).toBe(9);
  });
  it('two board cards of a pair rank leave 1 combo', () => {
    expect(rangeComboCount(parseRange('77'), parseCards('7s 7d 2c'))).toBe(1);
  });
});

describe('range formatting round-trip', () => {
  it.each(['22+', 'A2s+', 'KTo+', '77-99', 'A5s-A2s', 'AKo', 'QJs, JTs, T9s'])('%s', (txt) => {
    const r = parseRange(txt);
    expect(parseRange(formatRange(r))).toEqual(r);
  });
  it('compresses ranges', () => {
    expect(formatRange(parseRange('22+'))).toBe('22+');
    expect(formatRange(parseRange('ATs, AJs, AQs, AKs'))).toBe('ATs+');
  });
});
