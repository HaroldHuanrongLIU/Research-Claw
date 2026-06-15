import { describe, expect, it } from 'vitest';

import {
  buildAutoLongTaskPrompt,
  detectLongTaskIntent,
} from './long-task';
import { sanitizeUserMessage } from './sanitize-message';

describe('long task detection', () => {
  it('detects bulk workspace paper organization as a background task', () => {
    const result = detectLongTaskIntent('帮我批量整理 workspace 里的论文，生成一份报告');
    expect(result.shouldAutoTrack).toBe(true);
    expect(result.reasons).toContain('bulk-scope');
    expect(result.title).toContain('整理 workspace');
  });

  it('does not auto-track short explanation questions', () => {
    const result = detectLongTaskIntent('为什么 u2 模型没有回复');
    expect(result.shouldAutoTrack).toBe(false);
  });

  it('honors explicit opt-out wording', () => {
    const result = detectLongTaskIntent('不要后台执行，直接回答怎么同步 git');
    expect(result.shouldAutoTrack).toBe(false);
  });

  it('hides internal orchestration instructions from chat history display', () => {
    const prompt = buildAutoLongTaskPrompt({
      jobId: 'longtask:abc',
      title: '批量整理论文',
      originalMessage: '帮我批量整理 workspace 里的论文',
      references: ['papers/a.pdf'],
    });
    expect(prompt).toContain('Research-Claw Job ID: longtask:abc');
    expect(sanitizeUserMessage(prompt)).toBe('帮我批量整理 workspace 里的论文');
  });
});
