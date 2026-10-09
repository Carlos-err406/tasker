import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTime, formatTime, parseRepeat, nextOccurrence } from '../../src/parsers/recurrence.js';
import { parse, syncMetadataToDescription, getDisplayDescription } from '../../src/parsers/task-description-parser.js';
import { createTestDb } from '../../src/db-node.js';
import { UndoManager } from '../../src/undo/index.js';
import { createRegistry } from '../../src/operations/registry.js';

const NOW = new Date(2026, 9, 9); // Fri Oct 9 2026

describe('times', () => {
  it.each([
    ['6:30pm', '18:30'],
    ['9am', '09:00'],
    ['9AM', '09:00'],
    ['12pm', '12:00'],
    ['12:15am', '00:15'],
    ['18:30', '18:30'],
    ['7:05', '07:05'],
  ])('parses %s as %s', (token, expected) => expect(parseTime(token)).toBe(expected));

  it.each(['13pm', '9:60am', '0am', '24:00', '930', 'noon'])('rejects %s', (token) => expect(parseTime(token)).toBeNull());

  it.each([
    ['18:30', '6:30pm'],
    ['09:00', '9am'],
    ['12:00', '12pm'],
    ['00:15', '12:15am'],
  ])('formats %s as %s', (time, expected) => expect(formatTime(time)).toBe(expected));
});

describe('repeat rules', () => {
  it.each([
    ['daily', { every: 1, unit: 'd' }],
    ['weekly', { every: 1, unit: 'w' }],
    ['monthly', { every: 1, unit: 'm' }],
    ['yearly', { every: 12, unit: 'm' }],
    ['3d', { every: 3, unit: 'd' }],
    ['2W', { every: 2, unit: 'w' }],
  ])('parses *%s', (token, expected) => expect(parseRepeat(token)).toEqual(expected));

  it.each(['0d', 'weekdays', '2y', '1000d'])('rejects *%s', (token) => expect(parseRepeat(token)).toBeNull());

  it.each([
    // [due, repeat, today, next]
    ['2026-10-10', 'weekly', '2026-10-09', '2026-10-17'], // completed early
    ['2026-10-10', 'weekly', '2026-10-10', '2026-10-17'], // completed on the day
    ['2026-09-19', 'weekly', '2026-10-09', '2026-10-10'], // three weeks late: next upcoming Saturday
    ['2026-10-09', '3d', '2026-10-09', '2026-10-12'],
    ['2026-01-31', 'monthly', '2026-01-31', '2026-02-28'], // clamps to month end
    ['2026-02-28', 'monthly', '2026-02-28', '2026-03-28'], // the clamped day sticks
    ['2028-02-29', 'yearly', '2028-02-29', '2029-02-28'],
    ['2026-10-31', '2m', '2026-10-31', '2026-12-31'],
  ])('%s *%s completed %s next falls on %s', (due, repeat, today, next) =>
    expect(nextOccurrence(due, parseRepeat(repeat)!, today)).toBe(next));
});

describe('metadata line', () => {
  it('reads a time directly after the due date and a repeat rule', () => {
    const result = parse('Watch Frieren\n@sat 6:30pm *weekly #anime', NOW);
    expect(result).toMatchObject({ dueDate: '2026-10-10', dueTime: '18:30', repeatRaw: 'weekly', tags: ['anime'] });
    expect(result.repeat).toEqual({ every: 1, unit: 'w' });
    expect(getDisplayDescription('Watch Frieren\n@sat 6:30pm *weekly #anime')).toBe('Watch Frieren');
  });

  it('accepts 24-hour input', () => {
    expect(parse('Gym\n@mon 18:30', NOW).dueTime).toBe('18:30');
  });

  it('treats a time that does not follow the due date as text', () => {
    expect(parse('Meet\n6pm', NOW)).toMatchObject({ lastLineIsMetadataOnly: false, dueTime: null });
    expect(parse('Meet\n#work 6pm @sat', NOW)).toMatchObject({ lastLineIsMetadataOnly: false });
    expect(parse('Meet\n@sat 13pm', NOW).lastLineIsMetadataOnly).toBe(false);
  });

  it('keeps a repeat rule without a due date as inert metadata', () => {
    expect(parse('Water plants\n*3d', NOW)).toMatchObject({ lastLineIsMetadataOnly: true, dueDate: null, repeatRaw: '3d' });
  });

  it('does not mistake a markdown bullet for a repeat rule', () => {
    expect(parse('List\n* weekly', NOW).repeat).toBeNull();
  });

  it('keeps the time and repeat when rebuilding the metadata line', () => {
    const synced = syncMetadataToDescription('Watch\n@sat 6:30pm *weekly #anime', null, '2026-10-17', ['anime'], 'abc');
    expect(synced).toBe('Watch\n^abc @2026-10-17 6:30pm *weekly #anime');
    expect(syncMetadataToDescription('Watch\n@sat 6pm *weekly', null, null, null)).toBe('Watch\n*weekly');
  });
});

