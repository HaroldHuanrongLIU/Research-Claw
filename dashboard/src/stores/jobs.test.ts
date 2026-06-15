import { describe, expect, it } from 'vitest';
import { chooseLiveSessionKey } from './jobs';

describe('chooseLiveSessionKey', () => {
  it('returns null when there are no linked session candidates', () => {
    expect(chooseLiveSessionKey([], new Set(['agent:main']))).toBeNull();
  });

  it('stays optimistic (first candidate) when existence cannot be determined', () => {
    // knownKeys === null models a gateway without sessions.list — must not block resume.
    expect(chooseLiveSessionKey(['agent:main:subagent:abc', 'agent:main'], null)).toBe('agent:main:subagent:abc');
  });

  it('picks the first candidate that the gateway still knows about', () => {
    const known = new Set(['agent:main', 'agent:main:subagent:live']);
    expect(chooseLiveSessionKey(['agent:main:subagent:dead', 'agent:main:subagent:live'], known)).toBe('agent:main:subagent:live');
  });

  it('returns null when every linked session is gone, so the caller can fail loudly', () => {
    const known = new Set(['agent:main', 'unrelated:session']);
    expect(chooseLiveSessionKey(['agent:main:subagent:dead'], known)).toBeNull();
  });
});
