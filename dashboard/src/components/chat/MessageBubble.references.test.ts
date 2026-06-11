import { describe, expect, it } from 'vitest';

import { parseReferenceBlock, stripReferenceBlock } from './MessageBubble';
import { appendReferenceBlock } from '../../utils/file-reference';

describe('MessageBubble reference-block parsing', () => {
  it('round-trips paths appended by appendReferenceBlock()', () => {
    const paths = ['sources/report.docx', 'uploads/data.csv'];
    const message = appendReferenceBlock('请总结这些文件', paths);
    expect(parseReferenceBlock(message)).toEqual(paths);
  });

  it('returns no paths when there is no reference block', () => {
    expect(parseReferenceBlock('just a normal message')).toEqual([]);
  });

  it('strips the reference block from display text, leaving the user text intact', () => {
    const message = appendReferenceBlock('请总结这些文件', ['sources/report.docx']);
    expect(stripReferenceBlock(message)).toBe('请总结这些文件');
  });

  it('leaves text without a block unchanged', () => {
    expect(stripReferenceBlock('hello world')).toBe('hello world');
  });

  it('parses a block with surrounding whitespace and tolerant bullet spacing', () => {
    const text = 'see attached\n\n[引用文件 / Referenced files]\n-  @sources/a.pdf\n- @sources/b.pdf\n';
    expect(parseReferenceBlock(text)).toEqual(['sources/a.pdf', 'sources/b.pdf']);
    expect(stripReferenceBlock(text)).toBe('see attached');
  });
});
