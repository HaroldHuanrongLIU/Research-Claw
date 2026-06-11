import { describe, expect, it } from 'vitest';

import {
  computeMentionQuery,
  filterMentionCandidates,
  flattenWorkspaceFiles,
  stripMentionToken,
} from './mention';

describe('computeMentionQuery', () => {
  it('detects a mention token at the start of input', () => {
    expect(computeMentionQuery('@pap', 4)).toEqual({ query: 'pap', start: 0, end: 4 });
  });

  it('detects a mention token preceded by whitespace', () => {
    const text = 'read @data';
    expect(computeMentionQuery(text, text.length)).toEqual({ query: 'data', start: 5, end: 10 });
  });

  it('returns empty query right after typing "@"', () => {
    expect(computeMentionQuery('@', 1)).toEqual({ query: '', start: 0, end: 1 });
  });

  it('does NOT trigger on emails (no whitespace before @)', () => {
    expect(computeMentionQuery('mail a@b', 8)).toBeNull();
  });

  it('does NOT trigger when the token contains whitespace (stale)', () => {
    expect(computeMentionQuery('@pap er', 7)).toBeNull();
  });

  it('uses cursor position, not end of text', () => {
    const text = '@paper.pdf and more';
    expect(computeMentionQuery(text, 4)).toEqual({ query: 'pap', start: 0, end: 4 });
  });

  it('returns null when there is no @', () => {
    expect(computeMentionQuery('plain text', 5)).toBeNull();
  });
});

describe('stripMentionToken', () => {
  it('removes the @query token and returns the caret at its start', () => {
    const text = 'read @data now';
    const token = computeMentionQuery('read @data', 10)!;
    expect(stripMentionToken(text, token)).toEqual({ text: 'read  now', cursor: 5 });
  });
});

describe('filterMentionCandidates', () => {
  const paths = [
    'sources/paper.pdf',
    'sources/paper-v2.pdf',
    'uploads/data.csv',
    'notes/papyrus.txt',
    'outputs/summary.md',
  ];

  it('returns all (capped) for an empty query', () => {
    expect(filterMentionCandidates(paths, '', 3)).toEqual(paths.slice(0, 3));
  });

  it('ranks basename prefix matches first', () => {
    const out = filterMentionCandidates(paths, 'paper');
    expect(out[0]).toBe('sources/paper.pdf');
    expect(out).toContain('sources/paper-v2.pdf');
    expect(out).not.toContain('uploads/data.csv');
  });

  it('matches case-insensitively', () => {
    expect(filterMentionCandidates(paths, 'DATA')).toEqual(['uploads/data.csv']);
  });

  it('respects the limit', () => {
    expect(filterMentionCandidates(paths, 'p', 1).length).toBe(1);
  });
});

describe('flattenWorkspaceFiles', () => {
  it('collects file paths only, recursing into directories', () => {
    const tree = [
      { path: 'sources', type: 'directory' as const, children: [
        { path: 'sources/paper.pdf', type: 'file' as const },
        { path: 'sources/figs', type: 'directory' as const, children: [
          { path: 'sources/figs/a.png', type: 'file' as const },
        ] },
      ] },
      { path: 'README.md', type: 'file' as const },
    ];
    expect(flattenWorkspaceFiles(tree)).toEqual([
      'sources/paper.pdf',
      'sources/figs/a.png',
      'README.md',
    ]);
  });
});
