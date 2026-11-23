// Flashcard deck. Every numeric answer is computed by the engine at build time of the deck — nothing typed in.
import { flopToRiver, flopToTurn, turnToRiver, requiredEquityForPotFraction, mdf, bluffBreakEven, ruleOf4 } from '../../engine/odds';
import { facts } from '../../engine/probabilities';
import { parseRange, rangeComboCount } from '../../engine/range';
import { parseCards, mulberry32, shuffle } from '../../engine/cards';
import { gridLabel } from '../../engine/range';
import { CHARTS, SOURCES, chartAction, type Action } from '../../data/charts';

export type Topic = 'outs' | 'price' | 'combos' | 'preflop' | 'concepts' | 'charts';
export const TOPIC_LABEL: Record<Topic, string> = {
  outs: 'Outs → %',
  price: 'Pot odds & MDF',
  combos: 'Combos',
  preflop: 'Preflop & flop odds',
  concepts: 'Number → concept',
  charts: 'Preflop chart quiz',
};

export type Answer =
  | { type: 'percent'; value: number; tol: number } // value in percent (e.g. 34.97)
  | { type: 'number'; value: number }
  | { type: 'choice'; options: string[]; correct: number };

export interface Flashcard {
  id: string;
  topic: Topic;
  prompt: string;
  answer: Answer;
  explain: string;
  concept: string;
}

const P = (x: number) => x * 100;
const f2 = (x: number) => x.toFixed(2);

const DRAW_NAMES: Record<number, string> = {
  3: 'one overcard you hope to pair',
  7: 'a flopped set hoping to fill up — 6 cards pair the board, 1 makes quads',
  10: 'a 10-out draw',
  11: 'an 11-out draw',
  14: 'a 14-out combo draw',
  2: 'a pocket pair hoping to hit a set',
  4: 'a gutshot straight draw',
  5: 'one pair hoping for two pair or trips',
  6: 'two overcards',
  8: 'an open-ended straight draw',
  9: 'a flush draw',
  12: 'a flush draw plus a gutshot',
  15: 'a flush draw plus an open-ended straight draw',
};

const SIZES: [number, string][] = [
  [0.25, 'quarter-pot'],
  [1 / 3, 'one-third pot'],
  [0.5, 'half-pot'],
  [2 / 3, 'two-thirds pot'],
  [0.75, 'three-quarter pot'],
  [1, 'pot-size'],
  [2, '2× pot overbet'],
];

