import { describe, it, expect } from 'vitest';
import { findLeaks } from '../src/features/progress/leaks';
import { weakConcepts, type AnswerRecord } from '../src/store/progress';

const rec = (o: Partial<AnswerRecord>): AnswerRecord => ({ t: 0, kind: 'hand', id: 'x', concepts: [], tags: [], grade: 'best', ...o });

describe('leak finder', () => {
  it('flags folding too much to half-pot river bets', () => {
    const rs = [
      ...Array.from({ length: 4 }, () => rec({ street: 'river', tags: ['river', '½-pot', 'best-call', 'chose-fold'], grade: 'mistake' })),
      ...Array.from({ length: 2 }, () => rec({ street: 'river', tags: ['river', '½-pot', 'best-call', 'chose-call'] })),
    ];
    const leaks = findLeaks(rs);
    expect(leaks[0].id).toBe('overfold-river-½-pot');
    expect(leaks[0].message).toContain('½ pot river');
    expect(leaks.find((l) => l.id === 'overfold-river')).toBeUndefined(); // general one suppressed
  });
  it('flags over-calling out of position with offsuit broadways', () => {
    const rs = Array.from({ length: 5 }, (_, i) => rec({ tags: ['oop', 'offsuit-broadway', 'best-fold', i < 3 ? 'chose-call' : 'chose-fold'], grade: i < 3 ? 'mistake' : 'best' }));
    expect(findLeaks(rs).map((l) => l.id)).toContain('overcall-oop-offsuit-broadway');
  });
  it('needs a minimum sample', () => {
    const rs = Array.from({ length: 3 }, () => rec({ street: 'river', tags: ['best-call', 'chose-fold'], grade: 'mistake' }));
    expect(findLeaks(rs)).toEqual([]);
  });
  it('weak concepts ordered by accuracy', () => {
    const rs = [
      ...Array.from({ length: 4 }, () => rec({ concepts: ['mdf'], grade: 'mistake' })),
      ...Array.from({ length: 4 }, () => rec({ concepts: ['outs'], grade: 'best' })),
      ...Array.from({ length: 4 }, (_, i) => rec({ concepts: ['pot-odds'], grade: i < 2 ? 'mistake' : 'best' })),
    ];
    expect(weakConcepts(rs)).toEqual(['mdf', 'pot-odds']);
  });
});
