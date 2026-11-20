// Procedural spot generators. Preflop spots are graded against the cited charts; postflop "math spots"
// are graded by equity vs a stated villain range against the price (see gradeByEquity).
import { type Card, FULL_DECK, mulberry32, shuffle, cardsToString } from '../engine/cards';
import { classOfCards, classCombos, ALL_CLASSES, gridLabel, parseRange, expandRange } from '../engine/range';
import { features, describeFeatures, FILTER_LABEL } from '../engine/handclass';
import { requiredEquity } from '../engine/odds';
import type { EquityResult } from '../engine/equity';
import { CHARTS, POSITIONS, chartAction, findChart, type Chart, type TableSize, type Position } from '../data/charts';
import type { Settings } from '../store/settings';
import type { Option, Spot, VillainSpec } from './types';
import { gradeByEquity, isStrongDraw, villainCombos, handFamily, CLOSE_MARGIN } from './compute';

export type Rng = () => number;
export const pick = <T,>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const r1 = (x: number) => Math.round(x * 10) / 10;

// ---------- boundary hands (for difficulty) ----------
function boundaryClasses(chart: Chart): string[] {
  const out: string[] = [];
  for (let r = 0; r < 13; r++)
    for (let c = 0; c < 13; c++) {
      const a = chartAction(chart, gridLabel(r, c));
      const nb = [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ].filter(([x, y]) => x >= 0 && x < 13 && y >= 0 && y < 13);
      if (nb.some(([x, y]) => chartAction(chart, gridLabel(x, y)) !== a)) out.push(gridLabel(r, c));
    }
  return out;
}

function sampleHand(rng: Rng, chart: Chart, difficulty: Settings['difficulty']): Card[] {
  const pBoundary = difficulty === 'easy' ? 0.15 : difficulty === 'normal' ? 0.5 : 0.8;
  const cls = rng() < pBoundary ? pick(rng, boundaryClasses(chart)) : null;
  if (cls) {
    const combos = classCombos(cls);
    return [...pick(rng, combos)];
  }
  // uniform over all 1,326 combos
  const deck = shuffle(FULL_DECK, rng);
  return [deck[0], deck[1]];
}

const PREFLOP_CONCEPTS = ['preflop-ranges', 'position'];

