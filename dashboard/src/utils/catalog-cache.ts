import type { OcModelCatalogEntry } from './oc-catalog-align';

/**
 * Process-wide cache of OpenClaw's authoritative model catalog, populated once at
 * startup by the model-catalog store. `resolveModelDef` reads it so that cards
 * built during interactive saves carry OC's authoritative contextWindow/input
 * instead of the stale static preset or the 32K fallback.
 *
 * Kept as a tiny standalone module (not a store import) so the pure config-patch
 * util stays free of a store dependency and no import cycle forms.
 */
let cache: OcModelCatalogEntry[] | null = null;

export function setModelCatalogCache(entries: OcModelCatalogEntry[] | null): void {
  cache = entries && entries.length > 0 ? entries : null;
}

export function getModelCatalogCache(): OcModelCatalogEntry[] | null {
  return cache;
}
