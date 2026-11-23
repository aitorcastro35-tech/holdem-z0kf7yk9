// Grades the human's decisions in a heads-up hand by the math available AT THE TIME (not by the result).
//  - Preflop: against the cited charts where one exists for the spot; all-in calls by equity vs the bot's
//    estimated range; otherwise "close / depends" (no verified chart).
//  - Postflop facing a bet: equity vs the bot's estimated range (public info only) vs the price, ±3 points = close.
//  - Postflop with no bet: the value rule (bet when you beat more than half of the hands that call).
// Hindsight equity vs the bot's actual cards is computed separately and labelled as such.
import { classOfCards } from '../engine/range';
import { equityVsHand, type EquityResult } from '../engine/equity';
import { requiredEquity } from '../engine/odds';
import { features, describeFeatures } from '../engine/handclass';
import { CHARTS, chartAction, findChart, type Position } from '../data/charts';
import type { Grade } from '../store/progress';
import { totalPot, type HUState, type ActionType } from '../engine/headsup';
import { estimateRange, POSTFLOP_MULT, isInPosition, totalWeight } from './ranges';
import { strength } from '../scenarios/fullhand';
import { gradeCheckedTo } from '../scenarios/fullhand';
import { CLOSE_MARGIN, isStrongDraw } from '../scenarios/compute';
import type { EqFn } from './bot';

export type Verdict = Grade | 'close';

