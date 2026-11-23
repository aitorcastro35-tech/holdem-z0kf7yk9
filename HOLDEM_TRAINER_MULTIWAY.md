# Hold'em Trainer: "Play a Hand" multiway upgrade (up to 6 players)

The heads-up "Play a Hand" section works, but because the bot plays correctly it folds preflop most of the time, so I rarely get to play a hand out. Extend the **whole Play a Hand section** so I can play against **1 to 5 bot opponents (max 6 players including me)**.

**How to work:** start building straight away, without sending a plan or waiting for approval. Reuse the existing engine, bot logic, evaluator, equity calculator, charts, review screen and styling; extend them rather than rewriting them. Everything that works heads-up today must keep working: the heads-up case is simply "1 opponent". Commit the current state to git before changing anything, and commit again when done.

The original rules still apply: **nothing from memory**. Every number is computed by tested code or traced to a cited source in `SOURCES.md`, and the UI labels math facts, theory-based baselines and heuristics separately.

---

## 1. Setup changes
- **Number of opponents:** 1–5 (selector), on a 6-max table. With fewer than 6 players, remove the earliest positions first (e.g. 4 players = CO, BTN, SB, BB).
- **My seat:** choose it or randomise. Option to **rotate the button** after every hand.
- **Session mode:** "Deal next hand" keeps playing consecutive hands at the same table, with a toggle for stacks to **carry over** or **reset to the starting stack** every hand.
- **Cards:** as now, my cards and any bot's cards can be set manually or random, and the board can be preset.
- **Bot style per seat** (Solid regular / Home-game calling station / Aggressive-maniac), plus a **"Home-game mix"** preset that seats a realistic mix of styles (e.g. mostly solid with one calling station and one aggressive player). Document the mix used.

## 2. Game engine: multiway rules (fully unit-tested)
- Correct action order for 3–6 players, preflop and postflop. Folded and all-in players are skipped.
- Legal actions and **minimum-raise rules** with several players, including an all-in smaller than a full raise that does **not** reopen the betting for players who have already acted.
- **Side pots** with multiple all-ins of different sizes. Each pot is awarded to the best hand among the players eligible for it.
- **Split pots** between 2+ players. The odd chip goes to the first eligible player left of the button.
- Uncalled bets are returned. When everyone remaining is all-in, run out the board and show every player's equity before each street.
- Seeded RNG, so any hand (including full sessions) can be replayed exactly.
- Keep all existing heads-up tests passing.

## 3. Bot logic: multiway
Keep the UI label **"Rule-based bot: plays sensibly, not perfectly."** Multiway play is where rule-based bots are weakest, so be conservative and honest about it.

- **Information rule (extend the existing test):** each bot sees only its own cards and public information, never mine, never other bots', and never future board cards. Test: changing any other player's hidden cards must not change a bot's decision distribution.
- **Preflop:**
  - Use the existing charts for unopened pots, facing an open, and facing a 3-bet.
  - For spots the charts don't cover (facing an open **plus callers**, squeezes, overcalls, limped pots), use a documented heuristic. For example: tighten the calling range when there are callers already; squeeze with a subset of the 3-bet range, adjusted for the number of callers.
  - Label these heuristics as heuristics unless you find and cite a reputable source.
- **Range tracking:** each bot keeps a separate estimated range for **every** opponent still in the hand.
- **Postflop:**
  - Equity is computed **against all remaining opponents' ranges together** (Monte Carlo in a Web Worker).
  - Value thresholds rise and bluffing frequency drops as the number of opponents grows, since a bluff has to get through several players. Document the exact adjustment.
  - Required equity / pot odds stay as before (B / (P + 2B) heads-up generalises to: amount to call ÷ final pot if called).
  - Account for players still to act behind (a call with players behind is worth less than closing the action). A simple documented discount is fine.
- **Speed:** each bot decision should take under ~300 ms. Use capped iterations or a time budget, and show "≈" for Monte Carlo values.
- The **bot reasoning log** (after the hand) shows, for each bot decision: its estimated range per opponent, its multiway equity, the price, its bucket, and the rule that fired.

## 4. Making the section more playable
- **Fast-forward:** when I fold or I'm not involved, a "Skip to result" button (and a setting to auto-skip).
- **"Auto-deal next hand"** toggle, so sessions flow quickly.
- An optional **"Action table" setting** that loosens all bots' preflop ranges by a documented amount, so more hands go to the flop. Label it as a training convenience, not realistic play.

## 5. Table UI
- A 6-seat table layout that works on mobile and desktop: seat positions, stacks, current bets, dealer button, folded seats greyed out, **main pot and side pots shown separately**, and whose turn it is clearly highlighted.
- Bot cards stay hidden until showdown. In the review, I can reveal all hands.

## 6. Post-hand review: multiway
- My decisions are still judged by the math, not the result: my equity vs the **combined** ranges of the opponents still in the hand (state the ranges used), pot odds / required equity, and the verdict (✅ / 🟡 / ❌) with 2–3 bullet reasons.
- Mention multiway-specific concepts where relevant: needing a stronger hand to value-bet multiway, fewer bluffs, players acting behind, reverse implied odds. Link to the reference/concept cards, and add new cards if needed, sourced.
- Hindsight equity vs **all** actual hands, clearly labelled "with hindsight".
- Grade postflop multiway spots only where the math supports a clear verdict; otherwise say "close / depends on reads".
- Hand history export and "Review my mistakes" / stats work for multiway hands. Stats should also be split by number of players.

## 7. Final check (required)
1. Tests: multiway action order, min-raise and short-all-in rules, side pots with 3+ unequal all-ins, split pots and the odd chip, the extended bot information test, and multiway equity vs known published 3-way matchups (verify each value from a source before writing the test).
2. Re-run the full existing test suite (all heads-up tests must still pass).
3. Add every new number, heuristic and concept card to `AUDIT.md` with its status and source.
4. Build the production bundle, open the site, play several hands at 2, 3, 4 and 6 players (including all-in hands with side pots), click through the review, and fix anything broken.

## Final report
List what changed, how to use it, every new heuristic and default (with source or "heuristic" label), known limitations of the multiway bot stated plainly, and any `TODO(verify)` items.
