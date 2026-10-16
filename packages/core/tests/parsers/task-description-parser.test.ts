import { describe, it, expect } from 'vitest';
import { parse, getDisplayDescription, syncMetadataToDescription, stripListTarget, listTargetKey } from '../../src/parsers/task-description-parser.js';
import { Priority } from '../../src/types/priority.js';

/** Fixed date for deterministic due-date parsing */
const NOW = new Date(2026, 1, 8); // Feb 8 2026

describe('parse', () => {
  // --- Priority ---

  it.each([
    ['task\np1', Priority.High],
    ['task\np2', Priority.Medium],
    ['task\np3', Priority.Low],
    ['task\nP1', Priority.High], // case insensitive
  ])('extracts priority from "%s"', (input, expected) => {
    const result = parse(input, NOW);
    expect(result.priority).toBe(expected);
    expect(result.lastLineIsMetadataOnly).toBe(true);
  });

  it('returns null priority when no metadata line', () => {
    const result = parse('just a task');
    expect(result.priority).toBeNull();
    expect(result.lastLineIsMetadataOnly).toBe(false);
  });

  it('does not parse priority from mixed content', () => {
    const result = parse('task with p1 in text');
    expect(result.priority).toBeNull();
    expect(result.lastLineIsMetadataOnly).toBe(false);
  });

  // --- Tags ---

  it.each([
    ['#simple', 'simple'],
    ['#with-hyphen', 'with-hyphen'],
    ['#multi_underscore', 'multi_underscore'],
    ['#CamelCase', 'CamelCase'],
  ])('parses tag %s', (tag, expected) => {
    const result = parse(`task\n${tag}`, NOW);
    expect(result.tags).toContain(expected);
    expect(result.lastLineIsMetadataOnly).toBe(true);
  });

  it('extracts multiple tags', () => {
    const result = parse('task\n#tag1 #tag2 #cli-only', NOW);
    expect(result.tags).toHaveLength(3);
    expect(result.tags).toContain('tag1');
    expect(result.tags).toContain('tag2');
    expect(result.tags).toContain('cli-only');
  });

  // --- Due date ---

  it('parses @today', () => {
    const result = parse('task\n@today', NOW);
    expect(result.dueDate).toBe('2026-02-08');
    expect(result.dueDateRaw).toBe('today');
  });

  it('parses @tomorrow', () => {
    const result = parse('task\n@tomorrow', NOW);
    expect(result.dueDate).toBe('2026-02-09');
  });

  // --- Combined metadata ---

  it('extracts all combined metadata', () => {
    const result = parse('task\np1 @today #urgent #work', NOW);
    expect(result.priority).toBe(Priority.High);
    expect(result.dueDate).toBe('2026-02-08');
    expect(result.tags).toHaveLength(2);
    expect(result.tags).toContain('urgent');
    expect(result.tags).toContain('work');
    expect(result.lastLineIsMetadataOnly).toBe(true);
  });

  it('does not parse mixed content and metadata', () => {
    const result = parse('task\nsome text p1');
    expect(result.priority).toBeNull();
    expect(result.lastLineIsMetadataOnly).toBe(false);
  });

  // --- Empty input ---

  it('handles empty input', () => {
    const result = parse('');
    expect(result.priority).toBeNull();
    expect(result.dueDate).toBeNull();
    expect(result.tags).toHaveLength(0);
    expect(result.lastLineIsMetadataOnly).toBe(false);
  });

  // --- Parent reference ^tsk_abc00 ---

  it('extracts parent ID', () => {
    const result = parse('task\n^tsk_abc00', NOW);
    expect(result.parentId).toBe('tsk_abc00');
    expect(result.lastLineIsMetadataOnly).toBe(true);
  });

  it('does not parse parent from non-metadata line', () => {
    const result = parse('task with ^tsk_abc00 in text');
    expect(result.parentId).toBeNull();
    expect(result.lastLineIsMetadataOnly).toBe(false);
  });

  // --- Blocks reference !tsk_abc00 ---

  it('extracts single blocks ID', () => {
    const result = parse('task\n!tsk_h6700', NOW);
    expect(result.blocksIds).toEqual(['tsk_h6700']);
  });

  it('extracts multiple blocks IDs', () => {
    const result = parse('task\n!tsk_h6700 !tsk_j8900', NOW);
    expect(result.blocksIds).toHaveLength(2);
    expect(result.blocksIds).toContain('tsk_h6700');
    expect(result.blocksIds).toContain('tsk_j8900');
  });

  it('does not parse blocks from non-metadata line', () => {
    const result = parse('fix bug! important');
    expect(result.blocksIds).toBeNull();
    expect(result.lastLineIsMetadataOnly).toBe(false);
  });

  // --- Inverse parent -^tsk_abc00 ---

  it('extracts inverse parent (has subtask) IDs', () => {
    const result = parse('task\n-^tsk_abc00', NOW);
    expect(result.hasSubtaskIds).toEqual(['tsk_abc00']);
    expect(result.lastLineIsMetadataOnly).toBe(true);
  });

  it('extracts multiple inverse parent IDs', () => {
    const result = parse('task\n-^tsk_abc00 -^tsk_def00', NOW);
    expect(result.hasSubtaskIds).toHaveLength(2);
    expect(result.hasSubtaskIds).toContain('tsk_abc00');
    expect(result.hasSubtaskIds).toContain('tsk_def00');
  });

  it('does not confuse ^tsk_abc00 and -^tsk_abc00', () => {
    const result = parse('task\n^tsk_abc00 -^tsk_def00', NOW);
    expect(result.parentId).toBe('tsk_abc00');
    expect(result.hasSubtaskIds).toEqual(['tsk_def00']);
  });

  // --- Inverse blocker -!tsk_abc00 ---

  it('extracts inverse blocker (blocked by) IDs', () => {
    const result = parse('task\n-!tsk_abc00', NOW);
    expect(result.blockedByIds).toEqual(['tsk_abc00']);
    expect(result.lastLineIsMetadataOnly).toBe(true);
  });

  it('extracts multiple inverse blocker IDs', () => {
    const result = parse('task\n-!tsk_abc00 -!tsk_def00', NOW);
    expect(result.blockedByIds).toHaveLength(2);
    expect(result.blockedByIds).toContain('tsk_abc00');
    expect(result.blockedByIds).toContain('tsk_def00');
  });

  it('does not confuse !tsk_abc00 and -!tsk_abc00', () => {
    const result = parse('task\n!tsk_abc00 -!tsk_def00', NOW);
    expect(result.blocksIds).toEqual(['tsk_abc00']);
    expect(result.blockedByIds).toEqual(['tsk_def00']);
  });

  // --- Related ~tsk_abc00 ---

  it('extracts related IDs', () => {
    const result = parse('task\n~tsk_abc00', NOW);
    expect(result.relatedIds).toEqual(['tsk_abc00']);
    expect(result.lastLineIsMetadataOnly).toBe(true);
  });

  it('extracts multiple related IDs', () => {
    const result = parse('task\n~tsk_abc00 ~tsk_def00', NOW);
    expect(result.relatedIds).toHaveLength(2);
    expect(result.relatedIds).toContain('tsk_abc00');
    expect(result.relatedIds).toContain('tsk_def00');
  });

  // --- Combined dependencies + metadata ---

  it('extracts all marker types together', () => {
    const result = parse('build API\n^tsk_abc00 !tsk_ghi00 -^tsk_def00 -!tsk_jkl00 ~tsk_xyz00 p1 @today #tag', NOW);
    expect(result.parentId).toBe('tsk_abc00');
    expect(result.blocksIds).toEqual(['tsk_ghi00']);
    expect(result.hasSubtaskIds).toEqual(['tsk_def00']);
    expect(result.blockedByIds).toEqual(['tsk_jkl00']);
    expect(result.relatedIds).toEqual(['tsk_xyz00']);
    expect(result.priority).toBe(Priority.High);
    expect(result.dueDate).toBe('2026-02-08');
    expect(result.tags).toContain('tag');
    expect(result.lastLineIsMetadataOnly).toBe(true);
  });

  it('extracts mixed related and other metadata', () => {
    const result = parse('build API\n~tsk_abc00 !tsk_h6700 p1 #tag', NOW);
    expect(result.relatedIds).toEqual(['tsk_abc00']);
    expect(result.blocksIds).toEqual(['tsk_h6700']);
    expect(result.priority).toBe(Priority.High);
    expect(result.tags).toContain('tag');
  });

  it('extracts metadata split across multiple trailing lines', () => {
    const result = parse('build API\n\nnotes\n\n~tsk_abc00\n#tag', NOW);
    expect(result.relatedIds).toEqual(['tsk_abc00']);
    expect(result.tags).toEqual(['tag']);
    expect(result.lastLineIsMetadataOnly).toBe(true);
  });
});

