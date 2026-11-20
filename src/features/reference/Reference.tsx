import { HandRankings } from './HandRankings';
import { PreflopGrid } from './PreflopGrid';
import { OddsTables } from './OddsTables';
import { Concepts } from './Concepts';
import { Tools } from './Tools';
import { Matchups } from './Matchups';
import { Chip } from '../../components/ui';
import { go } from '../../router';

const TABS = [
  ['grid', 'Preflop charts'],
  ['rankings', 'Hand rankings'],
  ['odds', 'Odds tables'],
  ['matchups', 'Matchups'],
  ['concepts', 'Concepts'],
  ['tools', 'Calculators'],
] as const;

export function Reference({ tab, focus }: { tab?: string; focus?: string }) {
  const t = TABS.some(([k]) => k === tab) ? tab! : 'grid';
  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {TABS.map(([k, label]) => (
          <Chip key={k} active={t === k} onClick={() => go(`reference/${k}`)} className="shrink-0">
            {label}
          </Chip>
        ))}
      </div>
      {t === 'grid' && <PreflopGrid />}
      {t === 'rankings' && <HandRankings />}
      {t === 'odds' && <OddsTables />}
      {t === 'matchups' && <Matchups />}
      {t === 'concepts' && <Concepts focus={focus} />}
      {t === 'tools' && <Tools />}
    </div>
  );
}
