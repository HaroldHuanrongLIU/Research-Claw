import { describe, expect, it } from 'vitest';

import { TASK_FLOW_AGENT_GUIDANCE } from '../tasks/task-flow-prompt.js';

describe('TASK_FLOW_AGENT_GUIDANCE', () => {
  it('separates exploratory literature search from library writes', () => {
    expect(TASK_FLOW_AGENT_GUIDANCE).toContain('exploratory requests');
    expect(TASK_FLOW_AGENT_GUIDANCE).toContain('library_add_paper');
    expect(TASK_FLOW_AGENT_GUIDANCE).toContain('library_batch_add');
    expect(TASK_FLOW_AGENT_GUIDANCE).toContain('入库');
    expect(TASK_FLOW_AGENT_GUIDANCE).toContain('找一下');
    expect(TASK_FLOW_AGENT_GUIDANCE).toContain('ask before adding');
  });
});
