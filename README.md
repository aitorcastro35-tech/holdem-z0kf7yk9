# Hold'em Trainer

A daily No-Limit Texas Hold'em decision & odds trainer for live home cash games (6–9 players). Open it for 10–15 minutes a day: play graded spots, drill odds flashcards, look things up.

- **Your move** (Mode A) — open, c-bet, value bet or check when nobody has bet.
- **Facing action** (Mode B) — fold / call / raise with the price, required equity and your equity vs the villain's assumed range.
- **Explanation after every hand** — verdict (✅ Best / 🟡 Acceptable / ❌ Mistake), the numbers (equity, required equity, outs as cards, hit %, combos, EV), why, assumptions, concept links, and "Show me the math".
- **Full hand mode** — play a whole hand flop → turn → river against a villain who keeps betting or checking by a stated strategy; three (or more) decisions in a row, with an equity-by-street chart and his hand revealed at the end. Cards, the villain's hand and his choices are random every time; you can pick the kind of flop you hit.
- **78 hand-authored classic spots** plus unlimited procedural spots: preflop (chart-graded), facing-a-bet "math spots", and c-bet / barrel / river value spots when checked to.
- **Flashcards** (216) with spaced repetition (Leitner) and a Quick 20 — odds, pot odds, combos, and a preflop-chart quiz; every answer computed by the engine or read from the cited charts.
- **Reference** — hand rankings with exact frequencies, 24 classic preflop matchups (exact), the 169-hand preflop grid (6-max / full ring, position filter, compare positions), odds tables, concept cards, pot-odds and equity calculators.
- **Progress** — daily drill, streak, accuracy by mode/street/position/concept, leak finder, review your mistakes, export/import (JSON).
- Static site, no login, works offline (PWA), dark mode by default, four-colour deck, keyboard shortcuts (F fold · C check/call · B bet · R raise · 1–5 sizes · Space next).

**Accuracy rule:** every number is either computed exactly by the app's tested engine or traced to a cited source — see [SOURCES.md](SOURCES.md). Charts are labelled as theory baselines with their assumptions; home-game advice is labelled separately and can be hidden.

## Run locally

Requires Node.js 20+ (developed with Node 24 LTS).

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test                 # all unit tests (includes a ~7 s exhaustive 133,784,560-hand evaluator check)
npm run build            # type-check + production build into dist/
npm run preview          # serve the production build locally
npm run gen:vsrandom     # regenerate src/data/preflopVsRandom.json (169-hand equity vs random, ~1 min)
npx tsx scripts/gen-matchups.ts           # regenerate src/data/matchups.json (exact matchups)
npx tsx scripts/check-library.ts          # print engine numbers for every library spot
npx tsx scripts/check-library.ts --write  # store them as "claims" (tests fail if they drift)
```

## Deploy (free)

The build uses a relative base path, so `dist/` works from any URL or sub-folder.

**GitHub Pages** (workflow included at `.github/workflows/deploy.yml`):
1. Push this folder to a GitHub repository (branch `main`).
2. In the repo: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Every push to `main` runs the tests, builds, and publishes to `https://<user>.github.io/<repo>/`.

**Netlify**: New site → import the repo → build command `npm run build`, publish directory `dist`. (Or drag-and-drop the `dist/` folder after `npm run build`.)

**Vercel**: Import the repo → framework preset "Vite" → build `npm run build`, output `dist`.

### Install on your phone
Open the deployed URL → iOS Safari: Share → *Add to Home Screen*; Android Chrome: menu → *Install app*. It works offline after the first visit.

## Your data
Progress, flashcard schedule and settings live in your browser's `localStorage`. Use **Settings → Export progress (JSON)** regularly; **Import** restores it (also on another device).

## Project structure

```
src/
  engine/        cards, 7-card evaluator, equity (exact + Monte Carlo), ranges, outs, odds, probabilities, hand features
  workers/       equity Web Worker + promise client (heavy equity never blocks the UI)
  data/          charts.ts (cited preflop ranges), concepts.ts, refs.ts, preflopVsRandom.json, scenarios/library.json
  scenarios/     spot types, compute (numbers + equity grading), generators, library loader, fullhand (multi-street engine)
  features/      home (daily drill), train (Mode A/B, explanation), flashcards, reference, progress (stats, leaks), settings
  store/         localStorage persistence, progress, Leitner, streak
tests/           evaluator, equity, ranges, odds/probabilities, outs, charts, flashcards, hand features, library, leaks
scripts/         data generation and library checks
```

## Adding a scenario
Add an entry to `src/data/scenarios/library.json` (cards like `"AhKd"`, board like `"Ks7c2d"`, pot/toCall in bb, a stated villain range — `@chartId` references a chart). Use placeholders such as `{equity}`, `{required}`, `{outs}` in the "why" text so numbers always come from the engine. Then run `npx tsx scripts/check-library.ts --write` and `npm test`.
