import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveModelDef,
  validateModelTuning,
  isManualModelEndpoint,
  buildSaveConfig,
  extractProviderFieldsForEditor,
  extractConfigFields,
  CONTEXT_WINDOW_MIN,
  CONTEXT_WINDOW_MAX,
  type ConfigPatchInput,
} from './config-patch';
import { setModelCatalogCache } from './catalog-cache';
import { alignConfigModels, type RcModelCard } from './oc-catalog-align';
import { ocModelsListAllPayload } from '../__fixtures__/gateway-payloads/oc-model-catalog';

afterEach(() => setModelCatalogCache(null));

describe('isManualModelEndpoint', () => {
  it('true for local runtimes and custom API profiles', () => {
    expect(isManualModelEndpoint('ollama')).toBe(true);
    expect(isManualModelEndpoint('vllm')).toBe(true);
    expect(isManualModelEndpoint('custom')).toBe(true);
    expect(isManualModelEndpoint('custom-relay-a')).toBe(true);
  });
  it('false for preset/OC-known providers', () => {
    expect(isManualModelEndpoint('openai')).toBe(false);
    expect(isManualModelEndpoint('deepseek')).toBe(false);
    expect(isManualModelEndpoint('minimax')).toBe(false);
  });
});

describe('resolveModelDef — manual contextWindow override', () => {
  it('honors a positive override and stamps contextWindowSource:manual', () => {
    const card = resolveModelDef('custom-relay', 'house-model', {
      contextWindowOverride: 96_000,
    });
    expect(card.contextWindow).toBe(96_000);
    expect(card.contextWindowSource).toBe('manual');
  });

  it('floors a fractional override and keeps it', () => {
    const card = resolveModelDef('ollama', 'qwen3', { contextWindowOverride: 40_000.7 });
    expect(card.contextWindow).toBe(40_000);
    expect(card.contextWindowSource).toBe('manual');
  });

  it('ignores a non-positive / non-finite override (no manual stamp)', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const card = resolveModelDef('custom', 'x', { contextWindowOverride: bad });
      expect(card.contextWindowSource).toBeUndefined();
    }
  });

  it('without an override the card carries no manual stamp', () => {
    const card = resolveModelDef('custom', 'x');
    expect(card.contextWindowSource).toBeUndefined();
    expect(card.contextWindow).toBe(32_000); // hard fallback, no preset/cache
  });

  it('override beats the OC catalog value', () => {
    setModelCatalogCache(ocModelsListAllPayload.models);
    // openai/gpt-5.4 resolves to 272K from the catalog; the override must win.
    const card = resolveModelDef('openai', 'gpt-5.4', { contextWindowOverride: 50_000 });
    expect(card.contextWindow).toBe(50_000);
    expect(card.contextWindowSource).toBe('manual');
  });
});

describe('validateModelTuning — 防蠢', () => {
  it('passes for a sane tuple', () => {
    expect(
      validateModelTuning({ contextWindow: 128_000, reserveTokens: 16_384, maxHistoryShare: 0.5 }),
    ).toEqual([]);
  });

  it('passes when fields are omitted', () => {
    expect(validateModelTuning({})).toEqual([]);
  });

  it('rejects a non-integer / out-of-range contextWindow', () => {
    expect(validateModelTuning({ contextWindow: 1024.5 }).map((i) => i.code)).toContain(
      'contextWindow.notInteger',
    );
    expect(validateModelTuning({ contextWindow: CONTEXT_WINDOW_MIN - 1 }).map((i) => i.code)).toContain(
      'contextWindow.outOfRange',
    );
    expect(validateModelTuning({ contextWindow: CONTEXT_WINDOW_MAX + 1 }).map((i) => i.code)).toContain(
      'contextWindow.outOfRange',
    );
  });

  it('accepts the exact bounds', () => {
    expect(validateModelTuning({ contextWindow: CONTEXT_WINDOW_MIN })).toEqual([]);
    expect(validateModelTuning({ contextWindow: CONTEXT_WINDOW_MAX })).toEqual([]);
  });

  it('enforces reserveTokens < contextWindow (usable budget must stay positive)', () => {
    const issues = validateModelTuning({ contextWindow: 16_000, reserveTokens: 16_000 });
    expect(issues.map((i) => i.code)).toContain('reserveTokens.exceedsWindow');
    expect(validateModelTuning({ contextWindow: 16_000, reserveTokens: 15_999 })).toEqual([]);
  });

  it('rejects a negative reserveTokens', () => {
    expect(validateModelTuning({ reserveTokens: -1 }).map((i) => i.code)).toContain(
      'reserveTokens.negative',
    );
  });

  it('keeps maxHistoryShare within OC range 0.1–0.9', () => {
    expect(validateModelTuning({ maxHistoryShare: 0.05 }).map((i) => i.code)).toContain(
      'maxHistoryShare.outOfRange',
    );
    expect(validateModelTuning({ maxHistoryShare: 0.95 }).map((i) => i.code)).toContain(
      'maxHistoryShare.outOfRange',
    );
    expect(validateModelTuning({ maxHistoryShare: 0.1 })).toEqual([]);
    expect(validateModelTuning({ maxHistoryShare: 0.9 })).toEqual([]);
  });
});

