import { randomUUID } from 'node:crypto';

import type { RegisterMethod } from '../types.js';
import { JobService, type JobStatus } from './service.js';

interface JobRpcOptions {
  syncOpenClawSubagents?: () => unknown;
}

export function registerJobRpc(registerMethod: RegisterMethod, service: JobService, options: JobRpcOptions = {}): void {
  // The injected sync is already coalesced/throttled by the caller, so the scan
  // runs at most once per window across both RPC and the server-side timer.
  const sync = () => {
    try { options.syncOpenClawSubagents?.(); } catch { /* best effort */ }
  };

  registerMethod('rc.longTask.submit', (params) => {
    const message = typeof params.message === 'string' ? params.message.trim() : '';
    if (!message) throw new Error('message is required');
    const title = deriveLongTaskTitle(
      typeof params.display_title === 'string' ? params.display_title : message,
    );
    const sessionKey = typeof params.session_key === 'string' ? params.session_key : null;
    const references = Array.isArray(params.references)
      ? params.references.filter((item): item is string => typeof item === 'string')
      : [];
    const detection = params.detection && typeof params.detection === 'object' && !Array.isArray(params.detection)
      ? params.detection as Record<string, unknown>
      : undefined;
    const now = formatDbDate(Date.now());
    const job = service.upsertExternal({
      id: `longtask:${randomUUID()}`,
      type: 'openclaw-subagent',
      title,
      session_key: sessionKey,
      status: 'queued',
      progress: 0,
      current_step: '等待 OpenClaw 子会话启动',
      input: {
        source: 'auto-long-task',
        message,
        references,
        detection,
      },
      checkpoint: {
        submitted_at: now,
        auto_tracked: true,
      },
      heartbeat_at: now,
    });
    return { job };
  });

  registerMethod('rc.job.list', (params) => {
    sync();
    service.markStalled(90);
    return service.list({
      status: typeof params.status === 'string' ? params.status as JobStatus : undefined,
      session_key: typeof params.session_key === 'string' ? params.session_key : undefined,
      limit: typeof params.limit === 'number' ? params.limit : undefined,
    });
  });
  registerMethod('rc.job.get', (params) => {
    // Single-job reads (manual refresh / post-action reload) skip the full
    // transcript sweep; freshness is owned by the periodic rc.job.list poll.
    service.markStalled(90);
    return service.get(String(params.id ?? ''));
  });
  registerMethod('rc.job.cancel', (params) => service.cancel(
    String(params.id ?? ''),
    typeof params.reason === 'string' && params.reason.trim() ? params.reason.trim() : undefined,
  ));
  registerMethod('rc.job.resume', (params) => service.resume(
    String(params.id ?? ''),
    typeof params.current_step === 'string' && params.current_step.trim()
      ? params.current_step.trim()
      : undefined,
  ));
  registerMethod('rc.job.markStalled', (params) => ({
    changed: service.markStalled(typeof params.stale_seconds === 'number' ? params.stale_seconds : 90),
  }));
}

function deriveLongTaskTitle(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '后台长任务';
  return compact.length > 80 ? `${compact.slice(0, 80)}...` : compact;
}

function formatDbDate(value: number): string {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}
