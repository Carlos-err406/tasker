/**
 * Parses inline metadata from task descriptions.
 * Parses trailing lines if they contain ONLY metadata markers.
 * Keeps original text intact (does not strip markers).
 * Supports: p1/p2/p3 (priority), @date (due date) with an optional time right after it
 * (@sat 6:30pm), *interval (repeat), #tag (tags),
 * ^abc (parent), !abc (blocks), -^abc (has subtask), -!abc (blocked by), ~abc (related),
 * >list-name (create in / move to that list; one-shot, stripped when saved)
 */

import type { Priority } from '../types/priority.js';
import { Priority as P } from '../types/priority.js';
import { parseDate } from './date-parser.js';
import { TIME_PATTERN, REPEAT_PATTERN, parseTime, parseRepeat, formatTime, type Repeat } from './recurrence.js';

// Match p1, p2, p3 for priority (must be standalone token)
const PRIORITY_RE = /(?:^|\s)p([123])(?=\s|$)/i;
// Match @word for due dates
const DUE_DATE_RE = /@(\S+)/;
// Match a time token directly after the due date token
const DUE_TIME_RE = new RegExp(`^\\s+(${TIME_PATTERN})(?=\\s|$)`, 'i');
// Match *interval for repeating tasks
const REPEAT_RE = new RegExp(`(?:^|\\s)\\*(${REPEAT_PATTERN})(?=\\s|$)`, 'gi');
// Match #word for tags (supports hyphens like #cli-only)
const TAG_RE = /#([\w-]+)/g;
// Match ^abc for parent reference (subtask of)
const PARENT_REF_RE = /(?:^|\s)\^(\w{3})(?=\s|$)/;
// Match !abc for blocking reference (blocks task)
const BLOCKS_REF_RE = /(?:^|\s)!(\w{3})(?=\s|$)/g;
// Match -^abc for inverse parent reference (has subtask)
const INV_PARENT_RE = /(?:^|\s)-\^(\w{3})(?=\s|$)/g;
// Match -!abc for inverse blocker reference (blocked by)
const INV_BLOCKER_RE = /(?:^|\s)-!(\w{3})(?=\s|$)/g;
// Match ~abc for related reference (related to task)
const RELATED_REF_RE = /(?:^|\s)~(\w{3})(?=\s|$)/g;
// Match >list-name for a target list (spaces in list names are written as - or _)
const LIST_TARGET_RE = /(?:^|\s)>(\S+)(?=\s|$)/g;

export interface ParsedTask {
  readonly description: string;
  readonly priority: Priority | null;
  readonly dueDate: string | null; // yyyy-MM-dd
  readonly tags: string[];
  readonly lastLineIsMetadataOnly: boolean;
  readonly parentId: string | null;
  readonly blocksIds: string[] | null;
  readonly hasSubtaskIds: string[] | null;
  readonly blockedByIds: string[] | null;
  readonly relatedIds: string[] | null;
  readonly dueDateRaw: string | null;
  /** Due time as 24-hour HH:MM, from a time token directly after the due date. */
  readonly dueTime: string | null;
  /** Repeat rule from a `*interval` token (last one wins); only effective with a due date. */
  readonly repeat: Repeat | null;
  readonly repeatRaw: string | null;
  /** Raw `>list` token text (last one wins); resolved and stripped when saving. */
  readonly listTarget: string | null;
}

/** Collect all matches from a global regex into an array of the first capture group */
function allMatches(re: RegExp, str: string): string[] {
  const results: string[] = [];
  // Reset lastIndex in case the regex was used before
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    results.push(m[1]!);
  }
  return results;
}