describe('getDisplayDescription', () => {
  it('hides metadata-only last line', () => {
    expect(getDisplayDescription('My task\np1 #urgent')).toBe('My task');
  });

  it('keeps non-metadata lines', () => {
    expect(getDisplayDescription('My task\nsome details')).toBe('My task\nsome details');
  });

  it('shows single metadata-only line (otherwise task would be empty)', () => {
    expect(getDisplayDescription('p1 #urgent')).toBe('p1 #urgent');
  });

  it('hides dependency tokens', () => {
    expect(getDisplayDescription('My task\n^tsk_abc00 !tsk_h6700 p1')).toBe('My task');
  });

  it('hides inverse markers', () => {
    expect(getDisplayDescription('My task\n-^tsk_abc00 -!tsk_def00 p1')).toBe('My task');
  });

  it('hides related tokens', () => {
    expect(getDisplayDescription('My task\n~tsk_abc00 ~tsk_def00')).toBe('My task');
  });

  it('hides trailing metadata split across multiple lines', () => {
    expect(getDisplayDescription('My task\n\nhttps://example.com\n\n~tsk_abc00\n#movie')).toBe('My task\n\nhttps://example.com');
  });

  it('hides all marker types', () => {
    expect(getDisplayDescription('My task\n^tsk_abc00 !tsk_ghi00 -^tsk_def00 -!tsk_jkl00 ~tsk_xyz00 p1 #tag')).toBe('My task');
  });
});

