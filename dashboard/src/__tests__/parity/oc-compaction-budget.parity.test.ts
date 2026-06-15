import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compactionCanRecover,
  OC_DEFAULT_CONTEXT_WINDOW,
} from '../../utils/config-patch';

/**
 * Parity: the dashboard predicts whether OpenClaw's self-compaction can recover
 * for a given (contextWindow, maxHistoryShare) so it can (a) pick a safe default
 * window for custom/local cards and (b) warn before a user pins a budget that
 * loops forever ("自压实未能恢复"). That prediction must mirror OC's real math.
 *
 * OC owns these numbers (keep in sync — OC can't be imported from the dashboard):
 *   - DEFAULT_CONTEXT_TOKENS                       openclaw/src/agents/defaults.ts:6
 *   - DEFAULT_AGENT_COMPACTION_RESERVE_TOKENS_FLOOR openclaw/src/agents/agent-settings.ts:8
 *   - MIN_PROMPT_BUDGET_TOKENS / _RATIO            openclaw/src/agents/agent-compaction-constants.ts:6,12
 *   - SAFETY_MARGIN                                openclaw/src/agents/compaction-planning.ts:9
 *   - default maxHistoryShare (non-handoff)        openclaw/src/agents/compaction-planning.ts (pruneHistoryForContextShare)
 *
 * The hardcoded mirror below is the source of truth for standalone (research-claw)
 * CI, where the openclaw submodule is absent. When the monorepo checkout HAS the
 * submodule, the final block reads OC's actual source and fails on any drift.
 */
const OC = {
  DEFAULT_CONTEXT_TOKENS: 200_000,
  RESERVE_TOKENS_FLOOR: 20_000,
  MIN_PROMPT_BUDGET_TOKENS: 8_000,
  MIN_PROMPT_BUDGET_RATIO: 0.5,
  SAFETY_MARGIN: 1.2,
  DEFAULT_MAX_HISTORY_SHARE: 0.5,
};

/**
 * Independent reference re-derived straight from OC's two thresholds:
 *   promptBudget  = cw − min(reserveFloor, cw − minPromptBudget)   (preemptive-compaction.ts)
 *   historyTarget = cw × share × SAFETY_MARGIN                     (compaction-planning.ts buildHistoryPrunePlan)
 * Recovery is possible only when the pruned history fits strictly under the budget.
 */
function referenceCanRecover(cw: number, share = OC.DEFAULT_MAX_HISTORY_SHARE): boolean {
  if (!Number.isFinite(cw) || cw <= 0) return false;
  const minPromptBudget = Math.min(
    OC.MIN_PROMPT_BUDGET_TOKENS,
    Math.max(1, Math.floor(cw * OC.MIN_PROMPT_BUDGET_RATIO)),
  );
  const effectiveReserve = Math.min(OC.RESERVE_TOKENS_FLOOR, Math.max(0, cw - minPromptBudget));
  const promptBudget = Math.max(1, cw - effectiveReserve);
  const historyTarget = Math.floor(cw * share * OC.SAFETY_MARGIN);
  return historyTarget < promptBudget;
}

describe('compactionCanRecover ≡ OC compaction budget math', () => {
  it('our default window equals OC DEFAULT_CONTEXT_TOKENS', () => {
    expect(OC_DEFAULT_CONTEXT_WINDOW).toBe(OC.DEFAULT_CONTEXT_TOKENS);
  });

  it('matches the OC-derived reference across a window × share sweep', () => {
    const windows = [8_192, 16_000, 24_000, 32_000, 40_000, 50_000, 60_000, 128_000, 200_000, 1_000_000, 2_000_000];
    const shares = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    for (const cw of windows) {
      for (const share of shares) {
        expect(compactionCanRecover(cw, share)).toBe(referenceCanRecover(cw, share));
      }
      expect(compactionCanRecover(cw)).toBe(referenceCanRecover(cw)); // default share
    }
  });

  it('the OC-aligned default never loops at OC defaults; the old 32K window does', () => {
    expect(referenceCanRecover(OC.DEFAULT_CONTEXT_TOKENS)).toBe(true);
    expect(referenceCanRecover(32_000)).toBe(false);
  });
});

// Live cross-check: only when the openclaw submodule is checked out beside us.
const OC_AGENTS = resolve(process.cwd(), '../../openclaw/src/agents');
const ocPresent = existsSync(resolve(OC_AGENTS, 'defaults.ts'));

function num(file: string, name: string): number {
  const src = readFileSync(resolve(OC_AGENTS, file), 'utf8');
  const m = src.match(new RegExp(`${name}\\s*=\\s*([0-9_.]+)`));
  if (!m) throw new Error(`${name} not found in ${file}`);
  return Number(m[1].replace(/_/g, ''));
}

describe.skipIf(!ocPresent)('mirror equals live openclaw source', () => {
  it('OC constants have not drifted from our hardcoded mirror', () => {
    expect(num('defaults.ts', 'DEFAULT_CONTEXT_TOKENS')).toBe(OC.DEFAULT_CONTEXT_TOKENS);
    expect(num('agent-settings.ts', 'DEFAULT_AGENT_COMPACTION_RESERVE_TOKENS_FLOOR')).toBe(OC.RESERVE_TOKENS_FLOOR);
    expect(num('agent-compaction-constants.ts', 'MIN_PROMPT_BUDGET_TOKENS')).toBe(OC.MIN_PROMPT_BUDGET_TOKENS);
    expect(num('agent-compaction-constants.ts', 'MIN_PROMPT_BUDGET_RATIO')).toBe(OC.MIN_PROMPT_BUDGET_RATIO);
    expect(num('compaction-planning.ts', 'SAFETY_MARGIN')).toBe(OC.SAFETY_MARGIN);
  });
});
