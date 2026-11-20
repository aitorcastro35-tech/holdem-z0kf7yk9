import { describe, it, expect } from 'vitest';
import { save, load, exportAll, importAll } from '../src/store/storage';

describe('export / import progress', () => {
  it('round-trips all stored keys (falls back to memory when localStorage is unavailable)', () => {
    save('settings', { tableSize: 6, theme: 'light' });
    save('progress', { answers: [{ id: 'x' }], activeDays: ['2026-11-19'] });
    const json = exportAll();
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe('holdem-trainer');
    save('settings', { tableSize: 9 });
    importAll(json);
    expect(load('settings', {} as Record<string, unknown>)).toMatchObject({ tableSize: 6, theme: 'light' });
    expect(load('progress', {} as Record<string, unknown>)).toMatchObject({ activeDays: ['2026-11-19'] });
  });
  it('rejects foreign files', () => {
    expect(() => importAll('{"foo":1}')).toThrow();
  });
});