export function buildDeck(): Flashcard[] {
  const cards: Flashcard[] = [];
  // ---- outs → % ----
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15]) {
    const name = DRAW_NAMES[n];
    cards.push({
      id: `outs-fr-${n}`,
      topic: 'outs',
      prompt: `Flop: you have ${n} outs (${name}). Chance to hit by the river if you see both cards?`,
      answer: { type: 'percent', value: P(flopToRiver(n)), tol: 1.5 },
      explain: `1 − C(${47 - n},2)/C(47,2) = ${f2(P(flopToRiver(n)))}%. Rule of 4: ${ruleOf4(n)}%.`,
      concept: 'outs',
    });
    cards.push({
      id: `outs-ft-${n}`,
      topic: 'outs',
      prompt: `Flop: ${n} outs (${name}). Chance to hit on the turn only?`,
      answer: { type: 'percent', value: P(flopToTurn(n)), tol: 1 },
      explain: `${n}/47 = ${f2(P(flopToTurn(n)))}%. Rule of 2: ${n * 2}%.`,
      concept: 'outs',
    });
    cards.push({
      id: `outs-tr-${n}`,
      topic: 'outs',
      prompt: `Turn: ${n} outs (${name}). Chance to hit on the river?`,
      answer: { type: 'percent', value: P(turnToRiver(n)), tol: 1 },
      explain: `${n}/46 = ${f2(P(turnToRiver(n)))}%. Rule of 2: ${n * 2}%.`,
      concept: 'outs',
    });
  }
  cards.push({
    id: 'outs-r4-15',
    topic: 'outs',
    prompt: 'The Rule of 4 says 15 outs on the flop ≈ 60%. What is the exact chance by the river?',
    answer: { type: 'percent', value: P(flopToRiver(15)), tol: 1.5 },
    explain: `Exact ${f2(P(flopToRiver(15)))}%. The rule overstates big draws; corrected rule 4×15 − (15 − 8) = 53%.`,
    concept: 'outs',
  });

  // ---- price ----
  for (const [f, name] of SIZES) {
    const key = f.toFixed(3);
    cards.push({
      id: `price-req-${key}`,
      topic: 'price',
      prompt: `Villain bets ${name}. What equity do you need to call (no future betting)?`,
      answer: { type: 'percent', value: P(requiredEquityForPotFraction(f)), tol: 1 },
      explain: `B / (P + 2B) with P = 1, B = ${+f.toFixed(3)} → ${f2(P(requiredEquityForPotFraction(f)))}%.`,
      concept: 'pot-odds',
    });
    cards.push({
      id: `price-mdf-${key}`,
      topic: 'price',
      prompt: `Facing a ${name} bet, what is the minimum defense frequency (MDF)?`,
      answer: { type: 'percent', value: P(mdf(1, f)), tol: 1 },
      explain: `P / (P + B) = ${f2(P(mdf(1, f)))}%. A benchmark, not a rule: fold more vs players who rarely bluff.`,
      concept: 'mdf',
    });
    cards.push({
      id: `price-alpha-${key}`,
      topic: 'price',
      prompt: `You bluff ${name}. How often must villain fold for a pure bluff to break even?`,
      answer: { type: 'percent', value: P(bluffBreakEven(1, f)), tol: 1 },
      explain: `B / (P + B) = ${f2(P(bluffBreakEven(1, f)))}%.`,
      concept: 'alpha',
    });
  }

  // ---- combos ----
  const combo = (id: string, prompt: string, range: string, dead: string, explain: string) =>
    cards.push({
      id: `combo-${id}`,
      topic: 'combos',
      prompt,
      answer: { type: 'number', value: rangeComboCount(parseRange(range), dead ? parseCards(dead) : []) },
      explain,
      concept: 'combos',
    });
  combo('pair', 'How many combos of a specific pocket pair (e.g. QQ)?', 'QQ', '', 'C(4,2) = 6.');
  combo('suited', 'How many combos of a specific suited hand (e.g. AKs)?', 'AKs', '', 'One per suit: 4.');
  combo('offsuit', 'How many combos of a specific offsuit hand (e.g. AKo)?', 'AKo', '', '4 × 4 − 4 suited = 12.');
  combo('ak', 'How many total AK combos (suited + offsuit)?', 'AK', '', '4 × 4 = 16.');
  combo('total', 'How many possible two-card starting hands are there?', 'random', '', 'C(52,2) = 1,326.');
  combo('aa-1a', 'An ace is on the board. How many AA combos remain?', 'AA', 'As 9d 4c', 'C(3,2) = 3.');
  combo('ak-1a', 'An ace is on the board. How many AK combos remain?', 'AK', 'As 9d 4c', '3 aces × 4 kings = 12.');
  combo('aks-ah', 'The A♥ is on the board. How many AKs combos remain?', 'AKs', 'Ah 9d 4c', 'Hearts AKs is blocked: 3 left.');
  combo('set-77', 'Board 7♠ 9♦ 2♣. How many combos of a set of sevens (77) can villain have?', '77', '7s 9d 2c', 'Three sevens left: C(3,2) = 3.');
  combo('kq-blk', 'You hold K♥ Q♥. How many KQ combos can villain have?', 'KQ', 'Kh Qh', '3 kings × 3 queens = 9.');
  combo('jj-board', 'Board J♠ J♦ 5♣. How many JJ combos are left?', 'JJ', 'Js Jd 5c', 'Two jacks left: 1 combo.');
  combo('kk-1k', 'A king is on the board. How many KK combos remain?', 'KK', 'Kd 8c 3s', 'C(3,2) = 3.');
  combo('jts-j', 'The J♠ is on the board. How many JTs combos remain?', 'JTs', 'Js 6d 2c', 'Spades JTs is blocked: 3 left.');
  combo('sets-k72', 'Board K♠ 7♦ 2♣. How many set combos (KK, 77, 22) are possible in total?', 'KK, 77, 22', 'Ks 7d 2c', '3 ranks × C(3,2) = 3 × 3 = 9.');
  combo('aq-hold-a', 'You hold A♣ T♦. How many AQ combos can villain have?', 'AQ', 'Ac Td', '3 aces × 4 queens = 12.');
  combo('two-pair-k7', 'Board K♠ 7♦ 2♣. How many K7 combos (top two pair) are possible?', 'K7', 'Ks 7d 2c', '3 kings × 3 sevens = 9.');
  combo('pairs-all', 'How many combos of all 13 pocket pairs together?', '22+', '', '13 × 6 = 78.');
  combo('suited-aces', 'How many combos of suited aces (A2s–AKs)?', 'A2s+', '', '12 hands × 4 = 48.');
  cards.push({
    id: 'combo-classes',
    topic: 'combos',
    prompt: 'How many strategically distinct starting hands (pairs + suited + offsuit classes)?',
    answer: { type: 'number', value: 13 + 78 + 78 },
    explain: '13 pairs + 78 suited + 78 offsuit = 169.',
    concept: 'combos',
  });

  // ---- preflop & flop facts ----
  const fact = (id: string, prompt: string, p: number, tol: number, explain: string, concept = 'combos') =>
    cards.push({ id: `pf-${id}`, topic: 'preflop', prompt, answer: { type: 'percent', value: P(p), tol }, explain, concept });
  const pp = facts.pocketPair();
  fact('pair', 'Chance of being dealt any pocket pair?', pp.p, 0.5, `${pp.hits}/${pp.total} = 1/17 ≈ ${f2(P(pp.p))}%.`);
  const aa = facts.specificPair();
  fact('aa', 'Chance of being dealt AA (or any specific pair)?', aa.p, 0.1, `6/1,326 = 1/221 ≈ ${f2(P(aa.p))}%.`);
  const st = facts.suited();
  fact('suited', 'Chance your two hole cards are suited?', st.p, 1, `${st.hits}/${st.total} = ${f2(P(st.p))}%.`);
  const set = facts.pairFlopsSetOrBetter();
  fact('set', 'With a pocket pair, chance the flop contains at least one card of your rank (a set or quads)?', set.p, 1, `1 − C(48,3)/C(50,3) = ${f2(P(set.p))}% (≈ 7.5 : 1 against).`, 'set-mining');
  const pr = facts.unpairedFlopsPair();
  fact('pair-flop', 'Unpaired hole cards: chance the flop pairs at least one of them?', pr.p, 1.5, `1 − C(44,3)/C(50,3) = ${f2(P(pr.p))}%.`);
  const fd = facts.suitedFlopsFlushDraw();
  fact('fd', 'Suited hole cards: chance to flop a flush draw (exactly two of your suit)?', fd.p, 1, `C(11,2)·39 / 19,600 = ${f2(P(fd.p))}%.`, 'outs');
  const fl = facts.suitedFlopsFlush();
  fact('flush', 'Suited hole cards: chance to flop a made flush?', fl.p, 0.3, `C(11,3) / 19,600 = ${f2(P(fl.p))}%.`, 'outs');

  // ---- number → concept (multiple choice) ----
  const mc = (id: string, prompt: string, options: string[], correct: number, explain: string, concept: string) =>
    cards.push({ id: `mc-${id}`, topic: 'concepts', prompt, answer: { type: 'choice', options, correct }, explain, concept });
  mc('35', `${f2(P(flopToRiver(9)))}% from flop to river is the chance to complete…`, ['A flush draw (9 outs)', 'An open-ended straight draw (8 outs)', 'A gutshot (4 outs)', 'Two overcards (6 outs)'], 0, `9 outs: ${f2(P(flopToRiver(9)))}%. OESD: ${f2(P(flopToRiver(8)))}%. Gutshot: ${f2(P(flopToRiver(4)))}%.`, 'outs');
  mc('16', `${f2(P(flopToRiver(4)))}% from flop to river is…`, ['A gutshot (4 outs)', 'A pocket pair hitting a set (2 outs)', 'An OESD (8 outs)', 'A flush draw (9 outs)'], 0, `4 outs → ${f2(P(flopToRiver(4)))}%.`, 'outs');
  mc('33', 'You need 33.3% equity to call. What bet are you facing?', ['Pot-size bet', 'Half-pot bet', 'Quarter-pot bet', '2× pot overbet'], 0, `Pot bet: 1/(1+2) = 33.3%. Half pot: ${f2(P(requiredEquityForPotFraction(0.5)))}%.`, 'pot-odds');
  mc('25', 'You need 25% equity to call. What bet are you facing?', ['Half-pot bet', 'Pot-size bet', 'Third-pot bet', 'Two-thirds pot'], 0, 'Half pot: 0.5 / (1 + 1) = 25%.', 'pot-odds');
  mc('50mdf', 'MDF = 50%. What bet size is that?', ['Pot-size bet', 'Half-pot bet', '2× pot overbet', 'Quarter-pot bet'], 0, 'P/(P+B) = 1/(1+1) = 50%.', 'mdf');
  mc('221', '1 in 221 is the chance of…', ['Being dealt a specific pocket pair like AA', 'Being dealt any pocket pair', 'Flopping a set with a pocket pair', 'Flopping a flush with suited cards'], 0, `6/1,326 = 1/221. Any pair is 1/17 (${f2(P(pp.p))}%).`, 'combos');
  mc('118', `${f2(P(set.p))}% is the chance of…`, ['A pocket pair flopping a set (or quads)', 'Being dealt a pocket pair', 'Flopping a flush draw with suited cards', 'Hitting a gutshot by the river'], 0, `1 − C(48,3)/C(50,3) = ${f2(P(set.p))}%.`, 'set-mining');
  mc('mdf-def', 'Which formula gives the minimum defense frequency vs a bet B into pot P?', ['P / (P + B)', 'B / (P + 2B)', 'B / (P + B)', '(P + B) / B'], 0, 'B/(P+2B) is the caller\'s required equity; B/(P+B) is bluff break-even (alpha).', 'mdf');
  mc('req-def', 'Which formula gives the equity needed to call a bet B into pot P?', ['B / (P + 2B)', 'P / (P + B)', 'B / (P + B)', 'B / P'], 0, 'You risk B to win P + B; the final pot is P + 2B.', 'pot-odds');
  cards.push(...chartCards());
  return cards;
}

