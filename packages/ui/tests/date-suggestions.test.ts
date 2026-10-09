import { describe, expect, it } from 'vitest';
import { dateSuggestions, timeSuggestions, calendarWeeks } from '../src/lib/date-suggestions.js';

const NOW = new Date(2026, 9, 9, 15, 30); // Fri Oct 9 2026, mid-afternoon

describe('date suggestions', () => {
  it('offer today, tomorrow, the coming Monday and next week', () => {
    expect(dateSuggestions('', NOW).map((s) => [s.label, s.date, s.detail])).toEqual([
      ['Today', '2026-10-09', 'Fri, Oct 9'],
      ['Tomorrow', '2026-10-10', 'Sat, Oct 10'],
      ['Monday', '2026-10-12', 'Mon, Oct 12'],
      ['Next week', '2026-10-16', 'Fri, Oct 16'],
    ]);
    // On a Sunday, Monday is tomorrow, so it isn't listed twice.
    expect(dateSuggestions('', new Date(2026, 9, 11)).map((s) => s.label)).toEqual(['Today', 'Tomorrow', 'Next week']);
  });

  it('filter by name and put a typed date first', () => {
    expect(dateSuggestions('t', NOW).map((s) => s.label)).toEqual(['Today', 'Tomorrow', 'Tuesday', 'Thursday']);
    expect(dateSuggestions('mo', NOW).map((s) => s.date)).toEqual(['2026-10-12']);
    // `fri` means next Friday, which is already "Next week".
    expect(dateSuggestions('fri', NOW).map((s) => s.date)).toEqual(['2026-10-16']);
    expect(dateSuggestions('+3d', NOW)).toEqual([{ label: 'Mon, Oct 12', date: '2026-10-12', detail: '@+3d' }]);
    expect(dateSuggestions('jan15', NOW)).toEqual([{ label: 'Fri, Jan 15, 2027', date: '2027-01-15', detail: '@jan15' }]);
    expect(dateSuggestions('xyz', NOW)).toEqual([]);
  });
});

describe('time suggestions', () => {
  it.each([
    ['', ['9am', '12pm', '3pm', '6pm', '9pm']],
    ['6', ['6am', '6pm']],
    ['6:3', ['6:30am', '6:30pm']],
    ['18', ['6pm']],
    ['18:45', ['6:45pm']],
    ['9p', ['9pm']],
    ['12', ['12am', '12pm']],
    ['abc', []],
  ])('after "%s" suggest %j', (typed, expected) => expect(timeSuggestions(typed)).toEqual(expected));
});

describe('calendar', () => {
  it('lays out a month in Monday-first weeks', () => {
    const weeks = calendarWeeks(2026, 9);
    expect(weeks[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(weeks.at(-1)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', null]);
    expect(weeks).toHaveLength(5);
  });
});