/** Strip all metadata markers from a line, returning only non-metadata content */
function stripMetadata(line: string): string {
  let s = line;
  s = s.replace(/(?:^|\s)p[123](?=\s|$)/gi, ' ');
  s = s.replace(new RegExp(`@\\S+(?:\\s+${TIME_PATTERN}(?=\\s|$))?`, 'gi'), ' ');
  s = s.replace(new RegExp(`(?:^|\\s)\\*${REPEAT_PATTERN}(?=\\s|$)`, 'gi'), ' ');
  s = s.replace(/#[\w-]+/g, ' ');
  s = s.replace(/(?:^|\s)-\^(\w{3})(?=\s|$)/g, ' ');
  s = s.replace(/(?:^|\s)-!(\w{3})(?=\s|$)/g, ' ');
  s = s.replace(/(?:^|\s)\^(\w{3})(?=\s|$)/g, ' ');
  s = s.replace(/(?:^|\s)!(\w{3})(?=\s|$)/g, ' ');
  s = s.replace(/(?:^|\s)~(\w{3})(?=\s|$)/g, ' ');
  s = s.replace(/(?:^|\s)>\S+(?=\s|$)/g, ' ');
  return s;
}

function trailingMetadataRange(lines: string[]): { start: number; end: number; text: string } | null {
  let end = lines.length - 1;
  while (end >= 0 && lines[end]!.trim() === '') end--;
  if (end < 0) return null;

  let start = end;
  while (start >= 0) {
    const line = lines[start]!;
    if (line.trim() === '' || stripMetadata(line).trim() !== '') break;
    start--;
  }

  start += 1;
  if (start > end) return null;

  return {
    start,
    end,
    text: lines.slice(start, end + 1).join(' '),
  };
}

/**
 * Parse a task description, extracting metadata from trailing lines
 * if they contain only metadata markers.
 */
export function parse(input: string, now?: Date): ParsedTask {
  if (!input.trim()) {
    return {
      description: input,
      priority: null,
      dueDate: null,
      tags: [],
      lastLineIsMetadataOnly: false,
      parentId: null,
      blocksIds: null,
      hasSubtaskIds: null,
      blockedByIds: null,
      relatedIds: null,
      dueDateRaw: null,
      dueTime: null,
      repeat: null,
      repeatRaw: null,
      listTarget: null,
    };
  }

  const lines = input.split('\n');
  const metadataRange = trailingMetadataRange(lines);
  const metadataText = metadataRange?.text ?? '';

  if (!metadataRange) {
    return {
      description: input,
      priority: null,
      dueDate: null,
      tags: [],
      lastLineIsMetadataOnly: false,
      parentId: null,
      blocksIds: null,
      hasSubtaskIds: null,
      blockedByIds: null,
      relatedIds: null,
      dueDateRaw: null,
      dueTime: null,
      repeat: null,
      repeatRaw: null,
      listTarget: null,
    };
  }

  // Extract priority
  let priority: Priority | null = null;
  const priorityMatch = PRIORITY_RE.exec(metadataText);
  if (priorityMatch) {
    switch (priorityMatch[1]) {
      case '1': priority = P.High; break;
      case '2': priority = P.Medium; break;
      case '3': priority = P.Low; break;
    }
  }

  // Extract due date
  let dueDate: string | null = null;
  let dueDateRaw: string | null = null;
  const dueDateMatch = DUE_DATE_RE.exec(metadataText);
  let dueTime: string | null = null;
  if (dueDateMatch) {
    dueDateRaw = dueDateMatch[1]!;
    dueDate = parseDate(dueDateRaw, now);
    const timeMatch = DUE_TIME_RE.exec(metadataText.slice(dueDateMatch.index + dueDateMatch[0].length));
    if (timeMatch && dueDate) dueTime = parseTime(timeMatch[1]!);
  }

  // Extract repeat rule (last one wins)
  const repeatRaw = allMatches(REPEAT_RE, metadataText).at(-1)?.toLowerCase() ?? null;
  const repeat = repeatRaw ? parseRepeat(repeatRaw) : null;

  // Extract tags
  const tags = allMatches(TAG_RE, metadataText);

  // Extract parent reference (single)
  const parentMatch = PARENT_REF_RE.exec(metadataText);
  const parentId = parentMatch ? parentMatch[1]! : null;

  // Extract blocking references (multiple)
  const blocksIds = allMatches(BLOCKS_REF_RE, metadataText);

  // Extract inverse parent references (multiple)
  const hasSubtaskIds = allMatches(INV_PARENT_RE, metadataText);

  // Extract inverse blocker references (multiple)
  const blockedByIds = allMatches(INV_BLOCKER_RE, metadataText);

  // Extract related references (multiple)
  const relatedIds = allMatches(RELATED_REF_RE, metadataText);

  // Extract target list (last one wins)
  const listTarget = allMatches(LIST_TARGET_RE, metadataText).at(-1) ?? null;

  return {
    description: input,
    priority,
    dueDate,
    tags,
    lastLineIsMetadataOnly: true,
    parentId,
    blocksIds: blocksIds.length > 0 ? blocksIds : null,
    hasSubtaskIds: hasSubtaskIds.length > 0 ? hasSubtaskIds : null,
    blockedByIds: blockedByIds.length > 0 ? blockedByIds : null,
    relatedIds: relatedIds.length > 0 ? relatedIds : null,
    dueDateRaw,
    dueTime,
    repeat,
    repeatRaw,
    listTarget,
  };
}

/** Normalised form used to match `>list` tokens: case-insensitive, with spaces,
 *  hyphens and underscores treated alike. */
export function listTargetKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '-');
}

