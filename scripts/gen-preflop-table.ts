// Generates src/data/preflopTable.json: exact equity for all 47,008 distinct heads-up preflop matchups.
// Usage (parallel):  npx tsx scripts/gen-preflop-table.ts shard 0 8   (… shards 0..7), then
//                    npx tsx scripts/gen-preflop-table.ts merge 8
// Each shard enumerates all 1,712,304 boards per matchup with the app's evaluator (~0.2 s per matchup).
import { writeFileSync, readFileSync } from 'node:fs';
import { allCanonicalKeys, decodeKey, BOARDS } from '../src/engine/preflopTable';
import { equityVsHand } from '../src/engine/equity';

const [mode, a, b] = process.argv.slice(2);
const dir = new URL('../scripts/.preflop-shards/', import.meta.url);

if (mode === 'shard') {
  const shard = +a;
  const n = +b;
  const keys = allCanonicalKeys().filter((_, i) => i % n === shard);
  const out: [number, number][] = [];
  let i = 0;
  for (const key of keys) {
    const [h1, h2, v1, v2] = decodeKey(key);
    const r = equityVsHand([h1, h2], [v1, v2], []);
    const twoWplusT = Math.round((2 * r.win + r.tie) * BOARDS);
    out.push([key, twoWplusT]);
    if (++i % 500 === 0) process.stdout.write(`shard ${shard}: ${i}/${keys.length}\n`);
  }
  writeFileSync(new URL(`shard-${shard}.json`, dir), JSON.stringify(out));
  process.stdout.write(`shard ${shard} done (${keys.length})\n`);
} else if (mode === 'merge') {
  const n = +a;
  const all: [number, number][] = [];
  for (let s = 0; s < n; s++) all.push(...JSON.parse(readFileSync(new URL(`shard-${s}.json`, dir), 'utf8')));
  all.sort((x, y) => x[0] - y[0]);
  const k: number[] = [];
  const v: number[] = [];
  let prev = 0;
  for (const [key, val] of all) {
    k.push(key - prev);
    v.push(val);
    prev = key;
  }
  writeFileSync(
    new URL('../src/data/preflopTable.json', import.meta.url),
    JSON.stringify({ method: 'Exact enumeration of all 1,712,304 boards for each of the 47,008 suit-distinct heads-up matchups (scripts/gen-preflop-table.ts). v = 2·wins + ties for the first seat.', boards: BOARDS, count: all.length, k, v }),
  );
  console.log('merged', all.length);
}
