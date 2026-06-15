import { describe, it, expect } from 'vitest';
import {
  alignCardWithCatalog,
  alignConfigModels,
  findCatalogEntry,
  type OcModelCatalogEntry,
  type RcModelCard,
} from './oc-catalog-align';
import { ocModelsListAllPayload } from '../__fixtures__/gateway-payloads/oc-model-catalog';

const catalog = ocModelsListAllPayload.models;

// RC config cards as shipped in research-claw/config/openclaw.json.
const RC_CARDS: Record<string, { provider: string; card: RcModelCard }> = {
  deepseek: {
    provider: 'deepseek',
    card: {
      id: 'deepseek-v4-pro',
      name: 'deepseek-v4-pro',
      reasoning: true,
      input: ['text'],
      contextWindow: 1_000_000,
      maxTokens: 384_000,
    },
  },
  openai: {
    provider: 'openai',
    card: {
      id: 'gpt-5.4',
      name: 'gpt-5.4',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 128_000,
      maxTokens: 16_384,
    },
  },
  zai: {
    provider: 'zai-coding',
    card: {
      id: 'glm-5v-turbo',
      name: 'glm-5v-turbo',
      reasoning: false,
      input: ['text', 'image'],
      contextWindow: 32_000,
      maxTokens: 16_384,
    },
  },
  minimax: {
    provider: 'minimax',
    card: {
      id: 'MiniMax-M2.7',
      name: 'MiniMax-M2.7',
      reasoning: true,
      input: ['text'],
      contextWindow: 200_000,
      maxTokens: 8_192,
    },
  },
};

describe('findCatalogEntry', () => {
  it('prefers an exact provider+id match over other providers exposing the same id', () => {
    // gpt-5.4 lives under both github-copilot (128K) and openai (272K).
    const hit = findCatalogEntry('openai', 'gpt-5.4', catalog);
    expect(hit?.matched).toBe('exact');
    expect(hit?.entry.provider).toBe('openai');
    expect(hit?.entry.contextWindow).toBe(272_000);
  });

  it('falls back to a basename match when the provider key differs (zai-coding → zai)', () => {
    const hit = findCatalogEntry('zai-coding', 'glm-5v-turbo', catalog);
    expect(hit?.matched).toBe('basename');
    expect(hit?.entry.provider).toBe('zai');
    expect(hit?.entry.contextWindow).toBe(202_800);
  });

  it('returns null for a model OC has never heard of', () => {
    expect(findCatalogEntry('minimax', 'MiniMax-M2.7', catalog)).toBeNull();
  });

  it('on a basename collision picks the largest contextWindow', () => {
    const synthetic: OcModelCatalogEntry[] = [
      { id: 'x', provider: 'a', contextWindow: 100 },
      { id: 'x', provider: 'b', contextWindow: 900 },
      { id: 'x', provider: 'c', contextWindow: 500 },
    ];
    const hit = findCatalogEntry('unknown', 'x', synthetic);
    expect(hit?.matched).toBe('basename');
    expect(hit?.entry.provider).toBe('b');
    expect(hit?.entry.contextWindow).toBe(900);
  });
});

describe('alignCardWithCatalog — real RC models against OC 2026.6.1', () => {
  it('deepseek/deepseek-v4-pro: 1M already authoritative → unchanged', () => {
    const { provider, card } = RC_CARDS.deepseek;
    const r = alignCardWithCatalog(provider, card, catalog);
    expect(r.matched).toBe('exact');
    expect(r.changed).toBe(false);
    expect(r.after.contextWindow).toBe(1_000_000);
    expect(r.card.maxTokens).toBe(384_000); // RC-only field preserved
    expect(r.card.reasoning).toBe(true); // OC entry carries no reasoning → keep RC
  });

  it('openai/gpt-5.4: stale 128K → OC 272K', () => {
    const { provider, card } = RC_CARDS.openai;
    const r = alignCardWithCatalog(provider, card, catalog);
    expect(r.matched).toBe('exact');
    expect(r.changed).toBe(true);
    expect(r.before.contextWindow).toBe(128_000);
    expect(r.after.contextWindow).toBe(272_000);
    expect(r.card.maxTokens).toBe(16_384);
  });

  it('zai-coding/glm-5v-turbo: stale 32K → OC 202.8K via basename', () => {
    const { provider, card } = RC_CARDS.zai;
    const r = alignCardWithCatalog(provider, card, catalog);
    expect(r.matched).toBe('basename');
    expect(r.changed).toBe(true);
    expect(r.before.contextWindow).toBe(32_000);
    expect(r.after.contextWindow).toBe(202_800);
    expect(r.card.reasoning).toBe(false); // unchanged
  });

  it('minimax/MiniMax-M2.7: not in OC catalog → all values preserved', () => {
    const { provider, card } = RC_CARDS.minimax;
    const r = alignCardWithCatalog(provider, card, catalog);
    expect(r.matched).toBe('none');
    expect(r.changed).toBe(false);
    expect(r.card.contextWindow).toBe(200_000);
    expect(r.card.maxTokens).toBe(8_192);
    expect(r.card).toEqual(card); // identical content
  });
});

