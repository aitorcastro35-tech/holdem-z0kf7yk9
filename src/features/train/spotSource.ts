// Chooses the next spot for a session and finalizes equity-graded spots (equity computed in the worker).
import type { Card } from '../../engine/cards';
import type { WeightedCombo } from '../../engine/range';
import { features } from '../../engine/handclass';
import { computeEquity } from '../../workers/equityClient';
import type { Settings } from '../../store/settings';
import type { Spot } from '../../scenarios/types';
import { LIBRARY } from '../../scenarios/library';
import { generateRfiSpot, generateVsOpenSpot, generateMathSpot, newRng, type Rng } from '../../scenarios/generators';
import { villainCombos, gradeByEquity, isStrongDraw, staticNumbers } from '../../scenarios/compute';
import { generateCheckedToSpot } from '../../scenarios/fullhand';

const rng: Rng = newRng();

const workerEquity = (hero: Card[], combos: WeightedCombo[], board: Card[]) =>
  computeEquity({ hero, board, villainCombos: combos.map((c) => ({ cards: c.cards, weight: c.weight })) });

/** Compute equity for a spot with a villain range (in the worker) and, for equity-graded spots, the grades. */
export async function finalizeSpot(spot: Spot): Promise<Spot> {
  if (!spot.villain || spot.precomputedEquity) return spot;
  const eq = await workerEquity(spot.hero, villainCombos(spot.villain, spot.hero, spot.board), spot.board);
  let s: Spot = { ...spot, precomputedEquity: eq };
  if (spot.gradeBasis === 'equity') {
    const req = staticNumbers(spot).requiredEquity!;
    const f = features(spot.hero, spot.board);
    const g = gradeByEquity(eq.equity, req, { options: spot.options, strongDraw: isStrongDraw(f, spot.board), street: spot.street, noValueRaise: spot.noValueRaise });
    s = { ...s, grades: g.grades, best: g.best };
  }
  return s;
}

export type SessionMode = 'A' | 'B' | 'mixed';

let lastLibrary: string[] = [];
function pickLibrary(mode: 'A' | 'B', focus: string[] = []): Spot {
  let pool = LIBRARY.filter((s) => s.mode === mode && !lastLibrary.includes(s.id));
  const focused = pool.filter((s) => s.concepts.some((c) => focus.includes(c)));
  if (focused.length) pool = focused;
  const s = pool[Math.floor(rng() * pool.length)] ?? LIBRARY.find((x) => x.mode === mode)!;
  lastLibrary = [...lastLibrary, s.id].slice(-12);
  return s;
}

/**
 * Next spot. `focus` (weak concepts from the user's history) biases the mix: preflop weakness → more chart
 * spots; postflop concept weakness → library spots tagged with those concepts.
 */
export async function nextSpot(mode: SessionMode, settings: Settings, focus: string[] = []): Promise<Spot> {
  const m: 'A' | 'B' = mode === 'mixed' ? (rng() < 0.5 ? 'A' : 'B') : mode;
  const r = rng();
  const preflopWeak = focus.includes('preflop-ranges');
  const postFocus = focus.filter((c) => c !== 'preflop-ranges' && c !== 'position');
  let spot: Spot;
  if (m === 'A') {
    const pRfi = preflopWeak ? 0.6 : 0.4;
    if (r < pRfi) spot = generateRfiSpot(rng, settings);
    else if (r < pRfi + 0.35) spot = await generateCheckedToSpot(rng, settings, (hero, combos, board) => computeEquity({ hero, board, villainCombos: combos }));
    else spot = pickLibrary('A', postFocus);
  }
  else if (r < (preflopWeak ? 0.45 : 0.3)) spot = generateVsOpenSpot(rng, settings);
  else if (r < (postFocus.length ? 0.55 : 0.7)) spot = await generateMathSpot(rng, settings, workerEquity);
  else spot = pickLibrary('B', postFocus);
  return finalizeSpot(spot);
}
