import { describe, it, expect } from 'vitest';
import { parseCards, cardsToString } from '../src/engine/cards';
import { drawOuts, outsVsHand } from '../src/engine/outs';

const c = parseCards;

describe('drawOuts', () => {
  it('flush draw on the flop has 9 outs', () => {
    const r = drawOuts(c('Ah 5h'), c('Kh 9h 2c'));
    expect(r.outs.length).toBe(9);
  });
  it('open-ended straight draw has 8 outs', () => {
    const r = drawOuts(c('9s 8d'), c('7c 6h 2s'));
    expect(r.outs.length).toBe(8);
    expect(cardsToString(r.outs.map((o) => o.card)).split(' ').map((x) => x[0]).sort().join('')).toBe('5555TTTT');
  });
  it('gutshot has 4 outs', () => {
    expect(drawOuts(c('9s 8d'), c('6c 5h Ks')).outs.length).toBe(4);
  });
  it('combo draw: OESD + flush draw = 15 outs', () => {
    expect(drawOuts(c('9h 8h'), c('7h 6c 2h')).outs.length).toBe(15);
  });
  it('straight outs that put three of a suit on board are dirty', () => {
    // Board 7h 6h 2c: 5h and Th complete the straight but give three hearts
    const r = drawOuts(c('9s 8d'), c('7h 6h 2c'));
    const dirty = cardsToString(r.dirty).split(' ').sort();
    expect(dirty).toEqual(['5h', 'Th']);
    expect(r.clean.length).toBe(6);
  });
  it('flush outs that pair the board are dirty', () => {
    const r = drawOuts(c('Ah 5h'), c('Kh 9h 2c'));
    const dirty = cardsToString(r.dirty).split(' ').sort();
    expect(dirty).toEqual(['2h']);
  });
  it('non-nut flush is flagged', () => {
    const r = drawOuts(c('8h 7h'), c('Kh 4h 2c'));
    expect(r.outs.every((o) => o.reasons.some((x) => x.includes('nut flush')))).toBe(true);
  });
  it('idiot-end straight is flagged', () => {
    // Hero 5-4 on 6-7-K: 8 makes 4-8 straight, but 9-T makes higher straight possible
    const r = drawOuts(c('5s 4d'), c('6c 7h Ks'));
    const eight = r.outs.filter((o) => o.card >> 2 === 6);
    expect(eight.length).toBe(4);
    expect(eight.every((o) => o.reasons.includes('a higher straight is possible'))).toBe(true);
  });
  it('turn: hole cards must contribute', () => {
    // Board 4-flush; hero with no heart gets no flush outs
    const r = drawOuts(c('As Kd'), c('Qh 9h 5h 2h'));
    expect(r.outs.filter((o) => o.makes === 'Flush').length).toBe(0);
  });
});

describe('outsVsHand', () => {
  it('flush draw vs set on the turn: 7 outs, 44 unseen', () => {
    const r = outsVsHand(c('Ah Kh'), c('Qs Qd'), c('Qh 7h 2c 9s'));
    expect(r.unseen).toBe(44);
    expect(r.outs.length).toBe(7);
  });
  it('underpair vs overpair on the flop: 2 outs to a set', () => {
    const r = outsVsHand(c('5s 5d'), c('Ks Kd'), c('9h 7c 2s'));
    expect(r.outs.length).toBe(2);
  });
});
