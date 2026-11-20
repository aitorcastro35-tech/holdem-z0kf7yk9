# Build: "Hold'em Trainer" — a daily Texas Hold'em decision & odds trainer

## 0. Who this is for and what success looks like

I play a **No-Limit Texas Hold'em cash game** with a group of friends: a live home game, usually 6–9 players, low stakes. I want a **simple website I can open every day for 10–15 minutes** and get better at making the right decision: fold, check, call, bet, or raise.

Success means:
- Every scenario has a decision I can **grade** and an explanation I can **learn from**. It should say why my choice was right or wrong and give the numbers behind it (equity, pot odds, outs, required equity, combos, EV where meaningful).
- **Every number in the app is either computed exactly by code or traced to a cited, reputable source.** Nothing comes "from memory". This matters more than visual polish.
- It works well on my phone and on my laptop.

Before writing code, read this whole document, then reply with a short plan (stack, folder structure, data sources you intend to use, milestones). Then build it milestone by milestone.

---

## 1. Tech constraints

- **Static site, no backend, no login.** Suggested stack: Vite + React + TypeScript + Tailwind (or plain CSS). If you think something simpler is clearly better, say so and why.
- Persist progress (stats, flashcard schedule, settings) in `localStorage`, with an **Export / Import progress (JSON)** button so I don't lose data if I clear the browser.
- Make it deployable for free (GitHub Pages, Netlify, or Vercel) and include deploy instructions in the README. An installable **PWA** (works offline, home-screen icon) is a plus.
- Do heavy equity calculations in a **Web Worker** so the UI never freezes.
- **Unit tests** (Vitest) are required for all poker math (see §6).

---

## 2. Research & accuracy rules (most important section)

1. **Separate three kinds of information and label them in the UI:**
   - **Math facts**, such as "a flush draw on the flop completes by the river 34.97% of the time". These are exact and must be **computed by the app's own code** (combinatorics or exhaustive enumeration), then cross-checked against a published source.
   - **Theory-based baselines**, such as preflop opening ranges by position. These come from solver outputs or published charts. They are *models*, not laws of nature. Show the source and assumptions next to them (e.g. "6-max, 100bb deep, 2.5x open, rake not included").
   - **Exploitative adjustments**, such as "in loose low-stakes home games, value-bet thinner and bluff less". Label these clearly as practical advice, not math, and keep them separate from the baseline.