/** Chart quiz: for each cited chart, ask about the hands at the edge of the range (neighbours of a different action). */
function chartCards(): Flashcard[] {
  const out: Flashcard[] = [];
  const ACTION_TXT: Record<Action, string> = { raise: 'Open (raise)', threebet: '3-bet', call: 'Call', limp: 'Limp', fold: 'Fold' };
  for (const chart of CHARTS) {
    const edge: string[] = [];
    for (let r = 0; r < 13; r++)
      for (let c = 0; c < 13; c++) {
        const cls = gridLabel(r, c);
        const a = chartAction(chart, cls);
        const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([x, y]) => x >= 0 && x < 13 && y >= 0 && y < 13);
        if (nb.some(([x, y]) => chartAction(chart, gridLabel(x, y)) !== a)) edge.push(cls);
      }
    // spread the picks across the edge (deterministic)
    const n = Math.min(8, edge.length);
    const picks = Array.from({ length: n }, (_, i) => edge[Math.floor((i * edge.length) / n)]);
    const mixed = chart.mixedActions;
    const options: string[] =
      chart.kind === 'rfi'
        ? mixed
          ? ['Raise or complete', 'Fold']
          : ['Open (raise)', 'Fold']
        : mixed
          ? ['Defend (call or 3-bet)', 'Fold']
          : ['3-bet', 'Call', 'Fold'];
    const table = chart.tableSize === 6 ? '6-max' : 'Full ring';
    for (const cls of picks) {
      const a = chartAction(chart, cls);
      const label = a === 'fold' ? 'Fold' : mixed ? options[0] : ACTION_TXT[a];
      const where = chart.kind === 'rfi' ? `${table}, folded to you in the ${chart.hero}` : `${table}, ${chart.villain} opens and it's folded to you in the ${chart.hero}`;
      out.push({
        id: `chart-${chart.id}-${cls}`,
        topic: 'charts',
        prompt: `${where}. You hold ${cls}. What does the chart do?`,
        answer: { type: 'choice', options, correct: options.indexOf(label) },
        explain: `${chart.title}: ${cls} is ${a === 'fold' ? 'not in the range — fold' : `in the ${mixed ? 'continuing' : ACTION_TXT[a].toLowerCase()} range`}. Source: ${SOURCES[chart.source].name}.`,
        concept: 'preflop-ranges',
      });
    }
  }
  return out;
}

