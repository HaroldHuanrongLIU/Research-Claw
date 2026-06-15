import { describe, it, expect, afterEach } from 'vitest';
import { resolveModelDef } from './config-patch';
import { setModelCatalogCache, getModelCatalogCache } from './catalog-cache';
import { ocModelsListAllPayload } from '../__fixtures__/gateway-payloads/oc-model-catalog';

afterEach(() => setModelCatalogCache(null));

describe('catalog cache', () => {
  it('round-trips and treats an empty array as null', () => {
    expect(getModelCatalogCache()).toBeNull();
    setModelCatalogCache(ocModelsListAllPayload.models);
    expect(getModelCatalogCache()).toHaveLength(ocModelsListAllPayload.models.length);
    setModelCatalogCache([]);
    expect(getModelCatalogCache()).toBeNull();
  });
});

describe('resolveModelDef catalog priority', () => {
  it('without cache falls back to the static preset value', () => {
    const card = resolveModelDef('openai', 'gpt-5.4');
    expect(card.contextWindow).toBe(128_000); // stale static preset
  });

  it('with cache, OC catalog overrides the static preset', () => {
    setModelCatalogCache(ocModelsListAllPayload.models);
    const card = resolveModelDef('openai', 'gpt-5.4');
    expect(card.contextWindow).toBe(272_000); // OC authoritative
  });

  it('with cache, a model absent from the static preset escapes the 32K fallback via basename', () => {
    setModelCatalogCache(ocModelsListAllPayload.models);
    const card = resolveModelDef('zai-coding', 'glm-5v-turbo');
    expect(card.contextWindow).toBe(202_800);
  });

  it('with cache, keeps the static preset for a card OC cannot match (no case-folded basename pull)', () => {
    // OC's catalog only has lowercase `minimax-m2.7` (novita=1M); the exact id
    // `MiniMax-M2.7` is a case-sensitive miss, so the static 200K preset must win
    // rather than being inflated to novita's 1M.
    setModelCatalogCache(ocModelsListAllPayload.models);
    const card = resolveModelDef('minimax', 'MiniMax-M2.7');
    expect(card.contextWindow).toBe(200_000);
  });

  it('with cache, a model neither preset nor OC knows still gets the OC-default fallback', () => {
    setModelCatalogCache(ocModelsListAllPayload.models);
    const card = resolveModelDef('faux-provider', 'totally-unknown-model-xyz');
    expect(card.contextWindow).toBe(200_000); // OC-aligned hard fallback (DEFAULT_CONTEXT_TOKENS)
  });
});
