// General references (math, theory). Chart sources live in charts.ts. Mirrored in SOURCES.md.
export interface Ref {
  id: string;
  name: string;
  url: string;
  checked: string;
}

const r = (id: string, name: string, url: string, checked = '2026-11-19'): Ref => ({ id, name, url, checked });

export const REFS: Record<string, Ref> = Object.fromEntries(
  [
    r('wiki-prob', 'Wikipedia — Poker probability (5- and 7-card frequency tables)', 'https://en.wikipedia.org/wiki/Poker_probability'),
    r('wiki-start', "Wikipedia — Texas hold 'em starting hands (1,326 combos, 169 classes, 1/17 pairs)", 'https://en.wikipedia.org/wiki/Texas_hold_%27em_starting_hands'),
    r('wiki-hands', 'Wikipedia — List of poker hands (rankings, kickers, wheel)', 'https://en.wikipedia.org/wiki/List_of_poker_hands'),
    r('woo', "Wizard of Odds — Texas Hold'em (pot-odds table: 34.97% / 31.45% / 16.47%)", 'https://wizardofodds.com/games/texas-hold-em/'),
    r('dc-equity', 'DeucesCracked — Preflop equity matchups, exact enumeration (Oct 2026)', 'https://www.deucescracked.com/blog/preflop-poker-equity-matchups-exact-data'),
    r('wiki-potodds', 'Wikipedia — Pot odds (pot odds, implied odds, required equity)', 'https://en.wikipedia.org/wiki/Pot_odds'),
    r('wiki-ftp', 'Wikipedia — Fundamental theorem of poker (Sklansky)', 'https://en.wikipedia.org/wiki/Fundamental_theorem_of_poker'),
    r('wiki-semibluff', 'Wikipedia — Semi-bluff', 'https://en.wikipedia.org/wiki/Semi-bluff'),
    r('wiki-glossary', 'Wikipedia — Glossary of poker terms (c-bet, check-raise, SPR, etc.)', 'https://en.wikipedia.org/wiki/Glossary_of_poker_terms'),
    r('sklansky', 'David Sklansky — The Theory of Poker (Two Plus Two, 1987/1999): pot odds, implied odds, Fundamental Theorem', 'https://en.wikipedia.org/wiki/The_Theory_of_Poker'),
    r('gtow-mdf', 'GTO Wizard blog — MDF & Alpha', 'https://blog.gtowizard.com/mdf-alpha/'),
    r('gtow-morph', 'GTO Wizard blog — Range Morphology (linear vs polarized, range & nut advantage)', 'https://blog.gtowizard.com/range-morphology/'),
    r('gtow-blockers', 'GTO Wizard blog — Understanding Blockers in Poker', 'https://blog.gtowizard.com/understanding-blockers-in-poker/'),
    r('gtow-equity', 'GTO Wizard blog — What is Equity in Poker?', 'https://blog.gtowizard.com/what-is-equity-in-poker/'),
    r('gtow-cbet', 'GTO Wizard blog — The Mechanics of C-Bet Sizing', 'https://blog.gtowizard.com/the-mechanics-of-c-bet-sizing/'),
    r('engine', 'This app — computed by its own tested engine (see tests/)', 'https://en.wikipedia.org/wiki/Poker_probability'),
  ].map((x) => [x.id, x]),
);