describe('alignCardWithCatalog — field-level rules', () => {
  it('adopts reasoning only when the OC entry carries it', () => {
    const withReasoning: OcModelCatalogEntry[] = [
      { id: 'm', provider: 'p', contextWindow: 50_000, reasoning: true },
    ];
    const card: RcModelCard = { id: 'm', reasoning: false, contextWindow: 10_000 };
    const r = alignCardWithCatalog('p', card, withReasoning);
    expect(r.card.reasoning).toBe(true);
    expect(r.card.contextWindow).toBe(50_000);
    expect(r.changed).toBe(true);
  });

  it('keeps RC reasoning when the OC entry omits it', () => {
    const noReasoning: OcModelCatalogEntry[] = [
      { id: 'm', provider: 'p', contextWindow: 10_000 },
    ];
    const card: RcModelCard = { id: 'm', reasoning: true, contextWindow: 10_000 };
    const r = alignCardWithCatalog('p', card, noReasoning);
    expect(r.card.reasoning).toBe(true);
    expect(r.changed).toBe(false);
  });

  it('keeps RC contextWindow when the OC entry has neither contextWindow nor contextTokens', () => {
    const noCtx: OcModelCatalogEntry[] = [
      { id: 'm', provider: 'p', input: ['text'] },
    ];
    const card: RcModelCard = { id: 'm', contextWindow: 12_345, input: ['text'] };
    const r = alignCardWithCatalog('p', card, noCtx);
    expect(r.matched).toBe('exact');
    expect(r.after.contextWindow).toBe(12_345);
    expect(r.changed).toBe(false);
  });

  it('accepts contextTokens as a contextWindow alias', () => {
    const aliased: OcModelCatalogEntry[] = [
      { id: 'm', provider: 'p', contextTokens: 64_000 },
    ];
    const card: RcModelCard = { id: 'm', contextWindow: 8_000 };
    const r = alignCardWithCatalog('p', card, aliased);
    expect(r.after.contextWindow).toBe(64_000);
  });

  it('never mutates the input card', () => {
    const card: RcModelCard = { id: 'gpt-5.4', contextWindow: 128_000 };
    const snapshot = JSON.parse(JSON.stringify(card));
    alignCardWithCatalog('openai', card, catalog);
    expect(card).toEqual(snapshot);
  });

  it('aligning an already-aligned card is a no-op (idempotent)', () => {
    const { provider, card } = RC_CARDS.openai;
    const first = alignCardWithCatalog(provider, card, catalog);
    const second = alignCardWithCatalog(provider, first.card, catalog);
    expect(second.changed).toBe(false);
    expect(second.card).toEqual(first.card);
  });
});

