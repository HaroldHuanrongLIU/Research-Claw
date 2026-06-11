import { describe, it, expect } from 'vitest';
import { isAutoNameCandidate, extractFirstExchange } from './auto-name';

describe('isAutoNameCandidate', () => {
  it('accepts project sessions with default "Session N" labels', () => {
    expect(isAutoNameCandidate({ key: 'agent:main:project-a1b2c3d4', label: 'Session 1' })).toBe(true);
    expect(isAutoNameCandidate({ key: 'project-a1b2c3d4', label: 'Session 12' })).toBe(true);
    expect(isAutoNameCandidate({ key: 'agent:main:project-a1b2c3d4', label: '项目 3' })).toBe(true);
  });

  it('accepts project sessions with no label at all', () => {
    expect(isAutoNameCandidate({ key: 'agent:main:project-e5f6g7h8' })).toBe(true);
    expect(isAutoNameCandidate({ key: 'agent:main:project-e5f6g7h8', label: undefined })).toBe(true);
  });

  it('rejects sessions the user has renamed (name once, user wins)', () => {
    expect(isAutoNameCandidate({ key: 'agent:main:project-a1b2c3d4', label: 'My literature sprint' })).toBe(false);
    expect(isAutoNameCandidate({ key: 'agent:main:project-a1b2c3d4', label: '注意力机制论文整理' })).toBe(false);
  });

  it('rejects the main session', () => {
    expect(isAutoNameCandidate({ key: 'main' })).toBe(false);
    expect(isAutoNameCandidate({ key: 'agent:main:main', label: 'Session 1' })).toBe(false);
  });

  it('rejects synthetic and cron sessions', () => {
    expect(isAutoNameCandidate({ key: 'agent:main:main:heartbeat' })).toBe(false);
    expect(isAutoNameCandidate({ key: 'agent:main:subagent:5e8e783e-086f-4f5c-93b6-ba24cd42be93' })).toBe(false);
    expect(isAutoNameCandidate({ key: 'agent:main:cron:ab79d459-5135-4236-bd6f-4d234172a9c8' })).toBe(false);
  });
});

describe('extractFirstExchange', () => {
  it('extracts the first user/assistant pair from content blocks', () => {
    const result = extractFirstExchange([
      { role: 'user', content: [{ type: 'text', text: 'hello topic' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'reply text' }] },
    ]);
    expect(result).toEqual({ userText: 'hello topic', assistantText: 'reply text' });
  });

  it('strips RC-injected context blocks from the user message', () => {
    const result = extractFirstExchange([
      {
        role: 'user',
        content: [{ type: 'text', text: '[Research-Claw] Library: 12 papers\n  - Monitor: 2 active\n真正的问题' }],
      },
      { role: 'assistant', content: [{ type: 'text', text: '回答' }] },
    ]);
    expect(result?.userText).toBe('真正的问题');
  });

  it('supports plain-string content and text field', () => {
    const result = extractFirstExchange([
      { role: 'user', content: 'plain question' },
      { role: 'assistant', text: 'plain answer' },
    ]);
    expect(result).toEqual({ userText: 'plain question', assistantText: 'plain answer' });
  });

  it('returns null when there is no assistant reply yet', () => {
    expect(extractFirstExchange([{ role: 'user', content: 'question' }])).toBeNull();
  });

  it('returns null when there are no messages or only system/tool messages', () => {
    expect(extractFirstExchange([])).toBeNull();
    expect(extractFirstExchange([{ role: 'toolResult', content: 'x' }])).toBeNull();
  });

  it('skips assistant messages that precede the first user message', () => {
    const result = extractFirstExchange([
      { role: 'assistant', content: 'greeting from a cron run' },
      { role: 'user', content: 'actual question' },
      { role: 'assistant', content: 'actual answer' },
    ]);
    expect(result).toEqual({ userText: 'actual question', assistantText: 'actual answer' });
  });

  it('truncates both sides to 800 characters', () => {
    const long = 'x'.repeat(2000);
    const result = extractFirstExchange([
      { role: 'user', content: long },
      { role: 'assistant', content: long },
    ]);
    expect(result?.userText).toHaveLength(800);
    expect(result?.assistantText).toHaveLength(800);
  });

  it('returns null when the user message is pure injected metadata', () => {
    const result = extractFirstExchange([
      { role: 'user', content: '[Research-Claw] Library: 12 papers\n  - Monitor: 2 active' },
      { role: 'assistant', content: 'reply' },
    ]);
    expect(result).toBeNull();
  });
});
