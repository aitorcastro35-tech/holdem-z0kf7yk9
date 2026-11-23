// Concept cards / glossary. Definitions are written in our own words; formulas are the standard ones
// (and implemented + tested in src/engine/odds.ts). Each card cites where the concept is explained.
export interface Concept {
  id: string;
  title: string;
  kind: 'math' | 'theory';
  summary: string;
  formula?: string;
  example?: string;
  pitfalls?: string;
  refs: string[];
}

export const CONCEPTS: Concept[] = [
  {
    id: 'pot-odds',
    title: 'Pot odds',
    kind: 'math',
    summary: 'The price the pot offers you: what you must call compared with what you can win. Convert it to the equity you need to break even on a call.',
    formula: 'Required equity = call ÷ (pot after you call). Facing bet B into pot P: B ÷ (P + 2B).',
    example: 'Pot 100, villain bets 50. You call 50 to win a final pot of 200 → need 50/200 = 25%.',
    pitfalls: 'Use the pot after your call (it includes your own chips). Pot odds ignore future bets — that is implied odds.',
    refs: ['wiki-potodds', 'sklansky'],
  },
  {
    id: 'equity',
    title: 'Equity',
    kind: 'math',
    summary: 'Your share of the pot if all remaining cards were dealt with no more betting: win% + ½·tie%. Always measured against a hand or, more usefully, a range.',
    example: 'A♥K♥ vs Q♠Q♦ on Q♥ 7♥ 2♣ 9♠: 7 of 44 rivers win → 15.9% equity (exact; hearts that pair the board give the set a full house).',
    pitfalls: 'Raw equity ≠ realized equity. Out of position or with weak hands you often realize less than your raw share.',
    refs: ['gtow-equity'],
  },
  {
    id: 'outs',
    title: 'Outs & the Rule of 2 and 4',
    kind: 'math',
    summary: 'Outs are unseen cards that improve you to a likely winner. With 47 unseen cards on the flop and 46 on the turn, the hit probability is exact combinatorics.',
    formula: 'Next card: outs ÷ unseen. Flop→river: 1 − C(47−outs,2)/C(47,2). Rule of thumb: ×2 per card, ×4 with two to come (subtract outs−8 above 8 outs).',
    example: '9 outs: 19.1% on the turn, 34.97% by the river; rule of 4 says 36%.',
    pitfalls: 'Dirty outs (that pair the board or make someone a better hand) are worth less than they look. The ×4 rule assumes you see both cards — usually only true when all-in.',
    refs: ['woo', 'engine'],
  },
  {
    id: 'implied-odds',
    title: 'Implied odds',
    kind: 'theory',
    summary: 'Extra money you expect to win on later streets when you hit. They can justify a call that pot odds alone reject — mostly with disguised draws and deep stacks.',
    pitfalls: 'Implied odds shrink when your draw is obvious, when stacks are short (low SPR), or when hitting can still lose (reverse implied odds, e.g. non-nut flushes).',
    refs: ['wiki-potodds', 'sklansky'],
  },
  {
    id: 'ev',
    title: 'Expected value (EV)',
    kind: 'math',
    summary: 'The average result of a decision if repeated many times. For a call with no further betting: EV = equity × final pot − cost of the call (folding = 0).',
    formula: 'EV(call) = equity × (pot + 2B) − B',
    example: 'Pot 100, bet 50, equity 30%: EV = 0.30 × 200 − 50 = +10.',
    refs: ['sklansky', 'wiki-ftp'],
  },
  {
    id: 'mdf',
    title: 'Minimum defense frequency (MDF)',
    kind: 'theory',
    summary: 'How much of your range you must continue with so that an opponent\'s zero-equity bluffs do not profit automatically.',
    formula: 'MDF = P ÷ (P + B). Half-pot → 66.7%; pot → 50%.',
    pitfalls: 'MDF is a toy-game benchmark, not a rule. Against players who rarely bluff (common at low stakes) you should fold more than MDF. It applies to initial bets, not raises.',
    refs: ['gtow-mdf'],
  },
  {
    id: 'alpha',
    title: 'Bluff break-even (alpha)',
    kind: 'math',
    summary: 'How often a pure bluff must work to break even.',
    formula: 'Alpha = B ÷ (P + B). Half-pot → 33.3%; pot → 50%.',
    refs: ['gtow-mdf'],
  },
  {
    id: 'fold-equity',
    title: 'Fold equity',
    kind: 'theory',
    summary: 'The value you gain when your bet or raise makes better hands fold. Semi-bluffs combine fold equity with the equity of your draw.',
    formula: 'EV(bet) ≈ fold% × pot + (1 − fold%) × (EV when called)',
    refs: ['wiki-semibluff', 'sklansky'],
  },
  {
    id: 'range-advantage',
    title: 'Range advantage & nut advantage',
    kind: 'theory',
    summary: 'Range advantage: your whole range has more equity on this board. Nut advantage: you hold more of the very strongest hands. Range advantage favours betting often; nut advantage favours betting big.',
    example: 'A preflop raiser on A-K-7 rainbow has both; the big-blind caller on 7-6-5 often has the nut advantage.',
    refs: ['gtow-morph', 'gtow-cbet'],
  },
  {
    id: 'blockers',
    title: 'Blockers',
    kind: 'math',
    summary: 'Cards you hold (or see on the board) remove combinations from the opponent\'s range. Combo counting quantifies it.',
    example: 'Holding an ace leaves 3 AA combos (not 6) and 12 AK combos (not 16).',
    pitfalls: 'Blockers matter most when ranges are narrow or polarized (big river bets); with wide ranges the effect is small.',
    refs: ['gtow-blockers', 'engine'],
  },
  {
    id: 'combos',
    title: 'Combinations',
    kind: 'math',
    summary: '1,326 starting combos in 169 classes: each pair has 6 combos, each suited hand 4, each offsuit hand 12.',
    formula: 'Pair with k of that rank visible: C(4−k, 2). Unpaired with a visible: (4−a)(4−b) total, of which suited = matching suits left.',
    refs: ['wiki-start', 'engine'],
  },
  {
    id: 'spr',
    title: 'Stack-to-pot ratio (SPR)',
    kind: 'theory',
    summary: 'Effective stack ÷ pot on the flop. Low SPR (≤ 3) makes one-pair hands easy to get all-in with; high SPR rewards nutted hands and draws with implied odds.',
    formula: 'SPR = effective stack ÷ pot',
    refs: ['wiki-glossary'],
  },
  {
    id: 'position',
    title: 'Position',
    kind: 'theory',
    summary: 'Acting last on later streets means more information and better equity realization. That is why opening ranges widen from UTG to the button.',
    refs: ['sklansky', 'pokercoaching'],
  },
  {
    id: 'cbet',
    title: 'Continuation bet (c-bet)',
    kind: 'theory',
    summary: 'A bet on the flop by the preflop aggressor. Small and frequent on boards that favour your range (dry, high-card boards); less often and bigger on boards that hit the caller.',
    refs: ['gtow-cbet', 'wiki-glossary'],
  },
  {
    id: 'check-raise',
    title: 'Check-raise',
    kind: 'theory',
    summary: 'Checking and then raising a bet. A strong, often polarized line: very good hands plus semi-bluffs. At low stakes it is weighted heavily toward value.',
    refs: ['wiki-glossary'],
  },
  {
    id: 'polarized',
    title: 'Polarized vs linear ranges',
    kind: 'theory',
    summary: 'Polarized = very strong hands + bluffs, nothing in between (suits large bets). Linear (merged) = the best hands top-down (suits smaller bets and thin value).',
    refs: ['gtow-morph'],
  },
  {
    id: 'value-bet',
    title: 'Value bet & thin value',
    kind: 'theory',
    summary: 'Betting to get called by worse. A thin value bet is one where you are only slightly ahead of the calling range — profitable against players who call too often.',
    refs: ['sklansky'],
  },
  {
    id: 'bluff-catch',
    title: 'Bluff-catching',
    kind: 'theory',
    summary: 'Calling with a hand that only beats bluffs. Correct when the opponent bluffs at least as often as your pot odds require.',
    formula: 'Call if P(villain is bluffing) ≥ required equity = B ÷ (P + 2B)',
    refs: ['gtow-mdf', 'wiki-potodds'],
  },
  {
    id: 'preflop-ranges',
    title: 'Preflop ranges',
    kind: 'theory',
    summary: 'Which hands to open, call or 3-bet by position. The app uses published charts and shows their assumptions; they are baselines, not laws.',
    refs: ['pokercoaching', 'pokerskillPreflop'],
  },
  {
    id: 'set-mining',
    title: 'Set mining',
    kind: 'math',
    summary: 'Calling with a small pair mainly to flop a set (≈ 11.8%, about 7.5-to-1 against). Needs implied odds: the stacks behind must be large relative to the call.',
    refs: ['engine'],
  },
  {
    id: 'reverse-implied',
    title: 'Reverse implied odds & domination',
    kind: 'theory',
    summary: 'When you hit but still lose (dominated kicker, low flush, idiot-end straight), you lose extra money later. Common with offsuit broadways out of position.',
    refs: ['sklansky'],
  },
  {
    id: 'multiway',
    title: 'Multiway pots',
    kind: 'theory',
    summary:
      'With more players in the pot you need a stronger hand to bet for value and should bluff far less: a bluff has to get through everyone, because folding frequencies multiply. The burden of defending is shared, and players still to act behind make a call worth less than closing the action.',
    formula: 'P(everyone folds) = fold%₁ × fold%₂ × … ; a call is worth less with players behind (they can raise).',
    example: 'If each of two opponents folds 60% of the time, both fold only 0.6 × 0.6 = 36%.',
    pitfalls: 'Hands like top pair weak kicker lose value fast multiway (reverse implied odds: when you are called, you are often dominated).',
    refs: ['gtow-multiway'],
  },
  {
    id: 'side-pots',
    title: 'Side pots & split pots',
    kind: 'math',
    summary:
      'When a player is all-in for less, the main pot holds what everyone matched up to that amount; extra chips go into side pots that only players who put them in can win. Each pot goes to the best hand among the players eligible for it. A tie splits the pot; the odd chip goes to the first seat left of the button.',
    example: 'All-ins of 10, 30 and 60 with a caller: main pot 4 × 10 = 40, side pot 3 × 20 = 60, side pot 2 × 30 = 60.',
    refs: ['tda'],
  },
];

export const conceptById = (id: string) => CONCEPTS.find((c) => c.id === id);
