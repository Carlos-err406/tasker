import {describe,expect,it} from 'vitest';
import {normalizeMarkdownDelimiters} from '../src/lib/markdown-source.js';
describe('smart punctuation in Markdown',()=>{
 it('repairs table alignment and divider without changing line count',()=>{
  const text='|left|right|\n|:—|—-:|\n|a|b|\n\n—';
  const result=normalizeMarkdownDelimiters(text);
  expect(result).toBe('|left|right|\n|:---|---:|\n|a|b|\n\n---');
  expect(result.split('\n')).toHaveLength(text.split('\n').length);
 });
 it('preserves ordinary prose, inline code and fenced or indented code',()=>{
  const text='hello—world\n`—`\n```md\n|a|b|\n|—|—|\n—\n```\n    —\n~~~\n—\n~~~';
  expect(normalizeMarkdownDelimiters(text)).toBe(text);
 });
 it('leaves valid Markdown and unrelated pipe text unchanged',()=>{
  const text='|a|b|\n|---|---|\nhello | world—again';
  expect(normalizeMarkdownDelimiters(text)).toBe(text);
 });
});
