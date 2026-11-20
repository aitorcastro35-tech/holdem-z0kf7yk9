// Generates src/data/matchups.json: classic preflop all-in matchups, exact (all 1,712,304 boards).
// Run: npx tsx scripts/gen-matchups.ts   (tests/matchups.test.ts checks the file equals the engine)
import { writeFileSync } from 'node:fs';
import { parseCards } from '../src/engine/cards';
import { equityVsHand } from '../src/engine/equity';

const MATCHUPS: { group: string; a: string; b: string; note: string }[] = [
  { group: 'Pair vs pair', a: 'Ah As', b: 'Kd Kc', note: 'Overpair vs underpair: about 4 to 1.' },
  { group: 'Pair vs pair', a: 'Jh Js', b: '6d 6c', note: 'Same shape with smaller pairs.' },
  { group: 'Pair vs pair', a: '8h 8s', b: '2d 2c', note: 'The underpair needs a set (or a straight/flush).' },
  { group: 'Pair vs overcards (race)', a: 'Qh Qs', b: 'Ad Kc', note: 'The classic "coin flip" — slightly better than a flip for the pair.' },
  { group: 'Pair vs overcards (race)', a: 'Qh Qs', b: 'Ad Kd', note: 'Suitedness adds about 3 points to AK.' },
  { group: 'Pair vs overcards (race)', a: '2h 2s', b: 'Ad Kc', note: 'Even deuces are a small favourite vs AKo.' },
  { group: 'Pair vs overcards (race)', a: '7h 7s', b: 'Ad Qc', note: 'Mid pair vs two overcards.' },
  { group: 'Pair vs one overcard', a: 'Th Ts', b: 'Ad 5c', note: 'One overcard: the pair is about 70%.' },
  { group: 'Pair vs undercards', a: 'Th Ts', b: '9d 8d', note: 'Suited connectors vs an overpair.' },
  { group: 'Pair vs undercards', a: 'Ah As', b: '7d 6d', note: 'Even AA is "only" ~77% vs suited connectors.' },
  { group: 'Pair vs undercards', a: '9h 9s', b: '8d 7d', note: '' },
  { group: 'Pair vs one card', a: 'Kh Ks', b: 'Ad Kc', note: 'The pair dominates: AK needs an ace.' },
  { group: 'Pair vs one card', a: 'Ah As', b: 'Ad Kc', note: 'AK wins only about 7%: pairing the king never helps, it needs a straight or a flush.' },
  { group: 'Domination', a: 'Ah Kc', b: 'Ad Qc', note: 'Shared ace, better kicker: about 3 to 1 (many ties).' },
  { group: 'Domination', a: 'Ah Kc', b: 'Kd Qc', note: 'Shared king.' },
  { group: 'Domination', a: 'Ah Jc', b: 'Ad 7c', note: '' },
  { group: 'Two overcards vs two undercards', a: 'Ah Kc', b: '8d 7d', note: 'Big cards vs suited connectors: ~58/42.' },
  { group: 'Two overcards vs two undercards', a: 'Ah Kc', b: '3d 2c', note: '' },
  { group: 'Two overcards vs two undercards', a: 'Kh Qc', b: '9d 7c', note: '' },
  { group: 'Overlapping / mixed', a: 'Ah Jc', b: 'Kd Qd', note: 'One high card each — closer than it looks.' },
  { group: 'Overlapping / mixed', a: 'Ah 5h', b: 'Kd Qc', note: 'Ace-rag suited vs KQ offsuit.' },
  { group: 'Overlapping / mixed', a: 'Jh Th', b: 'Ad Kc', note: 'Suited connectors vs AK.' },
  { group: 'Premium vs trash', a: 'Ah As', b: '7d 2c', note: 'The "worst hand" still wins 12%.' },
  { group: 'Premium vs trash', a: 'Ah Kc', b: '3d 2c', note: '' },
];

const out = MATCHUPS.map((m) => {
  const r = equityVsHand(parseCards(m.a), parseCards(m.b));
  const f = (x: number) => Math.round(x * 1e6) / 1e6;
  return { ...m, win: f(r.win), tie: f(r.tie), lose: f(r.lose), boards: r.samples };
});
writeFileSync(new URL('../src/data/matchups.json', import.meta.url), JSON.stringify({ method: 'Exact: every one of the 1,712,304 boards enumerated with this app\'s evaluator (scripts/gen-matchups.ts).', matchups: out }, null, 1) + '\n');
console.log('wrote', out.length);