/** Remove `>list` tokens from the trailing metadata lines, dropping lines left empty. */
export function stripListTarget(description: string): string {
  const lines = description.split('\n');
  const range = trailingMetadataRange(lines);
  if (!range) return description;
  const kept: string[] = [];
  for (const line of lines.slice(range.start, range.end + 1)) {
    const cleaned = line.replace(/(?:^|\s)>\S+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned) kept.push(cleaned);
  }
  lines.splice(range.start, range.end - range.start + 1, ...kept);
  return lines.join('\n').trimEnd();
}

/**
 * Gets the description for display purposes (hides trailing metadata-only lines).
 * Single-line descriptions that are only metadata are still shown (otherwise task would be empty).
 */
export function getDisplayDescription(description: string): string {
  if (!description.trim()) return description;

  const lines = description.split('\n');

  if (lines.length === 1) {
    // Single line - still show it even if metadata-only
    return description;
  }

  // Multi-line - check if trailing lines are metadata-only
  const metadataRange = trailingMetadataRange(lines);
  if (metadataRange) {
    return lines.slice(0, metadataRange.start).join('\n').trimEnd();
  }

  return description.trimEnd();
}

/**
 * Updates the description to sync metadata changes.
 * Updates existing metadata line or appends a new one.
 * Order: ^parent !blocks -^subtasks -!blockedBy ~related pN @date time *repeat #tags
 * The time and repeat tokens are kept from the description unless `extra` overrides them.
 */
export function syncMetadataToDescription(
  description: string,
  priority: Priority | null,
  dueDate: string | null, // yyyy-MM-dd
  tags: string[] | null,
  parentId?: string | null,
  blocksIds?: string[] | null,
  hasSubtaskIds?: string[] | null,
  blockedByIds?: string[] | null,
  relatedIds?: string[] | null,
  extra?: { dueTime?: string | null; repeatRaw?: string | null },
): string {
  const lines = description.split('\n');
  const metadataRange = trailingMetadataRange(lines);
  const current = extra && 'dueTime' in extra && 'repeatRaw' in extra ? null : parse(description);
  const dueTime = extra && 'dueTime' in extra ? extra.dueTime : current!.dueTime;
  const repeatRaw = extra && 'repeatRaw' in extra ? extra.repeatRaw : current!.repeatRaw;

  // Build the new metadata line (deduplicate IDs to prevent corruption from undo replays)
  const unique = (ids: string[]) => [...new Set(ids)];
  const parts: string[] = [];

  if (parentId) parts.push(`^${parentId}`);
  if (blocksIds?.length) parts.push(...unique(blocksIds).map(id => `!${id}`));
  if (hasSubtaskIds?.length) parts.push(...unique(hasSubtaskIds).map(id => `-^${id}`));
  if (blockedByIds?.length) parts.push(...unique(blockedByIds).map(id => `-!${id}`));
  if (relatedIds?.length) parts.push(...unique(relatedIds).map(id => `~${id}`));

  if (priority != null) {
    const p = priority === P.High ? 'p1' : priority === P.Medium ? 'p2' : 'p3';
    parts.push(p);
  }

  if (dueDate) parts.push(`@${dueDate}`);
  if (dueDate && dueTime) parts.push(formatTime(dueTime));
  if (repeatRaw) parts.push(`*${repeatRaw}`);
  if (tags?.length) parts.push(...unique(tags).map(t => `#${t}`));

  const newMetaLine = parts.join(' ');

  if (metadataRange) {
    if (!newMetaLine) {
      // Remove the metadata block entirely
      lines.splice(metadataRange.start, metadataRange.end - metadataRange.start + 1);
    } else {
      lines.splice(metadataRange.start, metadataRange.end - metadataRange.start + 1, newMetaLine);
    }
  } else if (newMetaLine) {
    lines.push(newMetaLine);
  }

  return lines.join('\n');
}
