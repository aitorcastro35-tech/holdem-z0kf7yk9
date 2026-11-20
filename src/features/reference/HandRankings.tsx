import { parseCards, choose } from '../../engine/cards';
import { evaluate, describe as describeHand, CATEGORY_NAMES } from '../../engine/evaluator';
import { fiveCardCountsClosedForm, SEVEN_CARD_COUNTS } from '../../engine/probabilities';
import { Panel, KindBadge, SourceLink, Cards, CardText, pct } from '../../components/ui';

const EXAMPLES: [string, string][] = [
  ['Royal flush', 'As Ks Qs Js Ts'],
  ['Straight flush', '9h 8h 7h 6h 5h'],
  ['Four of a kind', 'Qc Qd Qh Qs 7c'],
  ['Full house', 'Kc Kd Kh 4s 4c'],
  ['Flush', 'Ad Jd 8d 6d 2d'],
  ['Straight', 'Ts 9h 8d 7c 6s'],
  ['Three of a kind', '7s 7d 7h Kc 2s'],
  ['Two pair', 'Js Jd 4h 4c As'],
  ['One pair', 'Ts Td 8h 4c 2s'],
  ['High card', 'As Qd 9h 6c 3s'],
];

/** Row order top→bottom: royal, SF(excl royal), quads ... high card. */
function rows() {
  const five = fiveCardCountsClosedForm();
  const t5 = choose(52, 5);
  const t7 = choose(52, 7);
  const seven = SEVEN_CARD_COUNTS;
  const out = [
    { name: 'Royal flush', c5: five[9], c7: seven[9] },
    { name: 'Straight flush', c5: five[8] - five[9], c7: seven[8] - seven[9] },
  ];
  for (let cat = 7; cat >= 0; cat--) out.push({ name: CATEGORY_NAMES[cat], c5: five[cat], c7: seven[cat] });
  return out.map((r) => ({ ...r, p5: r.c5 / t5, p7: r.c7 / t7, ex: parseCards(EXAMPLES.find((e) => e[0] === r.name)![1]) }));
}

function Showdown({ title, board, a, b, note }: { title: string; board: string; a: string; b: string; note: string }) {
  const bd = parseCards(board);
  const ha = parseCards(a);
  const hb = parseCards(b);
  const sa = evaluate([...ha, ...bd]);
  const sb = evaluate([...hb, ...bd]);
  const res = sa > sb ? 'Player 1 wins' : sb > sa ? 'Player 2 wins' : 'Split pot';
  return (
    <div className="rounded-xl bg-surface-2 p-3 text-sm">
      <div className="font-semibold">{title}</div>
      <div className="mt-1">
        Board <CardText cards={bd} />
      </div>
      <div>
        P1 <CardText cards={ha} /> → {describeHand(sa)}
      </div>
      <div>
        P2 <CardText cards={hb} /> → {describeHand(sb)}
      </div>
      <div className="mt-1 font-semibold text-accent">{res}</div>
      <div className="mt-1 text-xs text-muted">{note}</div>
    </div>
  );
}

export function HandRankings() {
  const data = rows();
  return (
    <div className="space-y-3">
      <Panel
        title={
          <span className="flex items-center gap-2">
            Hand rankings <KindBadge kind="math" />
          </span>
        }
        right={<SourceLink ids={['wiki-prob', 'wiki-hands', 'engine']} extra="5-card counts computed by closed-form combinatorics; 7-card counts by exhaustive enumeration of all 133,784,560 hands in the test suite. Both match Wikipedia." />}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase text-muted">
              <tr>
                <th className="py-1 pr-2">Hand</th>
                <th className="py-1 pr-2">Example</th>
                <th className="py-1 pr-2 text-right">5-card combos</th>
                <th className="py-1 pr-2 text-right">P (5 cards)</th>
                <th className="py-1 text-right">P (best of 7)</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.name} className="border-t border-line">
                  <td className="py-2 pr-2 font-semibold">{r.name}</td>
                  <td className="py-2 pr-2">
                    <span className="sm:hidden">
                      <CardText cards={r.ex} />
                    </span>
                    <span className="hidden sm:block">
                      <Cards cards={r.ex} size="sm" />
                    </span>
                  </td>
                  <td className="tabular py-2 pr-2 text-right">{r.c5.toLocaleString('en-US')}</td>
                  <td className="tabular py-2 pr-2 text-right">{pct(r.p5, r.p5 < 0.001 ? 5 : 3)}</td>
                  <td className="tabular py-2 text-right">{pct(r.p7, r.p7 < 0.001 ? 4 : 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          "P (best of 7)" is the chance your best five out of seven cards (2 hole + 5 board) is that hand — relevant for hold'em. Straight flush row excludes royal flushes;
          flush and straight rows exclude straight flushes.
        </p>
      </Panel>

      <Panel title="Tie-breakers & kickers">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Only your best <b>five</b> cards count. A sixth or seventh card never breaks a tie.</li>
          <li>Same category → compare the ranks that make the hand first (e.g. the pair), then the kickers in order.</li>
          <li>Suits never break ties in hold'em.</li>
          <li>Full houses compare the three-of-a-kind first, then the pair. Flushes compare all five cards from the top.</li>
          <li>A-2-3-4-5 (the "wheel") is a straight: the ace plays low, and it is the lowest straight. Straights don't wrap around (Q-K-A-2-3 is not a straight).</li>
        </ul>
      </Panel>

      <Panel title="Common confusions (evaluated live by the engine)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Showdown title="The board plays" board="Ts 9h 8d 7c 6s" a="Ah Kd" b="2c 3d" note="Neither player can beat the straight on the board, so the pot is split." />
          <Showdown title="Kicker decides" board="Ah 9c 7d 4s 2h" a="As Kc" b="Ad Qs" note="Both have a pair of aces; the king kicker beats the queen." />
          <Showdown title="Counterfeited two pair" board="8s 8d 5h 5c Kd" a="7c 6c" b="Ah 2h" note="P1's 7-6 doesn't play: both have eights and fives; P2's ace kicker wins." />
          <Showdown title="Kicker beyond five cards" board="Ks Kd Qh Qc Js" a="2c 3d" b="3c 4d" note="Both play K-K-Q-Q-J from the board: split." />
          <Showdown title="Wheel vs six-high straight" board="As 2d 3h 4c 9s" a="5d Kc" b="5h 6h" note="A-2-3-4-5 is the lowest straight; 2-3-4-5-6 beats it." />
          <Showdown title="Flush vs higher flush" board="Kh 9h 6h 2c 3d" a="Qh 4h" b="Ah 5h" note="Compare the highest flush card: ace-high flush wins." />
        </div>
      </Panel>
    </div>
  );
}
