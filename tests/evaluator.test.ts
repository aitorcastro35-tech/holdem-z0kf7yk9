import { describe, it, expect } from 'vitest';
import { parseCards } from '../src/engine/cards';
import { evaluate, categoryOf, Category, describe as describeHand } from '../src/engine/evaluator';
import { fiveCardCategoryCounts, fiveCardCountsClosedForm, SEVEN_CARD_COUNTS } from '../src/engine/probabilities';

const ev = (s: string) => evaluate(parseCards(s));
const cat = (s: string) => categoryOf(ev(s));

describe('evaluator: categories', () => {
  it.each([
    ['As Ks Qs Js Ts', Category.StraightFlush],
    ['9h 8h 7h 6h 5h', Category.StraightFlush],
    ['5d 4d 3d 2d Ad', Category.StraightFlush],
    ['Qc Qd Qh Qs 2c', Category.Quads],
    ['Kc Kd Kh 2s 2c', Category.FullHouse],
    ['Ah 9h 7h 4h 2h', Category.Flush],
    ['Ts 9h 8d 7c 6s', Category.Straight],
    ['As 2d 3h 4c 5s', Category.Straight],
    ['7s 7d 7h Kc 2s', Category.Trips],
    ['Js Jd 4h 4c As', Category.TwoPair],
    ['Ts Td 8h 4c 2s', Category.Pair],
    ['As Qd 9h 6c 3s', Category.HighCard],
  ])('%s', (hand, expected) => {
    expect(cat(hand)).toBe(expected);
  });

  it('describes royal flush and wheel', () => {
    expect(describeHand(ev('As Ks Qs Js Ts'))).toBe('Royal flush');
    expect(describeHand(ev('As 2d 3h 4c 5s'))).toBe('Straight, Five-high');
  });
});

describe('evaluator: 7-card best hand', () => {
  it('finds a straight flush hidden among a flush and straight', () => {
    expect(cat('9h 8h 7h 6h 5h Ah Ts')).toBe(Category.StraightFlush);
  });
  it('two trips make a full house', () => {
    expect(describeHand(ev('Ks Kd Kh 8c 8s 8d 2c'))).toBe('Full house, Kings full of Eights');
  });
  it('trips + two pairs picks the highest pair', () => {
    expect(describeHand(ev('5s 5d 5h Qc Qs 9d 9c'))).toBe('Full house, Fives full of Queens');
  });
  it('three pairs uses best two pairs and the third pair can be the kicker', () => {
    // AA KK QQ 2 → AAKK with Q kicker beats AAKK with J kicker
    expect(ev('As Ad Ks Kd Qh Qc 2s')).toBeGreaterThan(ev('As Ad Ks Kd Jh Tc 2s'));
  });
  it('6-high straight beats the wheel', () => {
    expect(ev('As 2d 3h 4c 5s 6d 9c')).toBeGreaterThan(ev('As 2d 3h 4c 5s Kd 9c'));
    expect(describeHand(ev('As 2d 3h 4c 5s 6d 9c'))).toBe('Straight, Six-high');
  });
  it('wheel is the lowest straight but beats trips', () => {
    expect(cat('Ah 2d 3h 4c 5s Kd Kc')).toBe(Category.Straight);
  });
});

