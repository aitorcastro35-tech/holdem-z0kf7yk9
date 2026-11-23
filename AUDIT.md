# Accuracy audit — whole site (2026-11-23)

Scope: every number, percentage, probability, range and factual claim in the app, old and new. Each item was recomputed with the app's engine (exhaustive enumeration wherever feasible) and/or re-checked against its cited source (re-fetched on 2026-11-23).

Legend: ✅ correct · 🔧 fixed (old → new) · ⚠️ unverifiable / removed / labelled as an assumption

Common traps checked everywhere: one card vs two cards to come; "at least" vs "exactly"; ties included or not; dead cards removed or not.

## 1. Math facts

| Item | Where | Check | Result |
|---|---|---|---|
| 5-card hand frequencies (4 / 36 / 624 / 3,744 / 5,108 / 10,200 / 54,912 / 123,552 / 1,098,240 / 1,302,540) | Reference → Hand rankings | Full enumeration of 2,598,960 hands + closed-form formulas; Wikipedia "Poker probability" | ✅ |
| 7-card frequencies (4,324 / 37,260 / 224,848 / 3,473,184 / 4,047,644 / 6,180,020 / 6,461,620 / 31,433,400 / 58,627,800 / 23,294,460) | Hand rankings "best of 7" | Full enumeration of 133,784,560 hands (tests/evaluator.test.ts); Wikipedia | ✅ |
| Outs → % (flop→turn n/47, turn→river n/46, flop→river 1 − C(47−n,2)/C(47,2)) for 1–20 outs | Odds tables, flashcards, explanations | Combinatorics in code; Wizard of Odds pot-odds table (34.97 / 31.45 / 16.47 and 19.57 / 17.39 / 8.70) | ✅ — "flop→river" is labelled "assumes you see both cards" (two-cards trap) |
| Rule of 2 and 4, and the "4·outs − (outs − 8)" correction | Odds tables, flashcards | Shown beside exact values; test bounds the error (≤ 2.5 pts for 1–15 outs) | ⚠️ labelled rule of thumb; origin of the correction not verified (TODO(verify)) |
| Typical draw out counts (2 set, 3 overcard, 4 gutshot, 5 two pair/trips, 6 two overcards, 8 OESD, 9 flush, 12 FD+gutshot, 15 FD+OESD, 7 set-to-boat) | Odds tables, flashcards | Re-derived (e.g. 15 = 9 + 8 − 2 overlap; 7 = 6 board-pairing + 1 quads) | ✅ |
| Dealt a pocket pair 78/1,326 = 1/17; AA 6/1,326 = 1/221; suited 312/1,326 | Odds tables, flashcards | Enumeration of all 1,326 starting hands; Wikipedia "Texas hold 'em starting hands" | ✅ |
| Pocket pair flops "a set or better" 11.76% | Odds tables, flashcards | Enumeration of 19,600 flops = 1 − C(48,3)/C(50,3). Counts flops containing a card of your rank only (set or quads); a full house from a flopped board trips is not included | 🔧 label "set or better" → "set or quads (a card of its rank hits)" ("at least one card of your rank" in the flashcard) to remove the ambiguity |
| Unpaired hand pairs at least one hole card 32.43% | Odds tables, flashcards | Enumeration (= 1 − C(44,3)/C(50,3)); "at least one" stated | ✅ |
| Suited hand flops a flush draw (exactly 2 of suit) 10.94%; a flush 0.84% | Odds tables, flashcards | Enumeration (C(11,2)·39 and C(11,3) of 19,600) | ✅ |
| Pot odds B/(P+2B), MDF P/(P+B), alpha B/(P+B), EV(call) | Odds tables, calculators, flashcards, concepts | Formulas unit-tested; GTO Wizard "MDF & Alpha" | ✅ |
| Combo counts (6/4/12, 1,326, 169, blocker examples) | Flashcards, concepts | Range engine tests | ✅ |
| Preflop matchups (24 rows) | Reference → Matchups | Exact enumeration test (tests/matchups.test.ts); DeucesCracked exact table for shared rows | ✅ — note for AA vs AKo corrected earlier ("drawing almost dead" → "wins about 7%") |
| Hand-vs-hand equities in tests (14 matchups) | tests/equity.test.ts | DeucesCracked exact (same cards) | ✅ |
| AA vs a random hand 85.20% | Hand detail, tests | One-off exhaustive enumeration (2,097,572,400 matchups) | ✅ |
| 169-hand "equity vs random" and rank | Preflop grid hand detail, bot strength order | Was Monte Carlo (1M deals per hand) | 🔧 now exact, derived from the exact preflop table (§3); values change by ≤ 0.1 pt |

