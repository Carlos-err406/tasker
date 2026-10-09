/**
 * Due times (`6:30pm`, `9am`, `18:30`) and repeat rules (`*weekly`, `*3d`) on the metadata line.
 */

import { formatDate } from './date-parser.js';

/** A time token: 12-hour with am/pm (minutes optional), or 24-hour HH:MM. */
export const TIME_PATTERN = '(?:(?:1[0-2]|0?[1-9])(?::[0-5]\\d)?[ap]m|(?:[01]?\\d|2[0-3]):[0-5]\\d)';
/** A repeat token without its `*`. */
export const REPEAT_PATTERN = '(?:daily|weekly|monthly|yearly|[1-9]\\d{0,2}[dwm])';

export type RepeatUnit = 'd' | 'w' | 'm';
export interface Repeat {
  readonly every: number;
  readonly unit: RepeatUnit;
}

const NAMED: Record<string, Repeat> = {
  daily: { every: 1, unit: 'd' },
  weekly: { every: 1, unit: 'w' },
  monthly: { every: 1, unit: 'm' },
  yearly: { every: 12, unit: 'm' },
};

/** Parse a time token into 24-hour `HH:MM`, or null. */
export function parseTime(token: string): string | null {
  const t = token.trim().toLowerCase();
  const twelve = /^(1[0-2]|0?[1-9])(?::([0-5]\d))?([ap]m)$/.exec(t);
  if (twelve) {
    let hours = Number(twelve[1]) % 12;
    if (twelve[3] === 'pm') hours += 12;
    return `${String(hours).padStart(2, '0')}:${twelve[2] ?? '00'}`;
  }
  const day = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t);
  return day ? `${day[1]!.padStart(2, '0')}:${day[2]}` : null;
}

/** Format 24-hour `HH:MM` as the 12-hour token, e.g. `6:30pm`, `9am`. */
export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 || 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

/** Parse a repeat token (without `*`), or null. */
export function parseRepeat(token: string): Repeat | null {
  const t = token.trim().toLowerCase();
  if (NAMED[t]) return NAMED[t]!;
  const m = /^([1-9]\d{0,2})([dwm])$/.exec(t);
  return m ? { every: Number(m[1]), unit: m[2] as RepeatUnit } : null;
}

function fromIso(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Add months, clamping to the target month's last day (Jan 31 + 1 = Feb 28). */
function addMonthsClamped(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

/** The first `due + k × interval` (k ≥ 1) after `today`, as yyyy-MM-dd. */
export function nextOccurrence(due: string, repeat: Repeat, today: string): string {
  const start = fromIso(due);
  for (let k = 1; ; k++) {
    const n = k * repeat.every;
    const next =
      repeat.unit === 'm'
        ? addMonthsClamped(start, n)
        : new Date(start.getFullYear(), start.getMonth(), start.getDate() + n * (repeat.unit === 'w' ? 7 : 1));
    const formatted = formatDate(next);
    if (formatted > today) return formatted;
  }
}