describe('buildSaveConfig — manual window + global compaction (拉通)', () => {
  const baseInput = (over: Partial<ConfigPatchInput> = {}): ConfigPatchInput => ({
    provider: 'custom-relay',
    baseUrl: 'https://relay.example.com/v1',
    api: 'openai-completions',
    apiKey: 'sk-test',
    textModel: 'house-model',
    profileLabel: 'House Relay',
    ...over,
  });

  it('writes the manual window onto the text card and stamps it', () => {
    const cfg = buildSaveConfig(null, baseInput({ customContextWindow: 96_000 }));
    const providers = (cfg.models as { providers: Record<string, { models: RcModelCard[] }> }).providers;
    const card = providers['custom-relay'].models[0];
    expect(card.contextWindow).toBe(96_000);
    expect(card.contextWindowSource).toBe('manual');
  });

  it('ignores customContextWindow for a preset (non-manual) provider', () => {
    const cfg = buildSaveConfig(
      null,
      baseInput({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', textModel: 'gpt-5.4', customContextWindow: 999_999, profileLabel: undefined }),
    );
    const providers = (cfg.models as { providers: Record<string, { models: RcModelCard[] }> }).providers;
    const card = providers.openai.models[0];
    expect(card.contextWindowSource).toBeUndefined();
    expect(card.contextWindow).not.toBe(999_999);
  });

  it('writes global compaction knobs and preserves mode:safeguard', () => {
    const cfg = buildSaveConfig(
      null,
      baseInput({ compactionReserveTokens: 24_000, compactionMaxHistoryShare: 0.6 }),
    );
    const compaction = (
      (cfg.agents as { defaults: { compaction: Record<string, unknown> } }).defaults.compaction
    );
    expect(compaction.reserveTokens).toBe(24_000);
    expect(compaction.maxHistoryShare).toBe(0.6);
    expect(compaction.mode).toBe('safeguard');
  });

  it('leaves compaction untouched when no knob is provided', () => {
    const cfg = buildSaveConfig(null, baseInput());
    const compaction = (
      (cfg.agents as { defaults: { compaction: Record<string, unknown> } }).defaults.compaction
    );
    expect(compaction).toEqual({ mode: 'safeguard' });
  });

  it('round-trips: manual card survives the startup aligner and reads back identically', () => {
    setModelCatalogCache(ocModelsListAllPayload.models);
    // Use an id OC knows under another provider so an auto card WOULD be re-aligned.
    const cfg = buildSaveConfig(
      null,
      baseInput({ textModel: 'gpt-5.4', customContextWindow: 64_000, compactionReserveTokens: 20_000, compactionMaxHistoryShare: 0.5 }),
    );

    // Startup aligner must not touch the manual card.
    const { config: aligned, changes } = alignConfigModels(cfg, ocModelsListAllPayload.models);
    expect(changes.find((c) => c.provider === 'custom-relay')).toBeUndefined();

    const providerFields = extractProviderFieldsForEditor(aligned, 'custom-relay');
    expect(providerFields?.contextWindow).toBe(64_000);
    expect(providerFields?.contextWindowManual).toBe(true);

    const fields = extractConfigFields(aligned);
    expect(fields.compactionReserveTokens).toBe(20_000);
    expect(fields.compactionMaxHistoryShare).toBe(0.5);
  });

  it('auto card under the same custom provider IS re-aligned (manual is opt-in)', () => {
    setModelCatalogCache(ocModelsListAllPayload.models);
    // No customContextWindow → no manual stamp → aligner may lift it.
    const cfg = buildSaveConfig(null, baseInput({ textModel: 'gpt-5.4' }));
    const { config: aligned } = alignConfigModels(cfg, ocModelsListAllPayload.models);
    const providers = (aligned.models as { providers: Record<string, { models: RcModelCard[] }> }).providers;
    expect(providers['custom-relay'].models[0].contextWindow).toBe(272_000);
  });
});
