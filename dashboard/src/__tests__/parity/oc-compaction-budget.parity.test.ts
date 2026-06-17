import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import {
  compactionCanRecover,
  CONTEXT_WINDOW_MIN,
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

// ── Turn-1 overflow parity: drive OC's REAL preemptive-compaction precheck ──
// The recoverability math above governs whether *self-compaction* loops; this
// block proves the orthogonal turn-1 failure (a NEW "你好" session overflowing
// before any history exists) and that the CONTEXT_WINDOW_MIN floor flips OC's real
// decision from overflow → fits. The earlier adaptive-reserve approach was removed:
// OC pins the turn-1 precheck reserve at its own default (getCompactionReserveTokens()
// ?? 16384), ignoring agents.defaults.compaction.reserveTokens in the embedded path,
// so the only lever that moves the precheck is the context window itself. Verified
// live: at window=32000 OC logged estimatedPromptTokens=20129 / reserveTokens=16384
// / "Context overflow ... (precheck)"; at window=40000 the same turn passed.
// Gated on the installed openclaw package (absent in standalone CI).
type OcRuntime = {
  shouldPreemptivelyCompactBeforePrompt: (args: {
    messages: unknown[];
    systemPrompt: string;
    prompt: string;
    contextTokenBudget: number;
    reserveTokens: number;
  }) => { route: string };
  estimateRenderedLlmBoundaryTokenPressure: (args: { systemPrompt: string; prompt: string }) => number;
};
let oc: OcRuntime | null = null;
try {
  oc = createRequire(import.meta.url)('openclaw/plugin-sdk/agent-harness-runtime') as OcRuntime;
} catch {
  oc = null;
}

// OC's turn-1 precheck reserve default, mirrored from the sessions runtime
// getCompactionReserveTokens(): `return this.settings.compaction?.reserveTokens ?? 16384`.
// This is NOT the 20000 self-compaction floor above — it is a separate, lower
// default that governs the turn-1 precheck and is unaffected by RC config.
const OC_TURN1_PRECHECK_RESERVE_TOKENS = 16_384;
// RC's real turn-1 base prompt (system prompt + tools, no history), measured live
// against the gateway with the default skill/tool set (estimatedPromptTokens=20129).
// The floor must clear this at OC's fixed precheck reserve.
const RC_REAL_BASE_PROMPT_TOKENS = 20_129;

describe('CONTEXT_WINDOW_MIN clears OC turn-1 precheck arithmetic', () => {
  it('the floor leaves room for the real base prompt at OC default precheck reserve', () => {
    // window − reserve ≥ base prompt, with headroom left over for the first message.
    const headroom = CONTEXT_WINDOW_MIN - OC_TURN1_PRECHECK_RESERVE_TOKENS - RC_REAL_BASE_PROMPT_TOKENS;
    expect(headroom).toBeGreaterThanOrEqual(0);
    // The old 32K floor did NOT clear it (negative headroom → turn-1 overflow).
    expect(32_000 - OC_TURN1_PRECHECK_RESERVE_TOKENS - RC_REAL_BASE_PROMPT_TOKENS).toBeLessThan(0);
  });
});

describe.skipIf(!oc)("CONTEXT_WINDOW_MIN flips OC's real turn-1 precheck (overflow → fits)", () => {
  // Calibrate a synthetic system prompt to RC's real base-prompt size so we drive
  // OC's actual estimator + route logic (not a mock) at ≥ the measured 20129 tokens.
  const systemPrompt = 'x'.repeat(70_000);
  const prompt = '你好';
  const precheck = (contextTokenBudget: number) =>
    oc!.shouldPreemptivelyCompactBeforePrompt({
      messages: [],
      systemPrompt,
      prompt,
      contextTokenBudget,
      reserveTokens: OC_TURN1_PRECHECK_RESERVE_TOKENS,
    }).route;

  it('the synthetic prompt is calibrated to at least the real base-prompt size', () => {
    expect(oc!.estimateRenderedLlmBoundaryTokenPressure({ systemPrompt, prompt })).toBeGreaterThanOrEqual(
      RC_REAL_BASE_PROMPT_TOKENS,
    );
  });

  it('the old 32K floor overflows turn-1, but CONTEXT_WINDOW_MIN fits — at OC fixed reserve', () => {
    expect(precheck(32_000)).not.toBe('fits');
    expect(precheck(CONTEXT_WINDOW_MIN)).toBe('fits');
  });

  it('a mainstream large window already fits at OC default reserve (RC writes no override)', () => {
    expect(precheck(OC_DEFAULT_CONTEXT_WINDOW)).toBe('fits');
  });
});
