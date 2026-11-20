// Prints engine numbers for each library spot; with --write, stores them as "claims" in the JSON.
import { readFileSync, writeFileSync } from 'node:fs';
import { LIBRARY_RAW, toSpot } from '../src/scenarios/library';
import { spotEquity, staticNumbers, gradeByEquity, isStrongDraw } from '../src/scenarios/compute';
import { features } from '../src/engine/handclass';

const write = process.argv.includes('--write');
const path = new URL('../src/data/scenarios/library.json', import.meta.url);
const json = JSON.parse(readFileSync(path, 'utf8'));
for (const ls of LIBRARY_RAW) {
  const s = toSpot(ls);
  const n = staticNumbers(s);
  const eq = spotEquity(s);
  const claims: Record<string, number> = {};
  if (eq) claims.equity = +eq.equity.toFixed(4);
  if (n.requiredEquity !== undefined) claims.required = +n.requiredEquity.toFixed(4);
  if (n.outs) claims.outs = n.outs.all.length;
  if (n.villainCombos !== undefined) claims.villainCombos = +n.villainCombos.toFixed(2);
  let verdict = '';
  if (ls.basis === 'equity' && eq && n.requiredEquity !== undefined) {
    const f = s.board.length ? features(s.hero, s.board) : null;
    verdict = gradeByEquity(eq.equity, n.requiredEquity, { options: s.options, strongDraw: !!f && isStrongDraw(f, s.board), street: s.street, noValueRaise: s.noValueRaise }).best;
  }
  console.log(ls.id.padEnd(34), 'eq', claims.equity ?? '-', eq ? (eq.exact ? 'exact' : 'MC') : '', 'req', claims.required ?? '-', 'outs', claims.outs ?? '-', 'combos', claims.villainCombos ?? '-', verdict ? '→ ' + verdict : ls.best ? 'best ' + ls.best : '');
  const target = json.spots.find((x: { id: string }) => x.id === ls.id);
  target.claims = claims;
}
if (write) writeFileSync(path, JSON.stringify(json, null, 1) + '\n');