describe('rolling a repeating task forward', () => {
  afterEach(() => vi.useRealTimers());

  async function fixture() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 9, 12));
    const db = createTestDb();
    const registry = createRegistry(db, new UndoManager(db));
    const call = async (channel: string, ...args: unknown[]) => {
      const [error, result] = await registry.invoke(channel, args);
      if (error) throw new Error(error.message);
      return result;
    };
    return { call, get: (id: string) => call('tasks:getById', id) };
  }

  it('moves to the next occurrence instead of completing, and undo/redo restore each side', async () => {
    const { call, get } = await fixture();
    const id = (await call('tasks:add', 'Watch Frieren\n@sat 6:30pm *weekly #anime', 'tasks')).task.id;
    await call('tasks:setStatus', id, 1);

    expect(await call('tasks:setStatus', id, 2)).toEqual({ type: 'success', message: `${id} repeats on 2026-10-17`, repeatsOn: '2026-10-17' });
    expect(await get(id)).toMatchObject({
      status: 0,
      dueDate: '2026-10-17',
      completedAt: null,
      description: 'Watch Frieren\n@2026-10-17 6:30pm *weekly #anime',
    });

    await call('undo:undo');
    expect(await get(id)).toMatchObject({ status: 1, dueDate: '2026-10-10', description: 'Watch Frieren\n@2026-10-10 6:30pm *weekly #anime' });
    await call('undo:redo');
    expect(await get(id)).toMatchObject({ status: 0, dueDate: '2026-10-17' });
  });

  it("Won't Do skips one occurrence, and subtasks reset with the parent", async () => {
    const { call, get } = await fixture();
    const parent = (await call('tasks:add', 'Weekly review\n@fri *weekly', 'tasks')).task.id;
    const done = (await call('tasks:add', `Inbox zero\n^${parent}`, 'tasks')).task.id;
    const open = (await call('tasks:add', `Plan next week\n^${parent}`, 'tasks')).task.id;
    await call('tasks:setStatus', done, 2);

    await call('tasks:setStatus', parent, 3);
    // Today is Friday, so @fri meant next Friday (Oct 16); the next one is Oct 23.
    expect(await get(parent)).toMatchObject({ status: 0, dueDate: '2026-10-23' });
    expect((await get(done)).status).toBe(0);
    expect((await get(open)).status).toBe(0);

    await call('undo:undo');
    expect((await get(done)).status).toBe(2);
    expect((await get(parent)).dueDate).toBe('2026-10-16');
  });

  it('completes normally without a due date or repeat rule, and warns about a repeat with no date', async () => {
    const { call, get } = await fixture();
    const added = await call('tasks:add', 'Water plants\n*3d', 'tasks');
    expect(added.warnings).toEqual(['*3d needs a due date (@date) to repeat']);
    await call('tasks:setStatus', added.task.id, 2);
    expect((await get(added.task.id)).status).toBe(2);

    const plain = (await call('tasks:add', 'Once\n@sat', 'tasks')).task.id;
    await call('tasks:setStatus', plain, 2);
    expect((await get(plain)).status).toBe(2);
  });

  it('keeps the time and repeat through edits that rebuild the metadata line', async () => {
    const { call, get } = await fixture();
    const id = (await call('tasks:add', 'Watch\n@sat 9AM *Weekly', 'tasks')).task.id;
    await call('tasks:rename', id, 'Watch episode 5\n@sat 9AM *Weekly p2');
    expect(await get(id)).toMatchObject({ description: 'Watch episode 5\np2 @2026-10-10 9am *weekly', priority: 2 });
    const child = (await call('tasks:add', `Snacks\n^${id}`, 'tasks')).task.id;
    expect((await get(id)).description).toBe(`Watch episode 5\n-^${child} p2 @2026-10-10 9am *weekly`);
  });
});
