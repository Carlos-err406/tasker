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
  const T = '2026-01-01T00:00:00.000Z';
  const tasks = [
    makeTask({ id: 'abc', description: 'Buy groceries', createdAt: T }),
    makeTask({ id: 'def', description: 'Write tests', createdAt: T }),
    makeTask({ id: 'ghi', description: 'Fix bug in renderer p1', createdAt: T }),
  ];

  it('returns all tasks when query is empty (system sort: status/priority/due)', () => {
    // All Pending, no priority, no due date — all keys equal, stable sort preserves input order
    const sorted = [tasks[0], tasks[1], tasks[2]];
    expect(filterTasks(tasks, '')).toEqual(sorted);
    expect(filterTasks(tasks, '   ')).toEqual(sorted);
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

  it('multi-word: all words must appear (AND semantics)', () => {
    expect(filterTasks(tasks, 'fix bug')).toEqual([tasks[2]]);
    expect(filterTasks(tasks, 'bug renderer')).toEqual([tasks[2]]);
    expect(filterTasks(tasks, 'fix tests')).toEqual([]);
  });

  it('multi-word: order does not matter', () => {
    expect(filterTasks(tasks, 'renderer fix')).toEqual([tasks[2]]);
    expect(filterTasks(tasks, 'groceries buy')).toEqual([tasks[0]]);
  });

  it('multi-word: extra spaces are ignored', () => {
    expect(filterTasks(tasks, '  fix   bug  ')).toEqual([tasks[2]]);
  });
});

describe('filterTasks — filter syntax', () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const T = '2026-01-01T00:00:00.000Z';
  const taskA = makeTask({ id: 'aaa', description: 'Buy milk', tags: ['shopping', 'food'], listName: 'tasks', createdAt: T });
  const taskB = makeTask({ id: 'bbb', description: 'Read book', tags: ['learning'], listName: 'tasks', status: TaskStatus.Done, completedAt: T, createdAt: T });
  const taskC = makeTask({ id: 'ccc', description: 'Fix bug', tags: null, listName: 'work', dueDate: todayStr, createdAt: T });
  const taskD = makeTask({ id: 'ddd', description: 'Subtask', parentId: 'aaa', listName: 'tasks', createdAt: T });
  const tasks = [taskA, taskB, taskC, taskD];

  it('tag: filters by tag', () => {
    expect(filterTasks(tasks, 'tag:shopping')).toEqual([taskA]);
    expect(filterTasks(tasks, 'tag:learning')).toEqual([taskB]);
    expect(filterTasks(tasks, 'tag:nonexistent')).toEqual([]);
  });

  it('tag: is case-insensitive', () => {
    expect(filterTasks(tasks, 'tag:Shopping')).toEqual([taskA]);
  });

  it('has:tags filters tasks with any tags', () => {
    expect(filterTasks(tasks, 'has:tags')).toEqual([taskA, taskB]);
  });

  it('has:tags negation filters tasks without tags', () => {
    // taskC has dueDate=today (urgency 0) → sorts before taskD (no due date)
    expect(filterTasks(tasks, 'has:!tags')).toEqual([taskC, taskD]);
  });

  it('status: filters by status', () => {
    expect(filterTasks(tasks, 'status:done')).toEqual([taskB]);
    // taskC has dueDate=today → most urgent, sorts first; taskA and taskD have no due date (stable order)
    expect(filterTasks(tasks, 'status:pending')).toEqual([taskC, taskA, taskD]);
  });

  it('list: filters by list name', () => {
    expect(filterTasks(tasks, 'list:work')).toEqual([taskC]);
    // taskA and taskD are Pending (active), taskB is Done → active sorts before done
    expect(filterTasks(tasks, 'list:tasks')).toEqual([taskA, taskD, taskB]);
  });

  it('has:due filters tasks with a due date', () => {
    expect(filterTasks(tasks, 'has:due')).toEqual([taskC]);
  });

  it('has:parent filters subtasks', () => {
    expect(filterTasks(tasks, 'has:parent')).toEqual([taskD]);
  });

  it('has:subtasks filters tasks that have subtasks', () => {
    expect(filterTasks(tasks, 'has:subtasks')).toEqual([taskA]);
  });

  it('id: filters by id prefix', () => {
    expect(filterTasks(tasks, 'id:aaa')).toEqual([taskA]);
    expect(filterTasks(tasks, 'id:bb')).toEqual([taskB]);
  });

  it('due:today filters tasks due today', () => {
    expect(filterTasks(tasks, 'due:today')).toEqual([taskC]);
  });

  it('due:overdue filters overdue tasks', () => {
    const overdueTask = makeTask({ id: 'eee', description: 'Overdue task', dueDate: yesterdayStr });
    expect(filterTasks([...tasks, overdueTask], 'due:overdue')).toEqual([overdueTask]);
  });

  it('combines text and filter tokens', () => {
    expect(filterTasks(tasks, 'bug list:work')).toEqual([taskC]);
    // tag:shopping + text "milk" → taskA (description is "Buy milk", has tag shopping)
    expect(filterTasks(tasks, 'tag:shopping milk')).toEqual([taskA]);
    // tag:shopping + text "book" → no match (taskA has tag but not "book" in description)
    expect(filterTasks(tasks, 'tag:shopping book')).toEqual([]);
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

  it('multi-word: all words must appear', () => {
    expect(filterByLabel(items, 'system sort')).toEqual([items[2]]);
    expect(filterByLabel(items, 'apply sort')).toEqual([items[2]]);
    expect(filterByLabel(items, 'undo sort')).toEqual([]);
  });

  it('multi-word: order does not matter', () => {
    expect(filterByLabel(items, 'sort system')).toEqual([items[2]]);
  });
});
