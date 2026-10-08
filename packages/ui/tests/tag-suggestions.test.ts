import { describe, expect, it } from 'vitest';
import type { Task } from '@tasker/core/types';
import { suggestTags } from '../src/hooks/use-metadata-autocomplete.js';

const tasks = [
  ['tasker', 'mobile'],
  ['tasker', 'desktop'],
  ['tasker'],
  ['data-usage'],
  ['personal'],
].map((tags) => ({ tags }) as unknown as Task);
const names = (partial: string, text = '') =>
  suggestTags(tasks, partial, text).map((s) => (s.kind === 'tag' ? s.tag : ''));

describe('suggestTags', () => {
  it('lists every existing tag by usage when only # is typed', () => {
    expect(names('')).toEqual(['tasker', 'data-usage', 'desktop', 'mobile', 'personal']);
  });

  it('ranks prefix matches before substring matches, case-insensitively', () => {
    expect(names('S')).toEqual(['tasker', 'data-usage', 'desktop', 'personal']);
    expect(names('s').slice(0, 1)).toEqual(['tasker']);
    expect(names('da')).toEqual(['data-usage']);
  });

  it('skips tags the task already has but keeps the one being typed', () => {
    expect(names('', 'fix it\n#tasker #mobile')).toEqual(['data-usage', 'desktop', 'personal']);
    expect(names('tasker', 'fix it\n#tasker')).toEqual(['tasker']);
  });

  it('reports how many tasks use each tag', () => {
    expect(suggestTags(tasks, 'tas', '')[0]).toEqual({ kind: 'tag', tag: 'tasker', count: 3 });
  });
});
