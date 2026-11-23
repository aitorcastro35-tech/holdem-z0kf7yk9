// Published push/fold ranges used as Range Explorer presets and as a cross-check (tests/explorer.test.ts).
// Source: Poker Skill, "Push fold charts" (https://www.pokerskill.com/charts/push-fold/, updated 2026-11-20), which
// states its 5bb/10bb shove charts and the calling chart reproduce the no-ICM charts in "Poker Satellite Strategy"
// (Dara O'Kearney & Barry Carter). Conditions: 9-handed, no antes, chip EV (no ICM), folded to the shover.
// Ranges copied verbatim except the shorthand "Ax" / "Qx+", expanded to standard notation (see notes).
export interface PushFoldRef {
  label: string;
  range: string;
  verbatim: string;
  source: string;
  note?: string;
}

const SRC = "Poker Skill push/fold charts (reproducing O'Kearney & Carter, Poker Satellite Strategy, no-ICM)";

export const PUSH_FOLD_REFS: PushFoldRef[] = [
  {
    label: '10bb UTG shove (9-handed)',
    range: '22+, A4s+, ATo+, K9s+, KJo+, Q9s+, J9s+, T8s+, 98s',
    verbatim: '22+, A4s+, ATo+, K9s+, KJo+, Q9s+, J9s+, T8s+, 98s',
    source: SRC,
  },
  {
    label: '10bb BB call vs a UTG shove (9-handed)',
    range: '33+, A2s+, A7o+, KTs+, KJo+, QTs+, JTs',
    verbatim: '33+, A2s+, A7o+, KTs+, KJo+, QTs+, JTs',
    source: SRC,
  },
  {
    label: '10bb button shove (9-handed)',
    range: '22+, A2s+, A2o+, K2s+, K5o+, Q5s+, Q9o+, J7s+, J9o+, T6s+, T9o, 96s+, 86s+, 75s+, 65s, 54s',
    verbatim: '22+, Ax, K2s+, K5o+, Q5s+, Q9o+, J7s+, J9o+, T6s+, T9o, 96s+, 86s+, 75s+, 65s, 54s',
    source: SRC,
    note: '"Ax" (every hand with an ace as its top card) expanded to A2s+, A2o+ (AA is in 22+).',
  },
  {
    label: '10bb small-blind shove (9-handed, folded to SB)',
    range: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q2o+, J2s+, J5o+, T2s+, T7o+, 95s+, 97o+, 84s+, 86o+, 74s+, 76o, 63s+, 53s+, 43s',
    verbatim: '22+, Qx+, J2s+, J5o+, T2s+, T7o+, 95s+, 97o+, 84s+, 86o+, 74s+, 76o, 63s+, 53s+, 43s',
    source: SRC,
    note: '"Qx+" (every hand whose top card is a queen or higher) expanded to A2+, K2+, Q2+ suited and offsuit.',
  },
];
