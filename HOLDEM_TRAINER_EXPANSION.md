# Hold'em Trainer: Expansion brief (v2)

This brief extends the **existing** Hold'em Trainer website in this folder with two new sections, followed by a full accuracy check of the whole site.

**How to work:** don't send me a plan or wait for approval; start building straight away. Read only the parts of the existing code you need, so that you **reuse the existing poker engine, evaluator, equity calculator, range data, explanation components and styling** instead of duplicating them. Do not break any existing feature.

Before changing anything, make sure the project is under git (initialise it if not) and commit the current state, so I can always roll back. Commit again after each part.

The rules from the original brief still apply: **nothing from memory**. Every number is computed by tested code or traced to a cited source in `SOURCES.md`, and the UI labels math facts, theory-based baselines and exploitative tips separately.

---

## Part 1: "Play a Hand" (heads-up vs a bot)

### 1.1 Goal
I set up a **heads-up hand (me vs one bot opponent)**, play my decisions, and the bot plays its own automatically. This simulates the common real situation where everyone else folds and two players are left. Afterwards I get a review of my decisions.

### 1.2 Setup screen
- **Positions:** choose mine and the bot's from the table (6-max or 9-max, from settings), or randomise. The rest of the table is assumed to have folded. Blinds posted correctly.
- **Stacks:** effective stack in bb (presets 20 / 50 / 100 / 200bb, plus custom).
- **Cards:** my hole cards and the bot's hole cards can each be set manually (card picker) or random. The board can be random, or I can preset some or all of flop/turn/river, for practising specific spots.
- **Bot style** (see 1.4).
- **"Random hand" button** to skip setup entirely.

### 1.3 Game engine requirements
Implement a heads-up No-Limit Hold'em hand state machine, fully unit-tested:
- Correct action order for each position matchup. When the hand starts heads-up from the blinds (SB vs BB, or button vs BB in a 2-player game), use heads-up blind rules: the button/SB acts first preflop and last postflop.
- Legal actions at every point: fold / check / call / bet / raise / all-in, with correct **minimum-raise rules** (including an all-in that is less than a full raise not reopening the action).
- All-ins with unequal stacks (return the uncalled excess), split pots, and showdown with the existing evaluator.
- When a player is all-in, run out the remaining cards and show both players' equity before each street.
- A **seeded RNG** so any hand can be replayed exactly.

### 1.4 The bot: honest, rule-based, NOT a solver
Theory-optimal (GTO) play can't be computed here. **Do not claim or imply the bot is optimal.** Label it in the UI as **"Rule-based bot: plays sensibly, not perfectly."**

**Hard rule: the bot only knows its own cards and the public information** (board, pot, stacks, action history). It must never read my cards or future board cards, even when I entered them manually. Write a test that proves this: same bot cards, same public state, different hero cards → identical bot decision distribution.

Decision logic:
- **Preflop:** use the existing position-based charts (RFI, vs open, vs 3-bet) for its range and action, using the chart's frequencies when actions are mixed.
- **Range tracking:** the bot keeps an estimated range for me. It starts from the preflop range implied by my position and action, then narrows it with simple, documented heuristics after each action (e.g. a big raise removes most weak hands, calling keeps medium-strength hands and draws).
- **Postflop:**
  1. Compute its equity against my estimated range, using Monte Carlo in a Web Worker.
  2. Sort its hand into a bucket (strong value / medium / draw / air) using equity plus made-hand and draw detection.
  3. **Facing a bet:** compare equity to required equity (pot odds), with a documented, modest implied-odds adjustment for draws on the flop and turn only. Use minimum defence frequency (MDF) as a guard so it doesn't fold far too often against small bets.
  4. **Betting:** value-bet strong hands, bet or check medium hands depending on board and position, and bluff some draws/air. On the river, the bluff-to-value ratio follows the standard B / (P + 2B) relation for the chosen size, so bluffs aren't random.
  5. Use **standard sizings** (33% / 50% / 75% / pot / all-in) chosen by simple rules (board texture, stack-to-pot ratio, hand bucket).
  6. Add controlled randomisation so it isn't predictable. Keep it reproducible with the seed.
- **Bot styles** (parameter presets over the same logic, all documented):
  - **Solid regular (default):** the baseline above.
  - **Home-game calling station:** calls too wide, rarely bluffs, rarely folds top pair.
  - **Aggressive / maniac:** opens wider, bluffs more, bigger sizings.
  - Label the styles as approximations of player types, not data-derived models.
- **Bot reasoning log:** after the hand (never during it), I can open each bot decision and see its estimated range for me, its equity, the price, its hand bucket, and the rule that triggered the action.

### 1.5 Controls
- **Play mode:** I make my decisions; the bot acts automatically, with a short adjustable delay so it feels like a real hand.
- **Replay controls:** step back/forward through the action, restart the same hand (same seed), or "try a different decision from here" by branching at any of my decision points.

### 1.6 Post-hand review (the learning part)
For each of my decisions, show:
- **Decision quality, judged by the math, not by the result and not by what the bot did.** Show my equity vs a reasonable villain range at that moment (state the range used), the pot odds / required equity, and the verdict (✅ best / 🟡 acceptable / ❌ mistake) with 2–3 bullet reasons. Reuse the existing explanation-screen components and concept tags.
- **Hindsight equity** vs the bot's actual cards, shown separately and clearly labelled "with hindsight (you couldn't know this)", so I learn the difference between a good decision and a good result.
- Grade preflop decisions against the cited charts. Grade postflop decisions only where the math supports a clear verdict; otherwise say "close / depends on reads" instead of inventing certainty.
- **Export the hand history** as plain text, and feed my mistakes into the existing "Review my mistakes" / stats system.

---

