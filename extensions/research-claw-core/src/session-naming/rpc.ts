import type { RegisterMethod } from '../types.js';
import type { SessionNamingService } from './service.js';

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value;
}

export function registerSessionNamingRpc(
  registerMethod: RegisterMethod,
  service: SessionNamingService,
): void {
  registerMethod('rc.session.autoName', async (params: Record<string, unknown>) => {
    const userText = requireString(params, 'userText');
    const assistantText = requireString(params, 'assistantText');
    const title = await service.generateTitle({ userText, assistantText });
    return { ok: true, title };
  });
}
