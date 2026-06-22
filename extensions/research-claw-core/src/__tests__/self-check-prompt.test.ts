import { describe, expect, it } from 'vitest';

import { SELF_CHECK_AGENT_GUIDANCE } from '../self-check/prompt.js';

describe('SELF_CHECK_AGENT_GUIDANCE', () => {
  it('requires final-answer self-check without exposing hidden reasoning', () => {
    expect(SELF_CHECK_AGENT_GUIDANCE).toContain('Before every final user-facing reply');
    expect(SELF_CHECK_AGENT_GUIDANCE).toContain('Do not expose hidden reasoning');
    expect(SELF_CHECK_AGENT_GUIDANCE).toContain('latest user request');
  });

  it('covers high-risk gates, product tool routing, and background job review', () => {
    expect(SELF_CHECK_AGENT_GUIDANCE).toContain('high-risk operation gate');
    expect(SELF_CHECK_AGENT_GUIDANCE).toContain('library_* or rc.lit.*');
    expect(SELF_CHECK_AGENT_GUIDANCE).toContain('persistent job state');
    expect(SELF_CHECK_AGENT_GUIDANCE).toContain('checkpoint');
  });
});