describe('alignConfigModels — whole-config alignment against OC 2026.6.1', () => {
  // The shipped research-claw/config/openclaw.json model section.
  function makeConfig(): Record<string, unknown> {
    return {
      models: {
        providers: {
          minimax: {
            api: 'anthropic-messages',
            models: [
              { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7', api: 'anthropic-messages', reasoning: true, input: ['text'], contextWindow: 200_000, maxTokens: 8_192 },
            ],
          },
          openai: {
            api: 'openai-chatgpt-responses',
            models: [
              { id: 'gpt-5.4', name: 'gpt-5.4', reasoning: true, input: ['text', 'image'], contextWindow: 128_000, maxTokens: 16_384 },
            ],
          },
          deepseek: {
            api: 'openai-completions',
            models: [
              { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', reasoning: true, input: ['text'], contextWindow: 1_000_000, maxTokens: 384_000 },
            ],
          },
          'zai-coding': {
            api: 'openai-completions',
            models: [
              { id: 'glm-5v-turbo', name: 'glm-5v-turbo', reasoning: false, input: ['text', 'image'], contextWindow: 32_000, maxTokens: 16_384 },
            ],
          },
        },
      },
    };
  }

  it('aligns exactly the two stale models, leaves the rest untouched', () => {
    const cfg = makeConfig();
    const { config, changes } = alignConfigModels(cfg, catalog);

    const byId = Object.fromEntries(changes.map((c) => [c.id, c]));
    expect(Object.keys(byId).sort()).toEqual(['glm-5v-turbo', 'gpt-5.4']);
    expect(byId['gpt-5.4']).toMatchObject({ before: 128_000, after: 272_000, matched: 'exact' });
    expect(byId['glm-5v-turbo']).toMatchObject({ before: 32_000, after: 202_800, matched: 'basename' });

    const providers = (config.models as { providers: Record<string, { models: RcModelCard[] }> }).providers;
    expect(providers.openai.models[0].contextWindow).toBe(272_000);
    expect(providers['zai-coding'].models[0].contextWindow).toBe(202_800);
    // Unchanged models keep their values.
    expect(providers.deepseek.models[0].contextWindow).toBe(1_000_000);
    expect(providers.minimax.models[0].contextWindow).toBe(200_000);
    // api field is never touched.
    expect(providers.openai.models[0].api).toBeUndefined();
    expect(providers.minimax.models[0].api).toBe('anthropic-messages');
    // maxTokens preserved.
    expect(providers.openai.models[0].maxTokens).toBe(16_384);
  });

  it('does not mutate the input config (pure)', () => {
    const cfg = makeConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    alignConfigModels(cfg, catalog);
    expect(cfg).toEqual(snapshot);
  });

  it('is idempotent: a second pass yields zero changes', () => {
    const cfg = makeConfig();
    const first = alignConfigModels(cfg, catalog);
    const second = alignConfigModels(first.config, catalog);
    expect(second.changes).toHaveLength(0);
    expect(second.config).toEqual(first.config);
  });

  it('an already-aligned config reports no changes on first pass', () => {
    const cfg = makeConfig();
    const providers = (cfg.models as { providers: Record<string, { models: RcModelCard[] }> }).providers;
    providers.openai.models[0].contextWindow = 272_000;
    providers['zai-coding'].models[0].contextWindow = 202_800;
    const { changes } = alignConfigModels(cfg, catalog);
    expect(changes).toHaveLength(0);
  });

  it('tolerates a config with no models.providers', () => {
    expect(alignConfigModels({}, catalog).changes).toHaveLength(0);
    expect(alignConfigModels({ models: {} }, catalog).changes).toHaveLength(0);
  });
});

describe('alignCardWithCatalog — manual-endpoint windows are never re-aligned', () => {
  it('skips a manual-endpoint card even when OC has an authoritative match (would otherwise change)', () => {
    // gpt-5.4 under openai is an exact 272K match — a normal card would be lifted
    // from 128K to 272K. The injected predicate marks the provider as a manual
    // endpoint (user-owned window), so the card is frozen.
    const card: RcModelCard = { id: 'gpt-5.4', contextWindow: 128_000 };
    const r = alignCardWithCatalog('openai', card, catalog, () => true);
    expect(r.changed).toBe(false);
    expect(r.matched).toBe('none');
    expect(r.card.contextWindow).toBe(128_000);
  });

  it('still aligns a card whose provider is NOT a manual endpoint', () => {
    const card: RcModelCard = { id: 'gpt-5.4', contextWindow: 128_000 };
    // Default predicate treats nothing as manual → normal alignment applies.
    const r = alignCardWithCatalog('openai', card, catalog);
    expect(r.changed).toBe(true);
    expect(r.card.contextWindow).toBe(272_000);
  });

  it('alignConfigModels skips manual-endpoint providers while aligning preset ones', () => {
    const cfg: Record<string, unknown> = {
      models: {
        providers: {
          'custom-relay': {
            api: 'openai-completions',
            models: [
              { id: 'gpt-5.4', name: 'My Relay', contextWindow: 64_000, maxTokens: 16_384 },
            ],
          },
          openai: {
            api: 'openai-chatgpt-responses',
            models: [
              { id: 'gpt-5.4', name: 'gpt-5.4', contextWindow: 128_000, maxTokens: 16_384 },
            ],
          },
        },
      },
    };
    // Provider key is the source of truth: custom-relay is a manual endpoint, openai is not.
    const isManual = (provider: string) => provider === 'custom-relay';
    const { config, changes } = alignConfigModels(cfg, catalog, isManual);
    const providers = (config.models as { providers: Record<string, { models: RcModelCard[] }> }).providers;
    // Manual-endpoint card frozen at 64K; only the preset openai card is aligned to 272K.
    expect(providers['custom-relay'].models[0].contextWindow).toBe(64_000);
    expect(providers.openai.models[0].contextWindow).toBe(272_000);
    expect(changes.map((c) => c.provider)).toEqual(['openai']);
  });
});
