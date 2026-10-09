import { parseDate, formatDate, addDays, parseTime, formatTime } from '@tasker/core/parsers';

export interface DateSuggestion {
  /** yyyy-MM-dd, inserted as `@date`. */
  date: string;
  label: string;
  detail: string;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function fromIso(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** e.g. "Fri, Oct 9" (the year is added when it isn't this year's). */
export function describeDate(date: string, today: Date): string {
  const d = fromIso(date);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * Quick picks after `@`: Today, Tomorrow, the coming Monday and Next week, leaving
 * room for the calendar. Typing matches every weekday too ("@we" → Wednesday).
 * A typed date the parser understands (`+3d`, `jan15`, `2026-11-01`) comes first
 * when it isn't already one of the picks.
 */
export function dateSuggestions(partial: string, now: Date): DateSuggestion[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const picks: DateSuggestion[] = [
    { label: 'Today', date: formatDate(today) },
    { label: 'Tomorrow', date: formatDate(addDays(today, 1)) },
    ...[2, 3, 4, 5, 6].map((n) => {
      const day = addDays(today, n);
      return { label: WEEKDAYS[day.getDay()]!, date: formatDate(day) };
    }),
    { label: 'Next week', date: formatDate(addDays(today, 7)) },
  ].map((p) => ({ ...p, detail: describeDate(p.date, today) }));
  const typed = partial.trim().toLowerCase();
  if (!typed)
    return picks.filter(
      (p, i) => p.label === 'Today' || p.label === 'Tomorrow' || p.label === 'Monday' || i === picks.length - 1,
    );
  const matches = picks.filter((p) => p.label.toLowerCase().startsWith(typed));
  const parsed = parseDate(typed, new Date(today));
  if (parsed && !matches.some((p) => p.date === parsed))
    matches.unshift({ label: describeDate(parsed, today), date: parsed, detail: `@${partial}` });
  return matches;
}

const DEFAULT_TIMES = ['9am', '12pm', '3pm', '6pm', '9pm'];

/** Time tokens for what was typed after a date: `6` → 6am, 6pm; `6:3` → 6:30am, 6:30pm; `18` → 6pm. */
export function timeSuggestions(partial: string): string[] {
  const typed = partial.trim().toLowerCase();
  if (!typed) return DEFAULT_TIMES;
  const out = new Set<string>();
  const exact = parseTime(typed);
  if (exact) out.add(formatTime(exact));
  const m = /^(\d{1,2})(?::(\d{0,2}))?$/.exec(typed);
  if (m) {
    const hour = Number(m[1]);
    const minutes = (m[2] ?? '').padEnd(2, '0');
    if (Number(minutes) < 60) {
      if (hour >= 1 && hour <= 12)
        for (const suffix of ['am', 'pm']) out.add(formatTime(parseTime(`${hour}:${minutes}${suffix}`)!));
      else if (hour < 24) out.add(formatTime(`${String(hour).padStart(2, '0')}:${minutes}`));
    }
  }
  for (const time of DEFAULT_TIMES) if (time.startsWith(typed)) out.add(time);
  return [...out];
}

/** The weeks of a month, Monday first, with null for days outside it. */
export function calendarWeeks(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array((first.getDay() + 6) % 7).fill(null);
  for (let day = 1; day <= days; day++) cells.push(formatDate(new Date(year, month, day)));
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