// ---------- Mode A: RFI ----------
export function generateRfiSpot(rng: Rng, s: Settings): Spot {
  const positions = POSITIONS[s.tableSize].filter((p) => findChart('rfi', s.tableSize, p));
  const pos = pick(rng, positions);
  const chart = findChart('rfi', s.tableSize, pos)!;
  const hero = sampleHand(rng, chart, s.difficulty);
  const cls = classOfCards(hero[0], hero[1]);
  const action = chartAction(chart, cls);
  const isSB = pos === 'SB';
  const pot = 1.5;
  const toCall = isSB ? 0.5 : 1;
  const sizes = isSB ? [3, 4] : [2.5, 3, 4];
  const options: Option[] = [
    { key: 'fold', kind: 'fold', label: 'Fold' },
    { key: 'call', kind: 'call', label: isSB ? 'Complete (0.5)' : 'Limp (1)' },
    ...sizes.map((x) => ({ key: `raise-${x}`, kind: 'raise' as const, amount: x, label: `Raise ${x}bb` })),
  ];
  const std = isSB ? 'raise-3' : 'raise-2.5';
  const grades: Spot['grades'] = {};
  let best: string;
  const inRange = action !== 'fold';
  if (inRange && chart.mixedActions) {
    for (const o of options) grades[o.key] = o.kind === 'raise' || o.kind === 'call' ? 'ok' : 'mistake';
    best = std;
  } else if (inRange) {
    for (const o of options) grades[o.key] = o.key === std ? 'best' : o.kind === 'raise' ? 'ok' : 'mistake';
    best = std;
  } else {
    grades.fold = 'best';
    best = 'fold';
  }
  const later = POSITIONS[s.tableSize].slice(POSITIONS[s.tableSize].indexOf(pos) + 1).length;
  const why: string[] = [];
  if (inRange) {
    why.push(`${cls} is inside the ${pos} opening range (${chart.title}). Open-raise it.`);
    if (chart.mixedActions) why.push('This chart mixes raising and completing from the small blind: either is acceptable; folding gives up a hand the chart plays.');
    else why.push(`Standard size from the chart's assumptions: ${isSB ? '3bb from the SB' : '2.5bb'}. Other raise sizes are fine; limping is not part of this strategy.`);
  } else {
    why.push(`${cls} is outside the ${pos} opening range — fold it.`);
    why.push('Opening too wide out of position costs money against the players still to act.');
  }
  why.push(`${later} player${later === 1 ? '' : 's'} still act after you; the fewer players behind, the wider you can open.`);
  return {
    id: `rfi-${s.tableSize}-${pos}-${cardsToString(hero).replace(' ', '')}`,
    origin: 'chart',
    mode: 'A',
    street: 'preflop',
    tableSize: s.tableSize,
    heroPos: pos,
    hero,
    board: [],
    pot,
    toCall,
    effStack: s.stackDepth,
    history: `Folded to you in the ${pos}. Blinds 0.5 / 1.`,
    options,
    grades,
    best,
    gradeBasis: 'chart',
    why,
    concepts: PREFLOP_CONCEPTS,
    assumptions: [chart.assumptions, ...(chart.note ? [chart.note] : []), ...(s.stackDepth !== 100 ? [`Your stack setting is ${s.stackDepth}bb; the chart assumes ~100bb.`] : [])],
    sources: [chart.source],
    exploit: inRange
      ? 'In loose home games where several players call opens, raise a bit bigger (3–4bb) with your strong hands and lean on high-card strength rather than very wide steals.'
      : 'If the players behind you are very passive and rarely 3-bet, you can widen opens slightly from late position — but early-position discipline still pays.',
    tags: ['preflop', 'rfi', pos, handFamily(hero), inRange ? 'open-range' : 'fold-range'],
    chartId: chart.id,
  };
}

