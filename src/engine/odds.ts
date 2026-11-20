// Pot odds, required equity, MDF, bluff break-even, EV, and outs → probability helpers.
// Formulas: Sklansky, The Theory of Poker (pot odds); MDF/alpha as defined in Brokos, Play Optimal Poker
// and Acevedo, Modern Poker Theory. See SOURCES.md.
import { choose } from './cards';

/**
 * Required equity to call when facing a bet `bet` into a pot `pot` (pot measured BEFORE the bet).
 * = bet / (pot + 2·bet)
 */
export function requiredEquityFacingBet(pot: number, bet: number): number {
  return bet / (pot + 2 * bet);
}

/**
 * General form: you must put in `toCall` and the final pot (including your call) is `potAfterCall`.
 * Required equity = toCall / potAfterCall.
 */
export function requiredEquity(toCall: number, potAfterCall: number): number {
  return toCall / potAfterCall;
}

/** Minimum defense frequency vs a bet `bet` into pot `pot` (before the bet): pot / (pot + bet). */
export function mdf(pot: number, bet: number): number {
  return pot / (pot + bet);
}

/** How often a pure bluff of `bet` into `pot` must work to break even (alpha): bet / (pot + bet). */
export function bluffBreakEven(pot: number, bet: number): number {
  return bet / (pot + bet);
}

/** Pot odds as "X : 1" — money in the pot (incl. villain bet) vs what you must call. */
export function potOddsRatio(potIncludingBet: number, toCall: number): number {
  return potIncludingBet / toCall;
}

/**
 * EV of calling relative to folding (fold = 0), assuming no further betting:
 * EV(call) = equity · finalPot − toCall, where finalPot includes your call.
 */
export function evCall(equity: number, potAfterCall: number, toCall: number): number {
  return equity * potAfterCall - toCall;
}

/** EV of a pure bluff (assumes zero equity when called): fold% · pot − (1 − fold%) · bet. */
export function evBluff(foldFreq: number, pot: number, bet: number): number {
  return foldFreq * pot - (1 - foldFreq) * bet;
}

/** Probability that at least one of `outs` cards arrives in the next `draws` cards from `unseen` cards. */
export function hitProbability(outs: number, unseen: number, draws: number): number {
  if (outs <= 0) return 0;
  return 1 - choose(unseen - outs, draws) / choose(unseen, draws);
}

/** On the flop (47 unseen): next card only. */
export const flopToTurn = (outs: number) => hitProbability(outs, 47, 1);
/** On the flop: by the river (two cards to come, all-in / seeing both cards). */
export const flopToRiver = (outs: number) => hitProbability(outs, 47, 2);
/** On the turn (46 unseen): river card. */
export const turnToRiver = (outs: number) => hitProbability(outs, 46, 1);

/** Rule of 2 and 4 approximations (percent). */
export const ruleOf2 = (outs: number) => outs * 2;
export const ruleOf4 = (outs: number) => outs * 4;
/**
 * Commonly taught correction for many outs: 4·outs − (outs − 8) when outs > 8.
 * The app shows this next to the exact value so the error is visible; tests check it stays close.
 */
export const ruleOf4Corrected = (outs: number) => (outs > 8 ? outs * 4 - (outs - 8) : outs * 4);

/** "X : 1" odds against from a probability. */
export const oddsAgainst = (p: number) => (1 - p) / p;

/** Bet size as fraction of pot → required equity for the caller. */
export const requiredEquityForPotFraction = (f: number) => requiredEquityFacingBet(1, f);
