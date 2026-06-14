#!/usr/bin/env node
// Computes "this-run" token/cost usage for the exit farewell screen.
//
// Session jsonl lines look like:
//   {type,id,parentId,timestamp,message:{role,...,usage:{input,output,cacheRead,
//     cacheWrite,reasoningTokens,totalTokens,cost:{...,total}}}}
// `usage` is per assistant message; `totalTokens` is the cumulative context size
// for that turn (monotonic) and MUST NOT be summed. We sum the per-message
// deltas (input/output/cache/reasoning) and cost.total, filtered to messages
// whose timestamp is at/after the run start.
//
// CLI: node farewell-usage.mjs <sessionsDir> <startEpochMs>  -> prints JSON
// Module: import { computeRunUsage } from './farewell-usage.mjs'

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EMPTY = {
  tokensIn: 0,
  tokensOut: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoningTokens: 0,
  costTotal: 0,
  sessions: 0,
  messages: 0,
};

function toMs(timestamp) {
  if (typeof timestamp === 'number') return timestamp;
  if (typeof timestamp === 'string') {
    const t = Date.parse(timestamp);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function computeRunUsage({ sessionsDir, startEpochMs }) {
  const acc = { ...EMPTY };
  let files;
  try {
    files = readdirSync(sessionsDir);
  } catch {
    return acc; // dir missing → graceful empty
  }

  for (const name of files) {
    if (!name.endsWith('.jsonl')) continue;
    if (name.includes('.trajectory')) continue;

    const full = join(sessionsDir, name);
    // mtime gate: skip sessions untouched since the run started.
    try {
      if (statSync(full).mtimeMs < startEpochMs) continue;
    } catch {
      continue;
    }

    let raw;
    try {
      raw = readFileSync(full, 'utf8');
    } catch {
      continue;
    }

    let sessionContributed = false;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue; // skip malformed line
      }
      const usage = obj?.message?.usage;
      if (!usage) continue;
      const ms = toMs(obj.timestamp) ?? toMs(obj?.message?.timestamp);
      if (ms === null || ms < startEpochMs) continue;

      acc.tokensIn += num(usage.input);
      acc.tokensOut += num(usage.output);
      acc.cacheRead += num(usage.cacheRead);
      acc.cacheWrite += num(usage.cacheWrite);
      acc.reasoningTokens += num(usage.reasoningTokens);
      acc.costTotal += num(usage.cost?.total);
      acc.messages += 1;
      sessionContributed = true;
    }
    if (sessionContributed) acc.sessions += 1;
  }

  return acc;
}

// CLI entry: `node farewell-usage.mjs [--sh] <sessionsDir> <startEpochMs>`.
// Default prints JSON; --sh prints shell assignments (consumed by farewell.sh).
const isCli = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const argv = process.argv.slice(2);
  const sh = argv.includes('--sh');
  const positional = argv.filter((a) => a !== '--sh');
  const sessionsDir = positional[0];
  const startEpochMs = Number(positional[1]);

  const emit = (r) => {
    if (sh) {
      // All values are integers/finite numbers we computed — safe to eval in bash.
      process.stdout.write(
        [
          `RC_U_IN=${Math.round(r.tokensIn)}`,
          `RC_U_OUT=${Math.round(r.tokensOut)}`,
          `RC_U_CACHE=${Math.round(r.cacheRead + r.cacheWrite)}`,
          `RC_U_REASON=${Math.round(r.reasoningTokens)}`,
          `RC_U_COST=${r.costTotal}`,
          `RC_U_SESSIONS=${r.sessions}`,
          `RC_U_MESSAGES=${r.messages}`,
        ].join('\n') + '\n'
      );
    } else {
      process.stdout.write(JSON.stringify(r));
    }
  };

  if (!sessionsDir || !Number.isFinite(startEpochMs)) {
    emit(EMPTY);
    process.exit(0);
  }
  try {
    emit(computeRunUsage({ sessionsDir, startEpochMs }));
  } catch {
    emit(EMPTY);
  }
}