## 2. Preflop charts (theory baselines) — re-fetched and compared character by character

| Chart | Source | Result |
|---|---|---|
| 6-max RFI LJ/UTG, HJ, CO, BTN, SB | PokerCoaching free charts (re-fetched 2026-11-23) | ✅ all five strings identical; assumptions (100bb, 2.5bb / 3bb SB, "implementable") shown |
| Full-ring RFI UTG, UTG+1, LJ, HJ, CO, BTN, SB | PokerCoaching (8-handed list) | ✅ identical; ⚠️ 9-handed mapping (UTG & UTG+1 use the UTG list, MP uses UTG+1) is this app's adaptation — labelled |
| BTN vs CO (3-bet / call) | Poker Skill preflop charts (updated 2026-11-21) | ✅ identical |
| BB vs BTN (defend) | Poker Skill opening ranges (updated 2026-11-20) | ✅ identical |
| Published % vs our computed % | — | ✅ Poker Skill reproduces exactly; PokerCoaching text lists differ from the page's printed % by ≤ 0.9 pts (the page's own inconsistency) — the app displays the % of the text it uses and notes the printed value |
| Push/fold 10bb (UTG, BTN, SB shoves; BB call vs UTG) | Poker Skill push/fold page, reproducing O'Kearney & Carter (no-ICM) | ✅ copied verbatim; "Ax"/"Qx+" shorthand expanded (noted) |
| Vs-3-bet charts | — | ⚠️ no free verifiable source; not shown; bot uses a labelled heuristic; review does not grade |

## 3. New data

| Item | Check | Result |
|---|---|---|
| Exact preflop equity table (47,008 matchups) | Count = 47,008; seat-swap complement; 40 random matchups = fresh enumeration (to 1e-9); DeucesCracked rows (to 0.05 pt); AA vs random 85.2037% = independent enumeration | ✅ |
| Range Explorer EV formulas | Hand-calculated examples (all-in call incl. uncalled excess, push/fold, 3-bet with fold/call/4-bet, realization) | ✅ tests/explorer.test.ts |
| Range Explorer card removal | Combo counts after blockers (e.g. AKs vs KdKc → 2 combos; 1,225 combos total) | ✅ |
| Range Explorer vs published call-off chart | BB calling a 10bb UTG shove (9-handed, no antes, chip EV): the Explorer's exact best response vs the published chart (Poker Skill / O'Kearney & Carter) | ⚠️ **Discrepancy, explained:** the exact chip-EV best response to the published UTG shove range calls **12.2%** of hands vs the published **19.0%**. Every hand the Explorer calls is in the published range; the 14 differences (A6s–A2s, KTs, QJs, QTs, KJo, JTs, A9o, A8o, A7o, 33) are all hands the chart calls with 41.0–43.8% equity against a price of 43.9% (call 9 to win 20.5). Adding a 1bb big-blind ante raises the best response to 16.6%, a 0.125bb ante ×9 to 17.5% — so the published range is consistent with different underlying assumptions (antes / a different shove range) rather than the page's stated "no antes". The engine's equities themselves match the exact published matchups. Kept as a preset with this note; `scripts/xcheck-callchart.ts` reproduces the comparison. |

## 4. Strategy explanations and claims

