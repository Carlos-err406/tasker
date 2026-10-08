import {describe,expect,it} from 'vitest';
import {codeForClipboard,normalizeMarkdownDelimiters} from '../src/lib/markdown-source.js';
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

describe('copying code', () => {
  it('pastes into a shell exactly as typed', () => {
    const stored =
      'curl\u00A0\u201Chttps://tasas.eltoque.com/v1/trmi\u201D \\\n' +
      '\uFEFF-H \u201CAuthorization: Bearer $KEY\u201D \\\n' +
      '-H "Accept: application/json" | jq \u2018{USD: .tasas.USD}\u2019\u200B';
    expect(codeForClipboard(stored)).toBe(
      'curl "https://tasas.eltoque.com/v1/trmi" \\\n' +
        '-H "Authorization: Bearer $KEY" \\\n' +
        "-H \"Accept: application/json\" | jq '{USD: .tasas.USD}'",
    );
  });

  it('keeps emoji joiners and ordinary text untouched', () => {
    const family = '\u{1F469}\u200D\u{1F4BB} echo "ok"';
    expect(codeForClipboard(family)).toBe(family);
  });
});