describe('syncMetadataToDescription', () => {
  it('adds metadata line', () => {
    expect(syncMetadataToDescription('task', Priority.High, null, null)).toBe('task\np1');
  });

  it('updates existing metadata line', () => {
    expect(syncMetadataToDescription('task\np3', Priority.High, null, null)).toBe('task\np1');
  });

  it('removes metadata line when empty', () => {
    expect(syncMetadataToDescription('task\np1', null, null, null)).toBe('task');
  });

  it('includes parent and blocks', () => {
    expect(
      syncMetadataToDescription('task', Priority.High, null, null, 'tsk_abc00', ['tsk_h6700']),
    ).toBe('task\n^tsk_abc00 !tsk_h6700 p1');
  });

  it('updates existing dependency tokens', () => {
    expect(
      syncMetadataToDescription('task\n^tsk_abc00 p1', null, null, null, 'tsk_def00'),
    ).toBe('task\n^tsk_def00');
  });

  it('includes inverse markers', () => {
    expect(
      syncMetadataToDescription('task', null, null, null, null, null, ['tsk_abc00'], ['tsk_def00']),
    ).toBe('task\n-^tsk_abc00 -!tsk_def00');
  });

  it('preserves full marker order', () => {
    const result = syncMetadataToDescription(
      'task', Priority.High, '2026-02-08', ['tag'],
      'tsk_abc00', ['tsk_ghi00'], ['tsk_def00'], ['tsk_jkl00'], ['tsk_xyz00'],
    );
    expect(result).toBe('task\n^tsk_abc00 !tsk_ghi00 -^tsk_def00 -!tsk_jkl00 ~tsk_xyz00 p1 @2026-02-08 #tag');
  });

  it('preserves inverse markers on update', () => {
    const result = syncMetadataToDescription(
      'task\n-^tsk_abc00 -!tsk_def00 p1', Priority.Medium, null, null,
      null, null, ['tsk_abc00'], ['tsk_def00'],
    );
    expect(result).toBe('task\n-^tsk_abc00 -!tsk_def00 p2');
  });

  it('includes related IDs', () => {
    expect(
      syncMetadataToDescription('task', null, null, null, null, null, null, null, ['tsk_abc00', 'tsk_def00']),
    ).toBe('task\n~tsk_abc00 ~tsk_def00');
  });

  it('updates metadata split across multiple trailing lines', () => {
    expect(
      syncMetadataToDescription('task\n~tsk_abc00\n#movie', null, null, ['movie'], null, null, null, null, ['tsk_abc00', 'tsk_def00']),
    ).toBe('task\n~tsk_abc00 ~tsk_def00 #movie');
  });

  it('produces correct order for related + other metadata', () => {
    expect(
      syncMetadataToDescription('task', Priority.High, null, ['tag'], 'tsk_abc00', ['tsk_h6700'], null, null, ['tsk_xyz00']),
    ).toBe('task\n^tsk_abc00 !tsk_h6700 ~tsk_xyz00 p1 #tag');
  });

  it('deduplicates relationship IDs', () => {
    expect(
      syncMetadataToDescription('nice', null, null, ['tag'], null, null, null, ['tsk_01i00', 'tsk_01i00']),
    ).toBe('nice\n-!tsk_01i00 #tag');
  });

  it('deduplicates blocks and related IDs', () => {
    expect(
      syncMetadataToDescription('task', null, null, null, null, ['tsk_abc00', 'tsk_abc00'], ['tsk_def00', 'tsk_def00'], null, ['tsk_xyz00', 'tsk_xyz00']),
    ).toBe('task\n!tsk_abc00 -^tsk_def00 ~tsk_xyz00');
  });

  it('deduplicates tags', () => {
    expect(
      syncMetadataToDescription('task', null, null, ['foo', 'foo', 'bar']),
    ).toBe('task\n#foo #bar');
  });

  it('round-trips through parse and sync', () => {
    const original = 'build API\n^tsk_abc00 !tsk_ghi00 -^tsk_def00 -!tsk_jkl00 ~tsk_xyz00 p1 @2026-02-07 #tag';
    const parsed = parse(original, NOW);
    const synced = syncMetadataToDescription(
      'build API', parsed.priority, parsed.dueDate, parsed.tags,
      parsed.parentId, parsed.blocksIds,
      parsed.hasSubtaskIds, parsed.blockedByIds, parsed.relatedIds,
    );
    expect(synced).toBe(original);
  });
});

describe('>list target', () => {
  it('reads the last >list token from the metadata line', () => {
    const parsed = parse('Book\n#book >to-download p1 >work');
    expect(parsed.lastLineIsMetadataOnly).toBe(true);
    expect(parsed.listTarget).toBe('work');
    expect(parsed.tags).toEqual(['book']);
  });

  it('does not treat a Markdown quote as a list target', () => {
    const parsed = parse('Notes\n> a quoted line');
    expect(parsed.lastLineIsMetadataOnly).toBe(false);
    expect(parsed.listTarget).toBeNull();
  });

  it('strips the token and drops a line it leaves empty', () => {
    expect(stripListTarget('Book\n#book >work p1')).toBe('Book\n#book p1');
    expect(stripListTarget('Book\n>work')).toBe('Book');
    expect(stripListTarget('Body > not metadata')).toBe('Body > not metadata');
  });

  it('matches list names ignoring case, spaces, hyphens and underscores', () => {
    expect(listTargetKey('To Download')).toBe(listTargetKey('to_download'));
    expect(listTargetKey('finance books to download')).toBe('finance-books-to-download');
  });
});