2. **Research before you hard-code anything.** Use web search/fetch to find and verify sources. Prefer, in roughly this order:
   - Exact math references: Wizard of Odds' poker probability pages, the Wikipedia "Poker probability" article (verify its numbers against your own code), and textbooks such as *The Mathematics of Poker* (Chen & Ankenman).
   - Strategy theory: *The Theory of Poker* (Sklansky) for pot odds, implied odds and the Fundamental Theorem; *Modern Poker Theory* (Acevedo) and *Play Optimal Poker* (Brokos) for GTO concepts (MDF, alpha, polarization, range advantage).
   - Preflop charts: free, published, solver-based charts from reputable training sites (e.g. Upswing Poker, PokerCoaching.com / Jonathan Little, GTO Wizard's free content). Check what is actually freely available, and **do not copy anything behind a paywall.** If charts disagree, pick one consistent source per table format and mention that alternatives exist.
3. Create a **`SOURCES.md`** listing every source used, which part of the app it feeds, and the date you checked it. In the app, put a small "ⓘ Source" link next to every chart and reference table.
4. If you can't verify something, **don't include it.** Leave a `TODO(verify)` comment and list it in your final report instead.
5. Be honest in the UI about uncertainty. Postflop "correct" answers often depend on assumptions about the opponent's range. Whenever a grade relies on an assumed villain range, show that range.

---

## 3. Core poker engine (build and test this first)

- Card / deck / hand representation; a **7-card hand evaluator** (write your own or use a well-tested library, but wrap it and test it either way).
- **Equity calculator**: hand vs hand, and hand vs **range**. Use exhaustive enumeration when feasible (turn, river, small ranges). Otherwise use Monte Carlo with enough iterations for ±0.5% (show "≈" for Monte Carlo results).
- **Range parser** for standard notation (`22+, A2s+, KTo+, 76s`), with combo counting that removes blockers (cards on the board or in hero's hand).
- **Outs counter** that reports clean outs and flags "dirty" outs (e.g. a flush card that also pairs the board and could give villain a full house).
- **Pot-odds / required-equity / MDF helpers:**
  - Facing a bet B into a pot P (P before the bet): required equity to call = B / (P + 2B). MDF = P / (P + B).
  - Bluff break-even: B / (P + B).
- **Basic EV** for call/fold decisions: EV(call) = equity × final pot − cost of call. Mention implied odds separately and qualitatively, unless the scenario explicitly defines remaining stacks.

---

## 4. Features / sections

### 4.1 Mode A: "Your move" (proactive decisions)
Spots where action is on me and nobody has bet yet in this round: opening preflop, being checked to, deciding whether to c-bet, value bet, or check back.
- Show a clean table: my position, hole cards, board, pot, effective stacks, previous action summary.
- Options: **Fold / Check / Call / Bet / Raise**, with sizing buttons for bets and raises (e.g. preflop 2.5x / 3x / 4x; postflop 33% / 50% / 75% / pot / all-in).
- Grade with three levels: **✅ Best**, **🟡 Acceptable** (mixed strategies exist; several actions can be fine), **❌ Mistake**.

### 4.2 Mode B: "Facing action" (responding to opponents)
The opponent opens, 3-bets, bets, check-raises, or shoves, and I decide: **fold, call, or raise**.
- Always show the **price**: amount to call, pot after calling, required equity %.
- After my answer, show my **equity vs the villain's assumed range** next to the required equity. That comparison is the core lesson of this mode.

### 4.3 Explanation screen (after every hand / exercise)
A consistent, scannable layout, not walls of text:
1. **Verdict** (best / acceptable / mistake) and the recommended action.
2. **The numbers:** my equity, required equity / pot odds, outs (listed as actual cards), probability of hitting on the next card and by the river, combos in villain's range, and EV where it is meaningful.
3. **Why**, in 2–4 bullet points of plain reasoning: range advantage, blockers, position, value vs bluff, implied odds.
4. **Assumptions** used (villain range, stack depth, table size).
5. **Concept tag(s)** linking to a reference card (e.g. "Pot odds", "Rule of 2 and 4", "MDF", "Blockers").
6. **"Show me the math"** expandable section with the full calculation.

### 4.4 How scenarios are generated (important)
Don't pretend to be a solver. Use two sources:
- **Preflop:** generate scenarios procedurally (random position + hand + prior action) and grade them against the cited preflop charts (open / fold, vs open: 3-bet / call / fold, vs 3-bet). Mixed-frequency hands count as "Acceptable" for any action the chart mixes.
- **Postflop:**
  - (a) **Procedurally generated "math spots"** where the answer follows from math: facing a bet with a draw, a clear value hand, or air. Grade by equity vs required equity, given a stated villain range.
  - (b) **A hand-authored library of at least 40 classic spots** (stored as JSON in `/src/data/scenarios/`), each with a written rationale and source/concept reference. Examples: c-betting dry vs wet boards, top pair weak kicker facing a raise, set on a flush-draw board, overpair facing a check-raise, river bluff-catching, thin value on the river.
- Every scenario stores the inputs needed to recompute its numbers. A test must recompute the numbers for every library scenario and fail if the stored explanation disagrees with the engine.

### 4.5 Flashcards: odds & concepts
- Spaced repetition (a simple Leitner box system is fine) and a "quick 20" session.
- Card types: probabilities, outs → %, pot odds → required equity, combo counting, rule-of-thumb conversions.
- Examples (**all values must be computed by the engine and tested**, not typed in):
  - Suited hole cards, two of my suit on the flop (flush draw): hit by the river ≈ 35%; on the turn alone ≈ 19%.
  - Open-ended straight draw (8 outs): ≈ 31.5% flop → river.
  - Gutshot (4 outs): ≈ 16.5% flop → river.
  - Pocket pair flops a set or better: ≈ 11.8%.
  - Unpaired hand flops at least a pair: ≈ 32.4%.
  - Being dealt a pocket pair: ≈ 5.9%; a specific pair like AA: 1/221 ≈ 0.45%.
  - Suited hand flops a flush draw: ≈ 10.9%; flops a made flush: ≈ 0.84%.
  - Facing a half-pot bet: need 25% equity; a pot-size bet: 33%.
  - Combos: a pair has 6, a suited hand 4, an offsuit hand 12; 1,326 total; 169 distinct starting hands.
- Allow both directions (question → number, number → concept) and multiple choice or "type the %" with a tolerance.

### 4.6 Reference section
1. **Hand rankings**: royal flush down to high card, with example cards, the number of 5-card combinations, and probability. Include tie-breaker/kicker rules and common confusions (e.g. a board that plays, counterfeited two pair, the wheel A-2-3-4-5).
2. **The 169-hand preflop grid** (13×13: pairs on the diagonal, suited above, offsuit below):
   - **Position filter** (UTG, UTG+1, MP, LJ, HJ, CO, BTN, SB, BB) and a **table-size toggle** (6-max / 9-max full ring), since my home game varies.
   - **Scenario filter**: RFI (raise first in), vs open (3-bet / call / fold), vs 3-bet.
   - Colour-coded actions with a legend; mixed hands shown with split colours and frequencies; total range % and combo count shown.
   - A **"Compare positions"** view (e.g. UTG vs BTN side by side or as an overlay) so I can see how the range widens with position.
   - Tap any hand to see its combos, its equity vs a random hand, and its rank among the 169.
3. **Odds tables**: outs → probability (next card / by river), the Rule of 2 and 4 next to the exact values, and the correction for the Rule of 4 when there are many outs.
4. **Concept cards / glossary**: pot odds, implied odds, equity, fold equity, MDF, range advantage, nut advantage, blockers, SPR, position, c-bet, check-raise, polarized vs linear ranges.
5. **Tools**: a pot-odds calculator and an equity calculator (my hand vs a hand or range, optional board).

### 4.7 Progress & daily habit
- **"Daily drill"**: one button starts a mixed session of about 10 hands + 10 flashcards, weighted toward my weak areas.
- **Stats**: accuracy by mode, street, position, and concept tag; a streak counter; a history of my last mistakes with a **"Review my mistakes"** mode.
- **Leak finder**: "You fold too often to half-pot river bets", "You over-call out of position with offsuit broadways", based on my answer history.

### 4.8 Settings
Table size (6 / 9), default stack depth (e.g. 50bb / 100bb / 200bb), blind structure display (bb units vs chips), difficulty, and a toggle to show/hide the **home-game exploit notes**.

---

## 5. UX guidelines
- Clean and fast. One clear decision per screen; big tap targets on mobile; keyboard shortcuts on desktop (F = fold, C = check/call, R = raise, B = bet, Space = next).
- Cards must be readable at a glance: four-colour deck option (♠ black, ♥ red, ♦ blue, ♣ green).
- Dark mode by default, light mode available.
- No sign-ups, ads, or anything that slows down a 10-minute session.

---

## 6. Testing & verification (required)
- Unit tests for the evaluator (every hand category, ties, kickers, the wheel, board-plays situations).
- Probability tests: the app's computed values must match the known exact values within tolerance, including all flashcard examples in §4.5 and the hand-ranking frequencies in §4.6.
- Equity tests against well-known matchups, e.g. AA vs KK preflop ≈ 82/18. Verify each expected value from a cited source before writing the test.
- Range tests: combo counts for standard ranges, blocker removal.
- A test that recomputes every authored scenario (see §4.4).
- Before reporting "done": run the test suite, build the production bundle, open the site and click through every section, and fix anything broken.

---

## 7. Milestones
1. Engine + tests (evaluator, equity, ranges, odds helpers).
2. Reference section (hand rankings, 169 grid with position/scenario filters + sources, odds tables).
3. Flashcards with spaced repetition.
4. Mode B (facing action), then Mode A (your move), with the explanation screen.
5. Scenario library (≥ 40 authored spots) + procedural generators.
6. Progress, daily drill, leak finder, export/import.
7. PWA, polish, README with run and deploy instructions.

After each milestone, give me a short summary and tell me how to run it locally.

## 8. Final report
When finished, list: what was built, every data source used (also in `SOURCES.md`), every assumption baked into the ranges, any `TODO(verify)` items, and ideas for a version 2 (e.g. a tournament/ICM mode, multiway pots, importing my own hand histories).