/** Plausible distractors for a percent question (for multiple-choice mode). Deterministic per card. */
export function percentChoices(card: Flashcard): { options: string[]; correct: number } {
  if (card.answer.type !== 'percent') throw new Error('not a percent card');
  const v = card.answer.value;
  const rng = mulberry32([...card.id].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) >>> 0);
  const deltas = shuffle([0.5, 0.65, 0.75, 1.3, 1.45, 1.7, 2], rng);
  const opts = new Set<string>([v.toFixed(1)]);
  for (const d of deltas) {
    if (opts.size >= 4) break;
    const x = Math.min(99.9, v * d);
    const s = x.toFixed(1);
    if (Math.abs(x - v) > Math.max(card.answer.tol * 1.5, 0.15)) opts.add(s);
  }
  const arr = shuffle([...opts], rng);
  return { options: arr.map((s) => s + '%'), correct: arr.indexOf(v.toFixed(1)) };
}

/** Check a typed answer. */
export function checkTyped(card: Flashcard, input: string): boolean {
  const x = parseFloat(input.replace(',', '.').replace('%', ''));
  if (!Number.isFinite(x)) return false;
  if (card.answer.type === 'percent') return Math.abs(x - card.answer.value) <= card.answer.tol;
  if (card.answer.type === 'number') return x === card.answer.value;
  return false;
}

export function answerText(card: Flashcard): string {
  const a = card.answer;
  if (a.type === 'percent') return `${a.value.toFixed(a.value < 1 ? 2 : 1)}%`;
  if (a.type === 'number') return a.value.toLocaleString('en-US');
  return a.options[a.correct];
}
