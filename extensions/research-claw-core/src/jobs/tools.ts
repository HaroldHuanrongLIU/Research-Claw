import type { ToolDefinition } from '../types.js';
import { JobService, type JobStatus, type JobStepStatus } from './service.js';
import { createJobOrchestrationPolicy } from './protocol.js';

const ok = (text: string, details?: unknown) => ({ content: [{ type: 'text', text }], details: details ?? {} });
const fail = (message: string) => ({ content: [{ type: 'text', text: `Error: ${message}` }], details: { error: message } });

export function createJobTools(service: JobService): ToolDefinition[] {
  return [
    {
      name: 'job_start',
      description: 'Create a persistent background job before starting work that may exceed one agent turn. Include explicit scope, allowed writes, and review boundaries in input when possible. Return the job id promptly; do not block-poll for completion.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string' }, title: { type: 'string' }, session_key: { type: 'string' },
          input: { type: 'object' },
          steps: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' } }, required: ['key', 'label'] } },
        },
        required: ['type', 'title'],
      },
      async execute(_id, params) {
        try {
          const type = typeof params.type === 'string' ? params.type.trim() : '';
          const title = typeof params.title === 'string' ? params.title.trim() : '';
          if (!type || !title) return fail('type and title are required');
          const rawInput = typeof params.input === 'object' && params.input && !Array.isArray(params.input)
            ? params.input as Record<string, unknown>
            : {};
          const references = Array.isArray(rawInput.references)
            ? rawInput.references.filter((item): item is string => typeof item === 'string')
            : [];
          const input = {
            ...rawInput,
            orchestration: rawInput.orchestration ?? createJobOrchestrationPolicy({
              source: 'job-tool',
              message: title,
              references,
            }),
          };
          const job = service.create({
            type, title,
            session_key: typeof params.session_key === 'string' ? params.session_key : undefined,
            input,
            steps: Array.isArray(params.steps) ? params.steps.filter((s): s is { key: string; label: string } =>
              typeof s === 'object' && s !== null && typeof (s as { key?: unknown }).key === 'string' && typeof (s as { label?: unknown }).label === 'string') : undefined,
          });
          return ok(`Background job created: "${job.title}" (${job.id}). Continue work via checkpoints and return control to the user without long polling.`, job);
        } catch (err) { return fail(err instanceof Error ? err.message : String(err)); }
      },
    },
    {
      name: 'job_checkpoint',
      description: 'Persist progress and heartbeat for a background job. Call after each batch or major step, and include enough checkpoint data to resume from the latest completed work.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' }, progress: { type: 'number' }, current_step: { type: ['string', 'null'] },
          checkpoint: { type: 'object' }, step_key: { type: 'string' }, step_label: { type: 'string' },
          step_status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'skipped'] },
          step_progress: { type: 'number' }, step_checkpoint: { type: 'object' }, error: { type: ['string', 'null'] },
        },
        required: ['id'],
      },
      async execute(_id, params) {
        try {
          const id = typeof params.id === 'string' ? params.id : '';
          const job = service.checkpoint(id, {
            progress: typeof params.progress === 'number' ? params.progress : undefined,
            current_step: params.current_step === null || typeof params.current_step === 'string' ? params.current_step : undefined,
            checkpoint: typeof params.checkpoint === 'object' && params.checkpoint && !Array.isArray(params.checkpoint) ? params.checkpoint as Record<string, unknown> : undefined,
            step_key: typeof params.step_key === 'string' ? params.step_key : undefined,
            step_label: typeof params.step_label === 'string' ? params.step_label : undefined,
            step_status: typeof params.step_status === 'string' ? params.step_status as JobStepStatus : undefined,
            step_progress: typeof params.step_progress === 'number' ? params.step_progress : undefined,
            step_checkpoint: typeof params.step_checkpoint === 'object' && params.step_checkpoint && !Array.isArray(params.step_checkpoint) ? params.step_checkpoint as Record<string, unknown> : undefined,
            error: params.error === null || typeof params.error === 'string' ? params.error : undefined,
          });
          return ok(`Job checkpoint saved: ${job.progress}% (${job.current_step ?? 'working'})`, job);
        } catch (err) { return fail(err instanceof Error ? err.message : String(err)); }
      },
    },
    {
      name: 'job_status',
      description: 'Read a persistent background job status. Prefer one status check over repeated process.poll calls.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      async execute(_id, params) {
        try { const job = service.get(String(params.id ?? '')); return ok(`Job "${job.title}": ${job.status}, ${job.progress}%`, job); }
        catch (err) { return fail(err instanceof Error ? err.message : String(err)); }
      },
    },
    {
      name: 'job_finish',
      description: 'Mark a persistent background job completed, partial, failed, or cancelled.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, status: { type: 'string', enum: ['completed', 'partial', 'failed', 'cancelled'] }, result: {}, error: { type: 'string' } },
        required: ['id', 'status'],
      },
      async execute(_id, params) {
        try {
          const job = service.finish(String(params.id ?? ''), params.status as Extract<JobStatus, 'completed' | 'partial' | 'failed' | 'cancelled'>, params.result, typeof params.error === 'string' ? params.error : undefined);
          return ok(`Background job "${job.title}" finished with status ${job.status}.`, job);
        } catch (err) { return fail(err instanceof Error ? err.message : String(err)); }
      },
    },
  ];
}