// ---------- Mode B: preflop facing an open ----------
export function generateVsOpenSpot(rng: Rng, s: Settings): Spot {
  const charts = CHARTS.filter((c) => c.kind === 'vsOpen');
  const chart = pick(rng, charts);
  const hero = sampleHand(rng, chart, s.difficulty);
  const cls = classOfCards(hero[0], hero[1]);
  const action = chartAction(chart, cls);
  const heroIsBB = chart.hero === 'BB';
  const openSize = 2.5;
  const pot = 1.5 + openSize; // blinds + open
  const toCall = heroIsBB ? openSize - 1 : openSize;
  const threeBet = heroIsBB ? 10 : 7.5; // ~4x OOP, ~3x IP (Poker Skill / PokerCoaching sizing guidance)
  const options: Option[] = [
    { key: 'fold', kind: 'fold', label: 'Fold' },
    { key: 'call', kind: 'call', label: `Call ${toCall}` },
    { key: `raise-${threeBet}`, kind: 'raise', amount: threeBet, label: `3-bet to ${threeBet}` },
  ];
  const tb = `raise-${threeBet}`;
  const grades: Spot['grades'] = {};
  let best = 'fold';
  if (action === 'fold') grades.fold = 'best';
  else if (chart.mixedActions) {
    grades.call = 'ok';
    grades[tb] = 'ok';
    best = 'call';
  } else if (action === 'threebet') {
    grades[tb] = 'best';
    best = tb;
  } else {
    grades.call = 'best';
    best = 'call';
  }
  const openerChart = findChart('rfi', 6, chart.villain as Position)!;
  const villain: VillainSpec = { label: `${chart.villain} 6-max opening range (${openerChart.parts[0].range})`, parts: [{ range: openerChart.parts[0].range }] };
  const req = requiredEquity(toCall, pot + toCall);
  const why = [
    action === 'fold'
      ? `${cls} is not in the ${chart.title} continuing range — fold.`
      : chart.mixedActions
        ? `${cls} is in the defending range: call or 3-bet (the source doesn't split them).`
        : `${cls} is a ${action === 'threebet' ? '3-bet' : 'call'} in this chart.`,
    `Price: call ${toCall} to win ${pot}: you need ${(req * 100).toFixed(1)}% raw equity — but preflop you won't realize all of it, especially out of position.`,
    heroIsBB ? 'The big blind already has 1bb invested, so it gets the best price and defends the widest.' : 'On the button you will have position for the rest of the hand, which lets you call more hands than from the blinds.',
  ];
  if (action === 'threebet' && /^A[2-5]s$/.test(cls)) why.push('Small suited aces make good 3-bet bluffs: they block AA/AK and can make nut flushes and wheels.');
  return {
    id: `vsopen-${chart.id}-${cardsToString(hero).replace(' ', '')}`,
    origin: 'chart',
    mode: 'B',
    street: 'preflop',
    tableSize: 6,
    heroPos: chart.hero,
    villainPos: chart.villain,
    hero,
    board: [],
    pot,
    toCall,
    effStack: s.stackDepth - (heroIsBB ? 1 : 0),
    history: `${chart.villain} opens to ${openSize}bb, folded to you in the ${chart.hero}.`,
    villain,
    options,
    grades,
    best,
    gradeBasis: 'chart',
    why,
    concepts: ['preflop-ranges', 'pot-odds', 'position'],
    assumptions: [chart.assumptions, 'Uses a 6-max chart (no verified free full-ring vs-open chart was found).', 'Equity shown is all-in raw equity vs the opener\'s full opening range; preflop decisions also depend on position and playability.'],
    sources: [chart.source, openerChart.source],
    exploit:
      'At low-stakes home games opens are often weaker than a chart range and many players call behind: 3-bet your value hands bigger, and call less with dominated offsuit hands (e.g. KJo, QTo) out of position.',
    tags: ['preflop', 'vs-open', chart.hero, handFamily(hero), heroIsBB ? 'oop' : 'ip', 'facing-bet'],
    chartId: chart.id,
  };
}

// ---------- Mode B: postflop math spots ----------
type Wanted = 'draw' | 'made' | 'air';
const BET_FRACTIONS: [number, string][] = [
  [1 / 3, '⅓ pot'],
  [1 / 2, '½ pot'],
  [3 / 4, '¾ pot'],
  [1, 'pot'],
];

export interface Context {
  heroPos: Position;
  villainPos: Position;
  ip: boolean;
  heroRange: string;
  villainRange: string;
  villainChartSource: string;
  heroChartSource: string;
  /** Pot on the flop after a 2.5bb open and a call (dead blinds included). */
  flopPot: number;
}

export function contexts(tableSize: TableSize): Context[] {
  const btn = findChart('rfi', tableSize, 'BTN')!;
  const co = findChart('rfi', tableSize, 'CO')!;
  const bbDef = CHARTS.find((c) => c.id === '6-vs-BB-BTN')!;
  const btnVsCo = CHARTS.find((c) => c.id === '6-vs-BTN-CO')!;
  return [
    // BB calls a BTN open: SB's 0.5 is dead → 2.5 + 2.5 + 0.5 = 5.5bb
    { heroPos: 'BB', villainPos: 'BTN', ip: false, heroRange: bbDef.parts[0].range, villainRange: btn.parts[0].range, villainChartSource: btn.source, heroChartSource: bbDef.source, flopPot: 5.5 },
    // BTN calls a CO open: both blinds dead → 2.5 + 2.5 + 0.5 + 1 = 6.5bb
    { heroPos: 'BTN', villainPos: 'CO', ip: true, heroRange: btnVsCo.parts[1].range, villainRange: co.parts[0].range, villainChartSource: co.source, heroChartSource: btnVsCo.source, flopPot: 6.5 },
  ];
}

