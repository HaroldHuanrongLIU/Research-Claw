import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ocModelsListAllPayload } from '../__fixtures__/gateway-payloads/oc-model-catalog';

vi.mock('antd', () => ({
  message: { success: vi.fn(), error: vi.fn() },
}));

import { message } from 'antd';
import { useGatewayStore } from './gateway';
import { useModelCatalogStore } from './model-catalog';

function makeConfig(): Record<string, unknown> {
  return {
    models: {
      providers: {
        openai: {
          api: 'openai-chatgpt-responses',
          models: [
            { id: 'gpt-5.4', name: 'gpt-5.4', reasoning: true, input: ['text', 'image'], contextWindow: 128_000, maxTokens: 16_384 },
          ],
        },
        'zai-coding': {
          api: 'openai-completions',
          models: [
            { id: 'glm-5v-turbo', name: 'glm-5v-turbo', reasoning: false, input: ['text', 'image'], contextWindow: 32_000, maxTokens: 16_384 },
          ],
        },
        deepseek: {
          api: 'openai-completions',
          models: [
            { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', reasoning: true, input: ['text'], contextWindow: 1_000_000, maxTokens: 384_000 },
          ],
        },
      },
    },
  };
}

interface MockClientOpts {
  config?: Record<string, unknown>;
  failModelsList?: boolean;
}

function installMockClient(opts: MockClientOpts = {}) {
  const config = opts.config ?? makeConfig();
  const request = vi.fn(async (method: string) => {
    if (method === 'models.list') {
      if (opts.failModelsList) throw new Error('models.list boom');
      return ocModelsListAllPayload;
    }
    if (method === 'config.get') return { parsed: config, hash: 'h1' };
    if (method === 'config.apply') return {};
    throw new Error(`unexpected RPC ${method}`);
  });
  useGatewayStore.setState({ client: { isConnected: true, request } as never, state: 'connected' });
  return { request };
}

function appliedRaw(request: ReturnType<typeof vi.fn>): Record<string, unknown> | null {
  const call = request.mock.calls.find((c) => c[0] === 'config.apply');
  if (!call) return null;
  const params = call[1] as { raw: string };
  return JSON.parse(params.raw);
}

beforeEach(() => {
  useModelCatalogStore.setState({ catalog: null, aligned: false, aligning: false });
  vi.mocked(message.success).mockClear();
});

describe('useModelCatalogStore.alignConfigOnStartup', () => {
  it('writes back exactly the aligned config when cards drift', async () => {
    const { request } = installMockClient();
    await useModelCatalogStore.getState().alignConfigOnStartup();

    const raw = appliedRaw(request);
    expect(raw).not.toBeNull();
    const providers = (raw!.models as { providers: Record<string, { models: Array<{ contextWindow: number }> }> }).providers;
    expect(providers.openai.models[0].contextWindow).toBe(272_000);
    expect(providers['zai-coding'].models[0].contextWindow).toBe(202_800);
    expect(providers.deepseek.models[0].contextWindow).toBe(1_000_000);
    expect(message.success).toHaveBeenCalledTimes(1);
    expect(useModelCatalogStore.getState().aligned).toBe(true);
  });

  it('does not write back when the config is already aligned', async () => {
    const aligned = makeConfig();
    const p = (aligned.models as { providers: Record<string, { models: Array<{ contextWindow: number }> }> }).providers;
    p.openai.models[0].contextWindow = 272_000;
    p['zai-coding'].models[0].contextWindow = 202_800;
    const { request } = installMockClient({ config: aligned });

    await useModelCatalogStore.getState().alignConfigOnStartup();

    expect(request.mock.calls.some((c) => c[0] === 'config.apply')).toBe(false);
    expect(message.success).not.toHaveBeenCalled();
    expect(useModelCatalogStore.getState().aligned).toBe(true);
  });

  it('degrades silently and stays retryable when the catalog fetch fails', async () => {
    const { request } = installMockClient({ failModelsList: true });
    await useModelCatalogStore.getState().alignConfigOnStartup();

    expect(request.mock.calls.some((c) => c[0] === 'config.apply')).toBe(false);
    expect(useModelCatalogStore.getState().aligned).toBe(false); // retryable next boot
  });

  it('is idempotent: a second invocation issues no further RPCs', async () => {
    const { request } = installMockClient();
    await useModelCatalogStore.getState().alignConfigOnStartup();
    const callsAfterFirst = request.mock.calls.length;
    await useModelCatalogStore.getState().alignConfigOnStartup();
    expect(request.mock.calls.length).toBe(callsAfterFirst);
  });
});
