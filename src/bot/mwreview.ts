// Grades the human's decisions in a multiway hand by the math available at the time (never by the result):
//  - Preflop: the cited charts where one covers the spot (first in; facing a single open with no callers);
//    all-in calls by equity vs the combined estimated ranges; otherwise "close / depends".
//  - Postflop facing a bet: equity vs ALL remaining opponents' estimated ranges vs the price (call ÷ final pot);
//    within 3 points → close; with players still to act behind and an edge under 6 points → close.
//  - Postflop with no bet: heads-up → the value rule; multiway → bet is best only above the multiway value
//    threshold (fair share × (1.5 + 0.15 per extra opponent)); clearly weak hands → check (bluffing 3+ ways is a
//    mistake, 2 opponents acceptable); everything else close.
// Hindsight equity vs every remaining opponent's actual cards is computed separately.
import { classOfCards } from '../engine/range';
import { requiredEquity } from '../engine/odds';
import { features, describeFeatures } from '../engine/handclass';
import { CHARTS, chartAction, findChart, type Position } from '../data/charts';
import { multiEquityHands } from '../engine/multiequity';
import { mwTotalPot, mwToCall, actingOrder, type MWState, type MWActionType } from '../engine/multiway';
import { estimateRange, POSTFLOP_MULT, totalWeight } from './ranges';
import { strength, gradeCheckedTo } from '../scenarios/fullhand';
import { isStrongDraw } from '../scenarios/compute';
import { valueThreshold, fairShare, type MultiEqFn } from './mwbot';
import type { HeroReview, Verdict } from './review';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function reviewMWDecision(before: MWState, hero: number, type: MWActionType, to: number | undefined, index: number, eqFn: MultiEqFn): Promise<HeroReview & { players: number; hindsightAll?: number }> {
  const myPos = before.cfg.positions[hero];
  const cards = before.holes[hero];
  const board = before.board;
  const cls = classOfCards(cards[0], cards[1]);
  const n = before.n;
  const cfg = { tableSize: n === 2 ? 2 : 6, positions: before.cfg.positions };
  const opps = before.cfg.positions.map((_, i) => i).filter((i) => i !== hero && !before.folded[i]);
  const k = opps.length;
  const toCall = mwToCall(before, hero);
  const pot = mwTotalPot(before);
  const label = type === 'raise' || type === 'bet' ? `${type} to ${to}` : type === 'call' ? `call ${Math.min(toCall, before.stack[hero] / 100)}` : type;
  const hind = multiEquityHands([cards, ...opps.map((o) => before.holes[o])], board, { iterations: 30_000, seed: 9 + index });
  const base = { index, street: before.street, action: label, hindsight: hind.equity[0], players: k + 1 };
  const order = actingOrder(before.cfg, before.street);
  const behind = order.slice(order.indexOf(hero) + 1).filter((s) => !before.folded[s] && before.stack[s] > 0 && before.needAct[s]).length;
  const multiwayNote = k > 1 ? [`${k + 1}-way pot: value bets need a stronger hand, bluffs work far less often (every player must fold).`] : [];

  if (before.street === 0) {
    const pre = before.history.filter((a) => a.street === 0);
    const raises = pre.filter((a) => a.type === 'raise');
    const limpers = pre.filter((a) => a.type === 'call').length;
    const allInFaced = before.history.some((a) => a.allIn && a.seat !== hero);
    const callAllIn = type === 'call' && toCall * 100 >= before.stack[hero];
    if (raises.length === 0 && limpers === 0 && !(myPos === 'BB' && toCall === 0)) {
      const chart = findChart('rfi', 6, (n === 2 ? 'BTN' : myPos) as Position);
      if (chart) {
        const inR = chartAction(chart, cls) !== 'fold';
        const mixed = !!chart.mixedActions && inR;
        const v: Verdict = !inR ? (type === 'fold' ? 'best' : 'mistake') : type === 'raise' ? (mixed ? 'ok' : 'best') : type === 'call' ? (mixed ? 'ok' : 'mistake') : 'mistake';
        return { ...base, verdict: v, basis: 'chart', chartTitle: chart.title, bullets: [inR ? `${cls} is in the ${chart.title} range${mixed ? ' ("raise or call")' : ' — open-raise'}.` : `${cls} is outside the ${chart.title} range — fold.`, n === 2 ? 'Heads-up game: the 6-max button chart is used as an approximation.' : `With ${n} players, the 6-max chart for your seat applies (players before you are absent).`], rangeLabel: '—', concepts: ['preflop-ranges', 'position'] };
      }
    }
    if (raises.length === 1 && !allInFaced && !callAllIn) {
      const lastIdx = pre.lastIndexOf(raises[0]);
      const callers = pre.slice(lastIdx + 1).filter((a) => a.type === 'call').length;
      const opener = before.cfg.positions[raises[0].seat];
      const ch = CHARTS.find((c) => c.kind === 'vsOpen' && c.hero === myPos && c.villain === opener);
      if (ch && callers === 0) {
        const a = chartAction(ch, cls);
        const want = a === 'fold' ? 'fold' : a === 'call' ? 'call' : 'raise';
        const mixed = !!ch.mixedActions && a !== 'fold';
        const v: Verdict = type === want ? 'best' : mixed && (type === 'call' || type === 'raise') ? 'ok' : 'mistake';
        return { ...base, verdict: v, basis: 'chart', chartTitle: ch.title, bullets: [`${ch.title}: ${cls} is ${a === 'fold' ? 'a fold' : mixed ? 'a defend' : `a ${a === 'threebet' ? '3-bet' : 'call'}`}.`], rangeLabel: `${opener} opening range`, concepts: ['preflop-ranges'] };
      }
    }
    if (!(allInFaced || callAllIn) || type === 'raise') {
      return { ...base, verdict: 'close', basis: 'none', bullets: ['No verified chart covers this preflop spot (callers, limpers, 3-bets or a seat pairing without a chart) — not graded.', 'Close / depends on reads.', ...multiwayNote], rangeLabel: '—', concepts: ['preflop-ranges', ...(k > 1 ? ['multiway'] : [])] };
    }
  }

  const ranges = opps.map((o) => estimateRange(cfg, o, before.history, board, cards));
  const rangeLabel = opps.map((o, i) => `${before.cfg.positions[o]} ~${Math.round(totalWeight(ranges[i]))} combos`).join(', ') + ' (each estimated from position and actions — public information only)';
  const rangeArgs = ranges.map((r) => r.map((c) => ({ cards: c.cards, weight: c.w })));
  const f = board.length >= 3 ? features(cards, board) : null;
  const handTxt = f ? describeFeatures(f).toLowerCase() : cls;
  const strongDraw = !!f && isStrongDraw(f, board);
  const concepts = [...(k > 1 ? ['multiway'] : [])];

  if (toCall > 0) {
    const e = await eqFn(cards, rangeArgs, board, 700 + index);
    const callAmt = Math.min(toCall, before.stack[hero] / 100);
    const req = requiredEquity(callAmt, pot + callAmt);
    const margin = e.equity - req;
    let v: Verdict;
    if (Math.abs(margin) < 0.03 || (behind > 0 && margin > 0 && margin < 0.06)) v = 'close';
    else if (margin > 0) v = type === 'fold' ? 'mistake' : type === 'call' ? 'best' : e.equity >= valueThreshold(k) ? 'best' : strongDraw && before.street < 3 && k === 1 ? 'ok' : 'mistake';
    else v = type === 'fold' ? 'best' : type === 'raise' && strongDraw && before.street < 3 && k === 1 ? 'ok' : 'mistake';
    const bullets = [
      `You call ${callAmt} into a pot of ${pot}: you need ${pct(req)} (amount to call ÷ final pot).`,
      `Your ${handTxt} has ≈${pct(e.equity)} against the combined ranges of ${k} opponent${k > 1 ? 's' : ''}.`,
      v === 'close' ? (behind > 0 && margin > 0 ? `Only a small edge with ${behind} player${behind > 1 ? 's' : ''} still to act behind (they can raise): close / depends on reads.` : 'Within 3 points of the price: close / depends on reads.') : margin > 0 ? 'Enough equity to continue at this price.' : 'Not enough equity for this price.',
      ...multiwayNote,
    ];
    return { ...base, verdict: v, basis: 'equity', bullets, equity: e.equity, equityApprox: true, required: req, rangeLabel, rangeCombos: Math.round(ranges.reduce((a, r) => a + totalWeight(r), 0)), concepts: ['pot-odds', 'equity', ...concepts, ...(strongDraw ? ['outs'] : []), ...(behind > 0 ? ['position'] : [])] };
  }

  if (before.street === 0) return { ...base, verdict: 'close', basis: 'none', bullets: ['Preflop option without a verified chart: not graded.'], rangeLabel: '—', concepts: ['preflop-ranges'] };
  const eAll = await eqFn(cards, rangeArgs, board, 800 + index);
  if (k === 1) {
    const callR = ranges[0].map((c) => ({ cards: c.cards, weight: c.w * POSTFLOP_MULT.call[strength(c.cards, board)] })).filter((c) => c.weight > 0);
    const eCall = await eqFn(cards, [callR], board, 801 + index);
    const st = (['flop', 'turn', 'river'] as const)[before.street - 1];
    const g = gradeCheckedTo(eAll.equity, eCall.equity, { options: [{ key: 'check', kind: 'check', label: '' }, { key: 'bet-50', kind: 'bet', amount: 1, label: '' }], strongDraw, street: st });
    let v: Verdict = g.grades[type === 'check' ? 'check' : 'bet-50'] ?? 'mistake';
    if (Math.abs(eCall.equity - 0.5) < 0.05) v = 'close';
    return { ...base, verdict: v, basis: 'value-rule', bullets: [`Against ${rangeLabel}, your ${handTxt} has ≈${pct(eAll.equity)}.`, `If you bet, the hands likely to call leave you ≈${pct(eCall.equity)} (${eCall.equity >= 0.5 ? 'ahead → value bet' : 'behind → mostly a bluff'}).`], equity: eAll.equity, equityApprox: true, rangeLabel, concepts: ['value-bet', 'equity'] };
  }
  const vt = valueThreshold(k);
  const fs = fairShare(k);
  let v: Verdict;
  const bet = type === 'bet' || type === 'raise';
  if (eAll.equity >= vt) v = bet ? 'best' : 'ok';
  else if (eAll.equity < fs * 0.7 && !strongDraw) v = bet ? (k === 2 ? 'ok' : 'mistake') : 'best';
  else v = 'close';
  return {
    ...base,
    verdict: v,
    basis: 'value-rule',
    bullets: [
      `Against the combined ranges of ${k} opponents your ${handTxt} has ≈${pct(eAll.equity)} (fair share ${pct(fs)}).`,
      eAll.equity >= vt ? `Above the multiway value threshold (${pct(vt)}): bet for value.` : eAll.equity < fs * 0.7 ? `Well below your fair share: check — ${k >= 3 ? 'a bluff into 3+ players rarely gets through' : 'a bluff needs both players to fold'}.` : `Between your fair share and the value threshold (${pct(vt)}): close / depends on reads.`,
      ...multiwayNote,
    ],
    equity: eAll.equity,
    equityApprox: true,
    rangeLabel,
    concepts: ['value-bet', 'multiway'],
  };
}
