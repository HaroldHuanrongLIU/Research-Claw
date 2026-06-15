import { describe, it, expect } from 'vitest';
import { buildSaveConfig, type ConfigPatchInput } from '../../utils/config-patch';
import type { RcModelCard } from '../../utils/oc-catalog-align';

/**
 * Parity: every model card RC writes into models.providers[].models[] must pass
 * OpenClaw's STRICT model-definition schema. OC validates each card with
 * `.strict()`, so any unrecognized key makes config.apply / rc.provider.upsert
 * fail at the gateway with `Unrecognized key: "<key>"` — the exact failure that
 * broke saving a custom/local endpoint's contextWindow.
 *
 * Mirror of (keep in sync — OC can't be imported from the dashboard package):
 *   - openclaw/src/config/zod-schema.core.ts:343-387  (ModelDefinitionSchema, .strict())
 *
 * The allow-list below is the COMPLETE set of top-level keys ModelDefinitionSchema
 * accepts. RC only ever authors a subset, but the guard rejects ANY extra key so a
 * future RC-only field can never silently slip into a card again.
 */
const OC_MODEL_DEFINITION_KEYS = new Set([
  'id',
  'name',
  'api',
  'baseUrl',
  'reasoning',
  'input',
  'cost',
  'contextWindow',
  'contextTokens',
  'maxTokens',
  'params',
  'agentRuntime',
  'headers',
  'compat',
  'mediaInput',
  'metadataSource',
]);

function unknownKeys(card: Record<string, unknown>): string[] {
  return Object.keys(card).filter((k) => !OC_MODEL_DEFINITION_KEYS.has(k));
}

function providerModels(cfg: Record<string, unknown>, providerKey: string): RcModelCard[] {
  const providers = (cfg.models as { providers: Record<string, { models: RcModelCard[] }> })
    .providers;
  return providers[providerKey].models;
}

const baseInput = (over: Partial<ConfigPatchInput> = {}): ConfigPatchInput => ({
  provider: 'custom-relay',
  baseUrl: 'https://relay.example.com/v1',
  api: 'openai-completions',
  apiKey: 'sk-test',
  textModel: 'house-model',
  profileLabel: 'House Relay',
  ...over,
});

describe('model card ⊆ OC strict ModelDefinitionSchema — openclaw/src/config/zod-schema.core.ts:343-387', () => {
  it('a custom endpoint with a pinned contextWindow emits no non-schema keys', () => {
    const cfg = buildSaveConfig(null, baseInput({ customContextWindow: 96_000 }));
    const card = providerModels(cfg, 'custom-relay')[0] as Record<string, unknown>;
    // The pinned window must land on contextWindow (a real OC key)…
    expect(card.contextWindow).toBe(96_000);
    // …without smuggling any RC-only provenance field that OC's .strict() rejects.
    expect(unknownKeys(card)).toEqual([]);
  });

  it('a local (ollama) endpoint with a pinned window emits no non-schema keys', () => {
    const cfg = buildSaveConfig(
      null,
      baseInput({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', textModel: 'qwen3', customContextWindow: 40_000, profileLabel: undefined }),
    );
    const card = providerModels(cfg, 'ollama')[0] as Record<string, unknown>;
    expect(card.contextWindow).toBe(40_000);
    expect(unknownKeys(card)).toEqual([]);
  });

  it('a preset provider card emits no non-schema keys', () => {
    const cfg = buildSaveConfig(
      null,
      baseInput({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', textModel: 'gpt-5.4', profileLabel: undefined }),
    );
    const card = providerModels(cfg, 'openai')[0] as Record<string, unknown>;
    expect(unknownKeys(card)).toEqual([]);
  });
});
