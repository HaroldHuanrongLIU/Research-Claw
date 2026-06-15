import { create } from 'zustand';
import { message } from 'antd';
import i18n from '../i18n';
import { useGatewayStore } from './gateway';
import {
  alignConfigModels,
  type OcModelCatalogEntry,
} from '../utils/oc-catalog-align';
import { serializeConfigForGatewayApply, isManualModelEndpoint } from '../utils/config-patch';
import { setModelCatalogCache } from '../utils/catalog-cache';

/**
 * Startup-once alignment of RC config model cards against OpenClaw's authoritative
 * model catalog (gateway `models.list`). OC's catalog is the source of truth for
 * contextWindow / input / reasoning; RC's hand-written cards drift from it, and a
 * wrong contextWindow mis-sizes the preemptive-compaction trigger.
 *
 * Flow (runs after boot reaches 'ready', i.e. config.get has completed):
 *   1. fetch OC catalog (short timeout, silent degradation on failure)
 *   2. fetch current config, align every card (pure compute)
 *   3. if anything changed → config.apply (full replace + gateway restart) once
 *
 * Idempotent: once a clean alignment pass completes (changes 0 or N), `aligned`
 * is set and further triggers are no-ops. The post-write-back restart reconnects
 * and re-triggers this, but the second pass finds zero diff and skips the write.
 * `api` is never touched — that field is owned by the protocol probe.
 */
const CATALOG_FETCH_TIMEOUT_MS = 8_000;

interface ConfigGetSnapshot {
  parsed?: Record<string, unknown>;
  config?: Record<string, unknown>;
  hash?: string;
}

interface ModelCatalogState {
  catalog: OcModelCatalogEntry[] | null;
  /** A full clean alignment pass has completed this session. */
  aligned: boolean;
  /** An alignment pass is in flight (guards against concurrent re-entry). */
  aligning: boolean;
  fetchCatalog: () => Promise<OcModelCatalogEntry[] | null>;
  alignConfigOnStartup: () => Promise<void>;
}

export const useModelCatalogStore = create<ModelCatalogState>((set, get) => ({
  catalog: null,
  aligned: false,
  aligning: false,

  fetchCatalog: async () => {
    const client = useGatewayStore.getState().client;
    if (!client?.isConnected) return null;
    try {
      const res = await client.request<{ models?: OcModelCatalogEntry[] }>(
        'models.list',
        { view: 'all' },
        { timeoutMs: CATALOG_FETCH_TIMEOUT_MS },
      );
      const catalog = Array.isArray(res?.models) ? res.models : [];
      set({ catalog });
      setModelCatalogCache(catalog);
      return catalog;
    } catch (e) {
      console.warn('[model-catalog] models.list fetch failed; skipping alignment', e);
      return null;
    }
  },

  alignConfigOnStartup: async () => {
    const { aligned, aligning } = get();
    if (aligned || aligning) return;
    const client = useGatewayStore.getState().client;
    if (!client?.isConnected) return;

    set({ aligning: true });
    try {
      const catalog = get().catalog ?? (await get().fetchCatalog());
      if (!catalog || catalog.length === 0) return; // leave aligned=false → retry next boot

      const snap = await client.request<ConfigGetSnapshot>('config.get', {});
      const current = (snap.parsed ?? snap.config ?? {}) as Record<string, unknown>;
      const { config, changes } = alignConfigModels(current, catalog, isManualModelEndpoint);

      if (changes.length > 0) {
        await client.request('config.apply', {
          raw: serializeConfigForGatewayApply(config),
          baseHash: snap.hash,
        });
        message.success(i18n.t('modelCatalog.aligned', { count: changes.length }));
      }
      set({ aligned: true });
    } catch (e) {
      // Network/RPC failure: keep aligned=false so a later reconnect can retry.
      console.warn('[model-catalog] startup alignment failed', e);
    } finally {
      set({ aligning: false });
    }
  },
}));
