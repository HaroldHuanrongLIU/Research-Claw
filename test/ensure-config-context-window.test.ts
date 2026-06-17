/**
 * ensure-config.cjs context-window floor migration (items 18 & 19)
 *
 * Reproduces the old-user regression for Problem 3: a user who saved a MANUAL
 * endpoint (local ollama/vllm or a custom-* API profile) with a context window
 * below the 64000 floor would, after upgrade, still overflow OpenClaw's turn-1
 * precheck (window − 16384 reserve < ~20.1K base prompt) on the very first
 * "你好". The dashboard only clamps on re-save, and the not-dirty form blocks the
 * Save button — so the fix has to land at startup, on disk, via ensure-config.
 *
 * These tests drive the REAL script (no mock) and assert:
 *   - sub-floor MANUAL windows are raised to 64000
 *   - PRESET/OC-known windows are never inflated (their real catalog size stands)
 *   - at-or-above-floor windows are untouched
 *   - stale reserveTokens/reserveTokensFloor/maxHistoryShare are stripped
 *   - the migration is idempotent (value stable across two boot cycles)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const ENSURE_CONFIG = path.resolve(__dirname, '../scripts/ensure-config.cjs');
const FLOOR = 64000;

type ModelDef = { id: string; contextWindow?: number };

function makeConfig(opts?: {
  reserveTokens?: number;
  reserveTokensFloor?: number;
  maxHistoryShare?: number;
}) {
  const compaction: Record<string, unknown> = { mode: 'safeguard' };
  if (opts?.reserveTokens !== undefined) compaction.reserveTokens = opts.reserveTokens;
  if (opts?.reserveTokensFloor !== undefined) compaction.reserveTokensFloor = opts.reserveTokensFloor;
  if (opts?.maxHistoryShare !== undefined) compaction.maxHistoryShare = opts.maxHistoryShare;
  return {
    agents: { defaults: { compaction } },
    models: {
      providers: {
        // Manual: custom-* API profile pinned below the floor (the real regression)
        'custom-relay': { baseUrl: 'https://example/v1', api: 'openai', models: [{ id: 'gpt-x', contextWindow: 32000 }] },
        // Manual: local ollama pinned far below the floor
        ollama: { baseUrl: 'http://localhost:11434', api: 'ollama', models: [{ id: 'qwen', contextWindow: 8192 }] },
        // Manual: custom already above the floor — must stay put
        'custom-big': { baseUrl: 'https://big/v1', api: 'openai', models: [{ id: 'm', contextWindow: 128000 }] },
        // Preset/OC-known: a legitimately small catalog window — must NOT be inflated
        openai: { baseUrl: 'https://api.openai.com/v1', api: 'openai', models: [{ id: 'small', contextWindow: 16000 }] },
      },
    },
  };
}

function windowsOf(configPath: string): Record<string, number | undefined> {
  const c = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const out: Record<string, number | undefined> = {};
  for (const [key, prov] of Object.entries<any>(c.models.providers)) {
    out[key] = (prov.models as ModelDef[])[0]?.contextWindow;
  }
  return out;
}

function compactionOf(configPath: string): Record<string, unknown> {
  const c = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return c.agents?.defaults?.compaction ?? {};
}

describe('ensure-config.cjs — context window floor migration', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    // Project layout: <root>/config/openclaw.json (NOT under ~/.openclaw → isGlobal=false)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-ctxwin-test-'));
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    configPath = path.join(configDir, 'openclaw.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('raises sub-floor MANUAL windows to 64000 and leaves preset windows alone', () => {
    fs.writeFileSync(configPath, JSON.stringify(makeConfig(), null, 2));

    execFileSync('node', [ENSURE_CONFIG, configPath]);
    const w = windowsOf(configPath);

    expect(w['custom-relay']).toBe(FLOOR); // 32000 → 64000 (the regression case)
    expect(w.ollama).toBe(FLOOR); // 8192 → 64000
    expect(w['custom-big']).toBe(128000); // already above floor — untouched
    expect(w.openai).toBe(16000); // preset/OC-known — NOT inflated
  });

  it('strips stale reserveTokens / reserveTokensFloor / maxHistoryShare', () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify(makeConfig({ reserveTokens: 12000, reserveTokensFloor: 12000, maxHistoryShare: 0.3 }), null, 2),
    );

    execFileSync('node', [ENSURE_CONFIG, configPath]);
    const compaction = compactionOf(configPath);

    expect(compaction.reserveTokens).toBeUndefined();
    expect(compaction.reserveTokensFloor).toBeUndefined();
    expect(compaction.maxHistoryShare).toBeUndefined();
    expect(compaction.mode).toBe('safeguard'); // unrelated keys preserved
  });

  it('is idempotent — a second boot cycle keeps every window stable', () => {
    fs.writeFileSync(configPath, JSON.stringify(makeConfig(), null, 2));

    execFileSync('node', [ENSURE_CONFIG, configPath]);
    const afterFirst = windowsOf(configPath);
    execFileSync('node', [ENSURE_CONFIG, configPath]);
    const afterSecond = windowsOf(configPath);

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond['custom-relay']).toBe(FLOOR);
    expect(afterSecond.openai).toBe(16000);
  });

  it('leaves a manual window exactly at the floor untouched', () => {
    const cfg = makeConfig();
    cfg.models.providers['custom-relay'].models[0].contextWindow = FLOOR;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    execFileSync('node', [ENSURE_CONFIG, configPath]);
    expect(windowsOf(configPath)['custom-relay']).toBe(FLOOR);
  });

  it('does not invent a window for a manual model that has none', () => {
    const cfg = makeConfig();
    delete cfg.models.providers.ollama.models[0].contextWindow;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    execFileSync('node', [ENSURE_CONFIG, configPath]);
    expect(windowsOf(configPath).ollama).toBeUndefined();
  });
});
