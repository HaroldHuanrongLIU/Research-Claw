import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error — plain .mjs module without types
import { computeRunUsage } from '../scripts/farewell-usage.mjs';

const SCRIPTS = fileURLToPath(new URL('../scripts', import.meta.url));
const FAREWELL = join(SCRIPTS, 'farewell.sh');

const START_MS = 1_700_000_000_000;

function line(opts: {
  role?: string;
  tsMs: number;
  usage?: Record<string, unknown>;
}) {
  const iso = new Date(opts.tsMs).toISOString();
  return JSON.stringify({
    type: 'message',
    timestamp: iso,
    message: { role: opts.role ?? 'assistant', timestamp: iso, usage: opts.usage },
  });
}

function usage(input: number, output: number, extra: Record<string, unknown> = {}) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    reasoningTokens: 0,
    // totalTokens is cumulative context size — intentionally large to prove it is NOT summed.
    totalTokens: 100000 + input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...extra,
  };
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rc-farewell-'));

  // Session A: recent mtime, two in-window messages + one pre-start + one no-usage + malformed.
  const a = join(dir, 'a.jsonl');
  writeFileSync(
    a,
    [
      line({ tsMs: START_MS + 1000, usage: usage(100, 50, { cacheRead: 1000, cost: { total: 0.01 } }) }),
      line({ tsMs: START_MS + 2000, usage: usage(200, 80, { cacheRead: 2000, cost: { total: 0.02 } }) }),
      line({ tsMs: START_MS - 5000, usage: usage(9999, 9999) }), // before start → excluded
      line({ role: 'user', tsMs: START_MS + 3000 }), // no usage → ignored
      '{ not valid json',
    ].join('\n') + '\n'
  );
  utimesSync(a, new Date(START_MS + 5000), new Date(START_MS + 5000));

  // Session B: has in-window content but OLD mtime → whole file skipped by mtime gate.
  const b = join(dir, 'b.jsonl');
  writeFileSync(b, line({ tsMs: START_MS + 9000, usage: usage(5000, 5000) }) + '\n');
  utimesSync(b, new Date(START_MS - 10_000_000), new Date(START_MS - 10_000_000));

  // Trajectory sidecar must be ignored even with recent mtime + usage.
  const traj = join(dir, 'a.trajectory.jsonl');
  writeFileSync(traj, line({ tsMs: START_MS + 1000, usage: usage(7777, 7777) }) + '\n');
  utimesSync(traj, new Date(START_MS + 5000), new Date(START_MS + 5000));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('computeRunUsage', () => {
  it('sums per-message deltas in-window, never the cumulative totalTokens', () => {
    const r = computeRunUsage({ sessionsDir: dir, startEpochMs: START_MS });
    expect(r.tokensIn).toBe(300); // 100 + 200, excludes pre-start 9999
    expect(r.tokensOut).toBe(130); // 50 + 80
    expect(r.cacheRead).toBe(3000); // 1000 + 2000
    expect(r.costTotal).toBeCloseTo(0.03, 5);
    expect(r.messages).toBe(2);
    expect(r.sessions).toBe(1); // only A; B gated by mtime
    // Guard: a summed-totalTokens bug would push this into the 100k+ range.
    expect(r.tokensIn + r.tokensOut).toBeLessThan(1000);
  });

  it('returns empty for a missing directory', () => {
    const r = computeRunUsage({ sessionsDir: join(dir, 'nope'), startEpochMs: START_MS });
    expect(r).toMatchObject({ tokensIn: 0, tokensOut: 0, sessions: 0, messages: 0 });
  });
});

describe('farewell.sh', () => {
  function run(env: Record<string, string>) {
    return spawnSync('bash', [FAREWELL], {
      encoding: 'utf8',
      env: { ...process.env, RC_SESSIONS_DIR: dir, RC_VERSION: '9.9.9', ...env },
    });
  }

  it('exits 0 and prints the thank-you line even with an empty/missing sessions dir', () => {
    const empty = mkdtempSync(join(tmpdir(), 'rc-empty-'));
    const res = run({ RC_SESSIONS_DIR: empty, RC_RUN_START_EPOCH: String(Math.floor(START_MS / 1000)) });
    rmSync(empty, { recursive: true, force: true });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('感谢您使用科研龙虾');
  });

  it('emits no raw ANSI escape codes when stdout is not a TTY', () => {
    const res = run({ RC_RUN_START_EPOCH: String(Math.floor(START_MS / 1000)) });
    expect(res.status).toBe(0);
    // eslint-disable-next-line no-control-regex
    expect(res.stdout).not.toMatch(/\x1b\[/);
  });

  it('shows docker commands when platform is docker', () => {
    const res = run({ RC_PLATFORM_OVERRIDE: 'docker', RC_RUN_START_EPOCH: String(Math.floor(START_MS / 1000)) });
    expect(res.stdout).toContain('docker compose pull');
    expect(res.stdout).toContain('检测到: docker');
  });

  it('shows native update/start commands on macOS', () => {
    const res = run({ RC_PLATFORM_OVERRIDE: 'macOS', RC_RUN_START_EPOCH: String(Math.floor(START_MS / 1000)) });
    expect(res.stdout).toContain('bash scripts/update-research-claw.sh');
    expect(res.stdout).toContain('pnpm serve');
  });

  it('degrades gracefully when run start is unknown', () => {
    const res = run({});
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('本次运行用量不可用');
    expect(res.stdout).toContain('感谢您使用科研龙虾');
  });
});