| Item | Check | Result |
|---|---|---|
| 78 library spots | Every stored number recomputed; "call"/"fold" verdicts checked against equity vs price; placeholders only filled from the engine | ✅ (fixes made when written: B01, B08, B10, B14, B20, B22, B26, B39, A30) |
| Library text claims without placeholders (e.g. "UTG chart opens only KQo among offsuit kings", "K5o+", "11.8% of flops, 7.5 : 1", "0.6 × 0.6 = 36%") | Re-checked against charts and arithmetic | ✅ |
| Generator explanations (RFI, vs-open, math spots, c-bet spots, full hand) | Numbers generated from the engine; rules stated in the UI | ✅ |
| Concept cards | Formulas and examples recomputed (pot odds 25%, EV +10, MDF 66.7/50%, 7/44 = 15.9%, 3 AA / 12 AK combos) | ✅ |
| "Low SPR (≤ 3)", c-bet / range-advantage guidance, polarization | Mainstream theory, cited to GTO Wizard / Wikipedia; shown as "Theory baseline", not math | ✅ labelled as theory |
| Home-game exploit notes | Opinion-based practical advice | ✅ always labelled "Practical advice", hideable — not presented as fact |
| Full-hand villain strategy, bot heuristics, Explorer defaults | Modelling assumptions | ⚠️ labelled as assumptions in the UI and SOURCES.md §8 (not solver output) |
| 3-bet sizing in vs-open spots (3-bet to 7.5 vs a 2.5 open in position) | Poker Skill "about three times the original raise" in position | ✅ (PokerCoaching uses 3.5×; noted as an alternative) |

## 5. Bugs and inaccuracies found during the audit / build

| Item | Old → new |
|---|---|
| Math/full-hand spots BTN vs CO flop pot | 5.5bb → 6.5bb (both blinds dead) — fixed in the previous release, re-verified |
| Set probability label ambiguity | see §1 |
| Range Explorer mobile layout | grid column overflowed to 487px at a 375px viewport → fixed (all pages now fit) |
| Bot BB defence heuristic (no chart) | band ×1.1 of opener range → ×2.0 (BB folded 75s to a HJ open, far too tight); documented |
| Explorer postflop defaults | continue vs raise 40% → 65% (with 40%, every hand became a profitable bluff-raise) — still an adjustable assumption |

## 6. Multiway upgrade (2026-11-23)

| Item | Check | Result |
|---|---|---|
| Action order 3–6 players, folded/all-in skipped, heads-up blind rule | `tests/multiway.test.ts` | ✅ |
| Minimum raise, short all-in not reopening, cumulative short all-ins reopening | TDA 2026 Rules 45A / 49A; tests | ✅ (cumulative rule added after re-reading 49A) |
| Side pots with three unequal all-ins (10 / 30 / 60 + caller → 40 / 60 / 60) | TDA Rule 23; test | ✅ |
| Split pots and the odd chip (first winner left of the button) | TDA Rule 21; tests with 1,003-cent and 203-cent pots | ✅ |
| Uncalled bets returned; chip conservation over 3,000 random 2–6-player hands | tests | ✅ |
| Live pot display | During the hand only all-in amounts create side pots | 🔧 unequal bets mid-round were briefly shown as side pots → fixed (test added) |
| 3-way equities vs PokerNews (Adams 2020) | Exact enumeration (1,370,754 boards) vs published approximate win % | ✅ all within 1.2 points (39.14/32.48/28.37; 37.68/44.60/17.72; 65.92/19.39/14.69) |
| Multiway equity vs ranges | Monte Carlo reproduces the exact known-hands result within 1 point; equity falls as opponents are added | ✅ |
| Bot information rule (multiway) | Changing any other player's hidden cards and the future board → identical decisions, for all styles | ✅ `tests/mwbot.test.ts` |
| Bot speed | Max decision time in tests < 600 ms (Monte Carlo budget 250 ms) | ✅ |
| Multiway value threshold, bluff halving, +3 pts per player behind, preflop multiway heuristics, Home-game mix, Action table ×1.35 | No published source | ⚠️ labelled heuristics (UI + SOURCES.md §10) |
| Concept card "Multiway pots" | GTO Wizard 10 Tips for Multiway Pots (0.6 × 0.6 = 36% example is arithmetic) | ✅ |
| Concept card "Side pots & split pots" | TDA Rules 21/23; 40 / 60 / 60 example = engine test | ✅ |