## Part 2: "Range Explorer" (my whole grid vs villain's hand or range)

### 2.1 Goal
I enter the villain's exact hand **or** range. The app shows, for **every one of the 169 starting hands** on the grid, my best action, how profitable each option is, and the summary percentages.

### 2.2 Inputs
- **Villain:** an exact hand (card picker) **or** a range: standard notation (`22+, A2s+, KTo+`), clicking cells on a 13×13 grid, or loading presets from the existing charts (e.g. "BTN open range", "CO 3-bet range").
- **Spot type** (each with its own fields):
  1. **Preflop, facing an all-in:** villain shoves X bb. My options: call / fold.
  2. **Preflop, facing a raise:** villain opens to X bb from a position. My options: fold / call / 3-bet (size selectable).
  3. **Postflop, facing a bet:** enter the board (flop/turn/river), pot, bet size, and effective stack. Options: fold / call / raise.
  4. **Preflop, push-or-fold** at short stacks vs the villain's calling range: open-shove / fold.
- Stack sizes, blinds/antes, my position vs the villain's.

### 2.3 Calculations: be precise about what is exact and what is assumed
- **Exact (chip EV):** call/fold vs an all-in (spot 1), shove/fold vs a known calling range (spot 4), and call/fold on the river (spot 3, river only).
  - EV(call) = equity × final pot − amount called. EV(fold) = 0 (measured from the decision point).
  - Use combo-level equity with **card removal**: my specific hand removes combos from the villain's range. Each grid cell aggregates its suit combos correctly (6 / 4 / 12).
- **Model-based (assumptions shown as sliders):** 3-bets and raises (spot 2), and flop/turn calls and raises (spot 3). Expose the assumptions clearly:
  - **Villain's response to my raise:** let me define it either as a simple fold %, or as "villain continues with the top N% of his range" (ranked by equity), plus how much of that he re-raises.
  - **Equity realisation** for calls that see more streets (e.g. a default of ~1.0 in position and lower out of position). Document the defaults and their source, or label them as rough assumptions if no solid source exists.
  - Show the **break-even fold %** for every raise: how often the villain must fold for the raise to be profitable on its own.
- **Performance:** 169 hands × combo-level equity vs a range must feel responsive.
  - Run the calculations in Web Workers with a progress bar, and cache results.
  - For preflop, consider precomputing a hand-vs-hand equity table offline with a script and shipping it as data. **Verify that table against known published matchups** before using it, and document the method and precision in `SOURCES.md`.

### 2.4 Output
- The **13×13 grid coloured by the most profitable action** (fold / call / 3-bet or raise / shove). Shade the colour intensity by how much better the best action is than the next best, so marginal hands look marginal.
- **Each cell shows** my equity vs the range and the EV (in bb) of each action. Tap/hover for full detail: equity, EV per action, combos after card removal, and the break-even numbers.
- **Summary panel:** % of all hands (by combos, out of 1,326) in each action. For example: "Call 18.4% · 3-bet 6.2% · Fold 75.4%". Also list the "close" hands (within ±0.1 bb of break-even).
- Toggle between **"best action" view** and **"equity heat-map" view**.
- Be clear in the UI that these are **"profitable or not under these assumptions"**, not solver mixed-strategy frequencies. A small info box should explain the difference.
- **Cross-check:** for the all-in modes, compare a sample of results against a reputable published push/fold or call-off chart (e.g. heads-up Nash push/fold at 10bb), if a verifiable free source exists. Report and explain any discrepancies.

---

## Part 3: Navigation, settings, persistence
- Add both sections to the existing navigation and match the existing visual style, card design, four-colour deck option, dark/light mode, and keyboard shortcuts.
- Save simulator setups and Range Explorer inputs as **named presets** in `localStorage`, included in the existing export/import.
- Both sections must work well on mobile (the grid stays readable; detail opens in a bottom sheet).

---

## Part 4: Final check: accuracy of the WHOLE site + testing (required)
This check covers the **entire site, old and new**. I need to trust every number in it.

1. **Accuracy review of all existing content:** every number, percentage, probability, range and claim (flashcards, reference tables, hand-ranking frequencies, outs tables, preflop charts, scenario explanations, glossary, tooltips).
   - **Math facts:** recompute them with the engine (exhaustive enumeration wherever feasible), then cross-check against a reputable published source (Wizard of Odds, the Wikipedia "Poker probability" article, *The Mathematics of Poker*). Watch for the common traps: one card vs two cards to come; "at least" vs "exactly"; ties included or not; dead cards removed or not.
   - **Preflop charts:** check that each one matches its cited source exactly (re-check with web search/fetch) and shows its assumptions (table size, stack depth, open size).
   - **Strategy explanations:** check that the reasoning matches the numbers and mainstream poker theory. Flag opinion presented as fact.
   - Fix anything wrong, and write `AUDIT.md` listing each item checked: ✅ correct / 🔧 fixed / ⚠️ unverifiable or removed, with old → new value and the source.
2. **Tests:**
   - The heads-up state machine: action order, min-raise, short all-ins, uncalled bets returned, split pots.
   - The bot-information test from 1.4.
   - Range Explorer: EV formulas against hand-calculated examples, combo counts after card removal, and equity values vs published matchups (verify each expected value from a source before writing the test).
   - Re-run the full existing test suite.
3. **Build the production bundle, open the site, click through every section (old and new), and fix anything broken.**

## Final report
When finished, give me:
1. The accuracy review summary (link to `AUDIT.md`): what was checked, what was fixed.
2. What was built in Parts 1 and 2, and how to use each.
3. Every assumption and default used by the bot and by the Range Explorer, and where each comes from.
4. Known limitations, stated plainly.
5. Any `TODO(verify)` items and ideas for a next version (e.g. 3-player hands).