export async function generateMathSpot(
  rng: Rng,
  s: Settings,
  equityFn: (hero: Card[], combos: ReturnType<typeof villainCombos>, board: Card[]) => Promise<EquityResult>,
  forceStreet?: 'flop' | 'turn' | 'river',
): Promise<Spot> {
  const minMargin = s.difficulty === 'easy' ? 0.1 : s.difficulty === 'normal' ? 0.04 : 0;
  let fallback: Spot | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const ctx = pick(rng, contexts(s.tableSize));
    const street = forceStreet ?? pick(rng, ['flop', 'flop', 'turn', 'turn', 'river'] as const);
    const wanted: Wanted = street === 'river' ? pick(rng, ['made', 'made', 'air'] as Wanted[]) : pick(rng, ['draw', 'draw', 'made', 'air'] as Wanted[]);
    const nBoard = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
    // sample hero combo from hero's preflop calling range and a board matching the wanted type
    const heroCombos = expandRange(parseRange(ctx.heroRange));
    let hero: Card[] = [];
    let board: Card[] = [];
    for (let k = 0; k < 400; k++) {
      hero = [...pick(rng, heroCombos).cards];
      const deck = shuffle(FULL_DECK.filter((c) => !hero.includes(c)), rng);
      board = deck.slice(0, nBoard);
      const f = features(hero, board);
      const made = f.category >= 1 && f.improvesBoard;
      const draw = isStrongDraw(f, board) && !made;
      const air = !made && !draw && !f.gutshot;
      if ((wanted === 'draw' && draw) || (wanted === 'made' && made) || (wanted === 'air' && air)) break;
    }
    const f = features(hero, board);
    const [frac, fracLabel] = pick(rng, BET_FRACTIONS);
    // pot path: single-raised pot, 2.5bb open called → 5.5bb (SB's 0.5 dead); half-pot bets called on earlier streets
    let pot = ctx.flopPot;
    let invested = 2.5;
    const lines: string[] = [`${ctx.villainPos} opens 2.5bb, you call in the ${ctx.heroPos}.`];
    const streetsBefore = (['flop', 'turn', 'river'] as const).slice(0, ['flop', 'turn', 'river'].indexOf(street));
    for (const st of streetsBefore) {
      const b = r1(pot / 2);
      lines.push(`${st[0].toUpperCase() + st.slice(1)}: ${ctx.ip ? `${ctx.villainPos} bets ${b}` : `you check, ${ctx.villainPos} bets ${b}`}, you call.`);
      pot = r1(pot + 2 * b);
      invested += b;
    }
    const bet = r1(pot * frac);
    lines.push(`${street[0].toUpperCase() + street.slice(1)}: ${ctx.ip ? '' : 'you check, '}${ctx.villainPos} bets ${bet} (${fracLabel}).`);
    const villain: VillainSpec =
      street === 'river'
        ? {
            label: `${ctx.villainPos}'s opening range, betting ${FILTER_LABEL['top-pair-plus']} for value plus a quarter of their no-pair hands as bluffs`,
            parts: [
              { range: ctx.villainRange, filter: 'top-pair-plus' },
              { range: ctx.villainRange, filter: 'air', weight: 0.25 },
            ],
          }
        : { label: `${ctx.villainPos}'s opening range, betting ${FILTER_LABEL['value-and-draws']}`, parts: [{ range: ctx.villainRange, filter: 'value-and-draws' }] };
    const combos = villainCombos(villain, hero, board);
    if (combos.length < 3) continue;
    const eq = await equityFn(hero, combos, board);
    const potWithBet = r1(pot + bet);
    const req = requiredEquity(bet, potWithBet + bet);
    const options: Option[] = [
      { key: 'fold', kind: 'fold', label: 'Fold' },
      { key: 'call', kind: 'call', label: `Call ${bet}` },
      { key: 'raise', kind: 'raise', amount: r1(bet * 3), label: `Raise to ${r1(bet * 3)}` },
    ];
    const strong = isStrongDraw(f, board);
    const { grades, best } = gradeByEquity(eq.equity, req, { options, strongDraw: strong, street });
    const margin = eq.equity - req;
    const eqTxt = `${(eq.equity * 100).toFixed(1)}%`;
    const why = [
      `You call ${bet} to win ${potWithBet}: required equity = ${bet} / ${r1(potWithBet + bet)} = ${(req * 100).toFixed(1)}%.`,
      `Against the stated range your ${describeFeatures(f).toLowerCase()} has ${eq.exact ? '' : '≈'}${eqTxt} equity — ${margin >= 0 ? 'more' : 'less'} than needed by ${Math.abs(margin * 100).toFixed(1)} points.`,
    ];
    if (Math.abs(margin) < CLOSE_MARGIN) why.push('That is within 3 points: a close spot where calling and folding are both reasonable; stack depth and future streets decide it.');
    else if (best === 'call') why.push('Calling makes money on average even if no more chips go in.');
    else if (best === 'fold') why.push('Calling loses money on average at this price.');
    else why.push('With 60%+ equity against the betting range, raising for value is strongest.');
    if (strong && street === 'flop') why.push('Equity assumes you see both turn and river. If villain bets the turn again, the one-card odds are worse — but hitting a disguised draw can win extra (implied odds).');
    if (strong && street !== 'river' && best === 'fold') why.push('A raise (semi-bluff) is acceptable: fold equity plus your draw can make it profitable, which this calculation does not model.');
    if (street === 'river') why.push('On the river there are no cards to come: this is pure bluff-catching math vs the stated value/bluff mix.');
    const spot: Spot = {
      id: `math-${street}-${cardsToString([...hero, ...board]).replace(/ /g, '')}-${bet}`,
      origin: 'math',
      mode: 'B',
      street,
      tableSize: s.tableSize,
      heroPos: ctx.heroPos,
      villainPos: ctx.villainPos,
      hero,
      board,
      pot: potWithBet,
      toCall: bet,
      effStack: r1(s.stackDepth - invested),
      history: lines.join(' '),
      villain,
      options,
      grades,
      best,
      gradeBasis: 'equity',
      why,
      concepts: ['pot-odds', 'equity', ...(strong ? ['outs', 'implied-odds'] : []), ...(street === 'river' ? ['bluff-catch'] : [])],
      assumptions: [
        `Villain range: ${villain.label}.`,
        'Grade = equity vs required equity (±3 points counts as close). No further betting is assumed.',
        `Effective stack ${r1(s.stackDepth - invested)}bb. Single-raised pot, heads-up.`,
      ],
      sources: [ctx.villainChartSource, 'wiki-potodds', 'engine'],
      exploit:
        street === 'river'
          ? 'Practical note: many low-stakes players bluff the river far less than this assumed mix. Against them, fold more of your bluff-catchers; against known maniacs, call more.'
          : frac >= 0.75
            ? 'Practical note: at low stakes, big bets from passive players are weighted heavily toward value. Fold marginal hands more often against them; keep calling against known bluffers.'
            : 'Practical note: small bets from loose players are often weak or thin. Continue widely, and look for spots to raise your strong draws and made hands.',
      tags: [street, 'facing-bet', fracLabel.replace(' ', '-'), ctx.ip ? 'ip' : 'oop', wanted, handFamily(hero)],
      precomputedEquity: eq,
    };
    if (Math.abs(margin) >= minMargin) return spot;
    fallback = spot;
  }
  return fallback!;
}

export function newRng(seed?: number): Rng {
  return mulberry32(seed ?? (Math.random() * 2 ** 32) >>> 0);
}

export const _internal = { boundaryClasses, ALL_CLASSES };
