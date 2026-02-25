import { describe, it, expect } from 'vitest';
import { sampleRandom } from '../../src/utils/sample-random.js';

describe('sampleRandom', () => {
  it('returns the full array when n >= length', () => {
    const arr = [1, 2, 3];
    expect(sampleRandom(arr, 3)).toEqual([1, 2, 3]);
    expect(sampleRandom(arr, 5)).toEqual([1, 2, 3]);
  });

  it('returns exactly n items when n < length', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = sampleRandom(arr, 4);
    expect(result).toHaveLength(4);
  });

  it('returns items that are all from the original array', () => {
    const arr = ['a', 'b', 'c', 'd', 'e'];
    const result = sampleRandom(arr, 3);
    for (const item of result) {
      expect(arr).toContain(item);
    }
  });

  it('returns no duplicates', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = sampleRandom(arr, 5);
    expect(new Set(result).size).toBe(5);
  });

  it('does not mutate the original array', () => {
    const arr = [1, 2, 3, 4, 5];
    const copy = [...arr];
    sampleRandom(arr, 3);
    expect(arr).toEqual(copy);
  });

  it('handles empty array', () => {
    expect(sampleRandom([], 5)).toEqual([]);
  });

  it('handles n = 0', () => {
    expect(sampleRandom([1, 2, 3], 0)).toEqual([]);
  });

  it('handles n = 1', () => {
    const arr = [10, 20, 30];
    const result = sampleRandom(arr, 1);
    expect(result).toHaveLength(1);
    expect(arr).toContain(result[0]);
  });
});