describe('evaluator: ties and kickers', () => {
  it('kicker decides one pair', () => {
    // Board Ah 9c 7d 4s 2h; AK vs AQ
    expect(ev('Ah 9c 7d 4s 2h Ks 3c')).toBeGreaterThan(ev('Ah 9c 7d 4s 2h Qs 3d'));
  });
  it('board plays → tie', () => {
    // Board is a straight T-9-8-7-6; both players hold junk below
    expect(ev('Ts 9h 8d 7c 6s 2c 3d')).toBe(ev('Ts 9h 8d 7c 6s 2h 4h'));
  });
  it('kicker beyond five cards does not count', () => {
    // Board: K K Q Q J. Hero A x vs Villain T x → hero's A plays; but two players with 2 and 3 tie (J kicker).
    expect(ev('Ks Kd Qh Qc Js 2c 3d')).toBe(ev('Ks Kd Qh Qc Js 3c 4d'));
    expect(ev('Ks Kd Qh Qc Js Ac 3d')).toBeGreaterThan(ev('Ks Kd Qh Qc Js Tc 4d'));
  });
  it('counterfeited two pair: 7-6 on 8-8-5-5 board loses to any ace kicker', () => {
    // Hero 7c6c on 8s 8d 5h 5c Kd → plays 8855K; villain A2 → 8855A
    const hero = ev('7c 6c 8s 8d 5h 5c Kd');
    const vill = ev('Ah 2h 8s 8d 5h 5c Kd');
    expect(vill).toBeGreaterThan(hero);
    expect(describeHand(hero)).toBe('Two pair, Eights and Fives');
  });
  it('flush compares all five cards', () => {
    expect(ev('Ah Kh 9h 7h 3h')).toBeGreaterThan(ev('Ah Kh 9h 7h 2h'));
  });
  it('quads kicker', () => {
    expect(ev('9s 9d 9h 9c Ad 2c 3c')).toBeGreaterThan(ev('9s 9d 9h 9c Kd Qc Jc'));
  });
  it('equal hands in different suits tie', () => {
    expect(ev('As Kd Qh Jc 9s')).toBe(ev('Ah Kc Qd Js 9h'));
  });
});

// Expected values: Wikipedia "Poker probability", 5-card and 7-card frequency tables
// (https://en.wikipedia.org/wiki/Poker_probability, revision of 22 Aug 2026). See SOURCES.md.
describe('evaluator: exhaustive frequency counts', () => {
  it('5-card hands match published frequencies (2,598,960 hands)', () => {
    const c = fiveCardCategoryCounts();
    expect(c[9]).toBe(4); // royal flush
    expect(c[8] - c[9]).toBe(36); // straight flush excl. royal
    expect(c[7]).toBe(624);
    expect(c[6]).toBe(3744);
    expect(c[5]).toBe(5108);
    expect(c[4]).toBe(10200);
    expect(c[3]).toBe(54912);
    expect(c[2]).toBe(123552);
    expect(c[1]).toBe(1098240);
    expect(c[0]).toBe(1302540);
    expect(fiveCardCountsClosedForm()).toEqual(c);
  });

  it('7-card hands match published frequencies (133,784,560 hands)', () => {
    const counts = new Array(9).fill(0);
    let royal = 0;
    const h = new Int32Array(7);
    for (let a = 0; a < 46; a++) {
      h[0] = a;
      for (let b = a + 1; b < 47; b++) {
        h[1] = b;
        for (let c = b + 1; c < 48; c++) {
          h[2] = c;
          for (let d = c + 1; d < 49; d++) {
            h[3] = d;
            for (let e = d + 1; e < 50; e++) {
              h[4] = e;
              for (let f = e + 1; f < 51; f++) {
                h[5] = f;
                for (let g = f + 1; g < 52; g++) {
                  h[6] = g;
                  const s = evaluate(h, 7);
                  const k = s >> 20;
                  counts[k]++;
                  if (k === 8 && ((s >> 16) & 0xf) === 12) royal++;
                }
              }
            }
          }
        }
      }
    }
    expect(royal).toBe(4324);
    expect(counts[8] - royal).toBe(37260);
    expect(counts[7]).toBe(224848);
    expect(counts[6]).toBe(3473184);
    expect(counts[5]).toBe(4047644);
    expect(counts[4]).toBe(6180020);
    expect(counts[3]).toBe(6461620);
    expect(counts[2]).toBe(31433400);
    expect(counts[1]).toBe(58627800);
    expect(counts[0]).toBe(23294460);
    expect([...counts, royal]).toEqual(SEVEN_CARD_COUNTS);
  }, 600_000);
});
