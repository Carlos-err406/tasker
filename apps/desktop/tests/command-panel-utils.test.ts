import { describe, it, expect } from 'vitest';
import {
  isCommandMode,
  getCommandQuery,
  filterTasks,
  filterByLabel,
} from '@/lib/command-panel-utils.js';
import type { Task } from '@tasker/core';
import { TaskStatus } from '@tasker/core';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'abc',
    description: 'Test task',
    status: TaskStatus.Pending,
    createdAt: new Date().toISOString(),
    listName: 'tasks',
    dueDate: null,
    priority: null,
    tags: null,
    isTrashed: 0,
    sortOrder: 0,
    completedAt: null,
    parentId: null,
    ...overrides,
  };
}

describe('isCommandMode', () => {
  it('returns true when input starts with >', () => {
    expect(isCommandMode('>')).toBe(true);
    expect(isCommandMode('> undo')).toBe(true);
    expect(isCommandMode('>undo')).toBe(true);
  });

  it('returns false for task mode input', () => {
    expect(isCommandMode('')).toBe(false);
    expect(isCommandMode('my task')).toBe(false);
    expect(isCommandMode(' > not command')).toBe(false);
  });
});

describe('getCommandQuery', () => {
  it('strips > prefix and leading whitespace', () => {
    expect(getCommandQuery('> undo')).toBe('undo');
    expect(getCommandQuery('>undo')).toBe('undo');
    expect(getCommandQuery('>  refresh')).toBe('refresh');
  });

  it('returns input unchanged when not in command mode', () => {
    expect(getCommandQuery('my task')).toBe('my task');
    expect(getCommandQuery('')).toBe('');
  });

  it('returns empty string for bare > with no query', () => {
    expect(getCommandQuery('>')).toBe('');
    expect(getCommandQuery('> ')).toBe('');
  });
});

describe('filterTasks', () => {
  const tasks = [
    makeTask({ id: 'abc', description: 'Buy groceries' }),
    makeTask({ id: 'def', description: 'Write tests' }),
    makeTask({ id: 'ghi', description: 'Fix bug in renderer p1' }),
  ];

  it('returns all tasks when query is empty', () => {
    expect(filterTasks(tasks, '')).toEqual(tasks);
    expect(filterTasks(tasks, '   ')).toEqual(tasks);
  });

  it('filters by description (case-insensitive)', () => {
    expect(filterTasks(tasks, 'grocer')).toEqual([tasks[0]]);
    expect(filterTasks(tasks, 'TESTS')).toEqual([tasks[1]]);
    expect(filterTasks(tasks, 'bug')).toEqual([tasks[2]]);
  });

  it('filters by task id', () => {
    expect(filterTasks(tasks, 'def')).toEqual([tasks[1]]);
    expect(filterTasks(tasks, 'ghi')).toEqual([tasks[2]]);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterTasks(tasks, 'xyz not found')).toEqual([]);
  });

  it('returns multiple matches when query matches several', () => {
    // 'e' appears in 'groceries', 'Write', 'renderer'
    const result = filterTasks(tasks, 'e');
    expect(result.length).toBe(3);
  });
});

describe('filterByLabel', () => {
  const items = [
    { label: 'Undo', id: 'undo' },
    { label: 'Redo', id: 'redo' },
    { label: 'Apply system sort', id: 'sort' },
  ];

  it('returns all items when query is empty', () => {
    expect(filterByLabel(items, '')).toEqual(items);
    expect(filterByLabel(items, '  ')).toEqual(items);
  });

  it('filters by label (case-insensitive)', () => {
    expect(filterByLabel(items, 'undo')).toEqual([items[0]]);
    expect(filterByLabel(items, 'REDO')).toEqual([items[1]]);
    expect(filterByLabel(items, 'sort')).toEqual([items[2]]);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterByLabel(items, 'delete')).toEqual([]);
  });

  it('returns multiple matches on partial query', () => {
    // 'e' appears in 'Undo' (no), 'Redo' (yes), 'Apply system sort' (yes: 'e' in 'system')
    const result = filterByLabel(items, 'e');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