export interface HeroReview {
  index: number; // position in history
  street: number;
  action: string;
  verdict: Verdict;
  basis: 'chart' | 'equity' | 'value-rule' | 'none';
  bullets: string[];
  equity?: number;
  equityApprox?: boolean;
  required?: number;
  rangeLabel: string;
  rangeCombos?: number;
  hindsight?: number; // equity vs the bot's actual cards (you couldn't know this)
  concepts: string[];
  chartTitle?: string;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function reviewDecision(before: HUState, heroSeat: 0 | 1, type: ActionType, to: number | undefined, index: number, eqFn: EqFn): Promise<HeroReview> {
  const botSeat = (1 - heroSeat) as 0 | 1;
  const hero = before.holes[heroSeat];
  const board = before.board;
  const myPos = before.cfg.positions[heroSeat];
  const oppPos = before.cfg.positions[botSeat];
  const cls = classOfCards(hero[0], hero[1]);
  const toCall = Math.max(0, Math.round((before.currentBet - before.committed[heroSeat]) * 100) / 100);
  const pot = totalPot(before);
  const label = type === 'raise' || type === 'bet' ? `${type} to ${to}` : type === 'call' ? `call ${Math.min(toCall, before.stack[heroSeat])}` : type;
  const hindsight = board.length >= 3 ? equityVsHand(hero, before.holes[botSeat], board).equity : undefined;
  const base = { index, street: before.street, action: label, hindsight };

  // ---------------- preflop ----------------
  if (before.street === 0) {
    const raises = before.history.filter((a) => a.street === 0 && a.type === 'raise').length;
    const size = before.cfg.tableSize === 2 ? 6 : before.cfg.tableSize;
    const facingAllIn = before.history.some((a) => a.seat === botSeat && a.allIn);
    const callPutsAllIn = type === 'call' && toCall >= before.stack[heroSeat];
    if (raises === 0 && !(myPos === 'BB' && toCall === 0)) {
      const chart = findChart('rfi', size, (before.cfg.tableSize === 2 ? 'BTN' : myPos) as Position);
      if (chart) {
        const a = chartAction(chart, cls);
        const inR = a !== 'fold';
        const mixed = !!chart.mixedActions && inR;
        let v: Verdict;
        if (!inR) v = type === 'fold' ? 'best' : 'mistake';
        else if (type === 'raise') v = mixed ? 'ok' : 'best';
        else if (type === 'call') v = mixed ? 'ok' : 'mistake';
        else v = 'mistake';
        return {
          ...base,
          verdict: v,
          basis: 'chart',
          chartTitle: chart.title,
          bullets: [
            inR ? `${cls} is inside the ${chart.title} range${mixed ? ' ("raise or call" — either is fine)' : ' — open-raise it'}.` : `${cls} is outside the ${chart.title} range — fold.`,
            before.cfg.tableSize === 2 ? 'Heads-up game: the 6-max button chart is used as an approximation (no verified heads-up chart).' : 'Charts are theory baselines with stated assumptions (~100bb).',
          ],
          rangeLabel: 'n/a (first to act)',
          concepts: ['preflop-ranges', 'position'],
        };
      }
    }
    if (raises === 1 && !facingAllIn && !callPutsAllIn) {
      const ch = CHARTS.find((c) => c.kind === 'vsOpen' && c.hero === myPos && c.villain === oppPos);
      if (ch) {
        const a = chartAction(ch, cls);
        const want = a === 'fold' ? 'fold' : a === 'call' ? 'call' : 'raise';
        const mixed = !!ch.mixedActions && a !== 'fold';
        const v: Verdict = type === want ? 'best' : mixed && (type === 'call' || type === 'raise') ? 'ok' : 'mistake';
        return {
          ...base,
          verdict: v,
          basis: 'chart',
          chartTitle: ch.title,
          bullets: [`${ch.title}: ${cls} is ${a === 'fold' ? 'a fold' : mixed ? 'a defend (call or 3-bet)' : `a ${a === 'threebet' ? '3-bet' : 'call'}`}.`, 'Graded against the cited chart (a simplified teaching range, one action per hand).'],
          rangeLabel: `${oppPos} opening range`,
          concepts: ['preflop-ranges', 'pot-odds'],
        };
      }
    }
    if (!(facingAllIn || callPutsAllIn) || type === 'raise') {
      return {
        ...base,
        verdict: 'close',
        basis: 'none',
        bullets: [`No verified chart covers ${myPos} in this preflop spot (${raises === 0 ? 'big blind option' : raises === 1 ? `vs a ${oppPos} open` : 'facing a 3-bet or more'}), so this decision isn't graded.`, 'Close / depends on reads and stack depth.'],
        rangeLabel: '—',
        concepts: ['preflop-ranges'],
      };
    }
  }

  // ---------------- facing a bet (incl. preflop all-ins) ----------------
  const range = estimateRange(before.cfg, botSeat, before.history, board, hero);
  const combos = range.map((c) => ({ cards: c.cards, weight: c.w }));
  const rangeCombos = Math.round(totalWeight(range));
  const rangeLabel = `the bot's likely range from its position and actions so far (public information only), ~${rangeCombos} combos`;
  const f = board.length >= 3 ? features(hero, board) : null;
  const handTxt = f ? describeFeatures(f).toLowerCase() : cls;
  if (toCall > 0) {
    const eqR: EquityResult = await eqFn(hero, combos, board, 777 + index);
    const callAmt = Math.min(toCall, before.stack[heroSeat]);
    const req = requiredEquity(callAmt, pot + callAmt);
    const margin = eqR.equity - req;
    const strongDraw = !!f && isStrongDraw(f, board);
    let v: Verdict;
    if (Math.abs(margin) < CLOSE_MARGIN) v = 'close';
    else if (margin > 0) v = type === 'fold' ? 'mistake' : type === 'call' ? (eqR.equity >= 0.6 ? 'ok' : 'best') : eqR.equity >= 0.5 ? 'best' : strongDraw && before.street < 3 ? 'ok' : 'mistake';
    else v = type === 'fold' ? 'best' : type === 'raise' && strongDraw && before.street < 3 ? 'ok' : 'mistake';
    const bullets = [
      `You call ${callAmt} to win ${pot}: you need ${pct(req)} equity.`,
      `Your ${handTxt} has ${eqR.exact ? '' : '≈'}${pct(eqR.equity)} against ${rangeLabel}.`,
      v === 'close'
        ? 'Within 3 points of the price: close — depends on reads and future streets.'
        : margin > 0
          ? eqR.equity >= 0.6
            ? 'Well ahead of the price: continuing is right, and raising for value is often best.'
            : 'Enough equity to continue at this price.'
          : 'Not enough equity for this price: folding loses less on average.',
    ];
    if (strongDraw && before.street < 3) bullets.push('Draws also have implied odds when they hit; a semi-bluff raise can be reasonable.');
    return { ...base, verdict: v, basis: 'equity', bullets, equity: eqR.equity, equityApprox: !eqR.exact, required: req, rangeLabel, rangeCombos, concepts: ['pot-odds', 'equity', ...(strongDraw ? ['outs'] : [])] };
  }

  // ---------------- no bet: check or bet (value rule) ----------------
  if (before.street === 0) {
    return { ...base, verdict: 'close', basis: 'none', bullets: ['Preflop option spot without a verified chart: not graded.'], rangeLabel: '—', concepts: ['preflop-ranges'] };
  }
  const st = (['flop', 'turn', 'river'] as const)[before.street - 1];
  const eqAll = await eqFn(hero, combos, board, 555 + index);
  const callCombos = range.map((c) => ({ cards: c.cards, weight: c.w * POSTFLOP_MULT.call[strength(c.cards, board)] })).filter((c) => c.weight > 0);
  const eqCall = await eqFn(hero, callCombos, board, 556 + index);
  const opts = [
    { key: 'check', kind: 'check' as const, label: 'Check' },
    { key: 'bet-50', kind: 'bet' as const, amount: 1, label: 'Bet' },
  ];
  const g = gradeCheckedTo(eqAll.equity, eqCall.equity, { options: opts, strongDraw: !!f && isStrongDraw(f, board), street: st });
  const chosen = type === 'check' ? 'check' : 'bet-50';
  let v: Verdict = g.grades[chosen] ?? 'mistake';
  if (Math.abs(eqCall.equity - 0.5) < 0.05) v = 'close';
  const ip = isInPosition(before.cfg, myPos, oppPos);
  return {
    ...base,
    verdict: v,
    basis: 'value-rule',
    bullets: [
      `Against ${rangeLabel}, your ${handTxt} has ${pct(eqAll.equity)}.`,
      `If you bet, the hands likely to call leave you with ${pct(eqCall.equity)} (${eqCall.equity >= 0.5 ? 'ahead → bet for value' : 'behind → betting mainly works as a bluff'}).`,
      v === 'close' ? 'Close to the 50% line: depends on reads.' : g.best === 'check' ? `Checking is the default here${ip ? ' (in position you also control the pot)' : ''}.` : 'Value bet: worse hands call.',
    ],
    equity: eqAll.equity,
    equityApprox: !eqAll.exact,
    rangeLabel,
    rangeCombos,
    concepts: ['value-bet', 'equity'],
  };
}
