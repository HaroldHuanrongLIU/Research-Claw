/**
 * Research Superpower — Plugin Entry Point
 *
 * Exposes the rp.py pipeline (Scopus relevance search + OpenAlex enrichment) as
 * four native OpenClaw agent tools so the model calls them directly instead of
 * shelling out via exec:
 *   - rp_search    : Scopus search -> OpenAlex abstracts/OA links
 *   - rp_abstracts : batch abstracts + OA links for a DOI list (OpenAlex)
 *   - rp_cite      : citation traversal (backward = references, forward = citing)
 *   - rp_fulltext  : OA full-text fetch (Elsevier OA -> OpenAlex OA fallback)
 *
 * The Python side is zero-dependency stdlib; the Elsevier key + OpenAlex mailto
 * have built-in defaults in rp_lib.py, so the tools work with no extra config.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from '@sinclair/typebox';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(HERE, 'scripts');
const RP_SCRIPT = path.join(SCRIPTS_DIR, 'rp.py');
const PYTHON = process.env.RP_PYTHON || 'python3';

// Hard bounds so a slow/rate-limited Scopus path or an oversized OpenAlex
// response can never freeze the agent or exhaust the gateway's Node heap.
const DEFAULT_TIMEOUT_MS = 60_000; // search overrides to 120s (Scopus pagination + backoff)
const SEARCH_TIMEOUT_MS = 120_000;
const MAX_STDOUT_BYTES = 5 * 1024 * 1024; // 5 MB

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: unknown;
}

function text(t: string): ToolResult['content'] {
  return [{ type: 'text', text: t }];
}

function runRp(
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [RP_SCRIPT, ...args], {
      cwd: SCRIPTS_DIR,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    // Deadline: SIGTERM, then SIGKILL as a backstop if it ignores the term.
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const hardKill = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, 2_000);
      hardKill.unref();
      finish({
        code: -1,
        stdout,
        stderr: `${stderr}\n[timeout] rp.py exceeded ${timeoutMs}ms and was terminated. Narrow the query (lower --limit) or retry.`,
      });
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      if (settled) return;
      stdout += d.toString();
      if (stdout.length > MAX_STDOUT_BYTES) {
        child.kill('SIGTERM');
        finish({
          code: -1,
          stdout: '',
          stderr: `${stderr}\n[overflow] rp.py stdout exceeded ${MAX_STDOUT_BYTES} bytes and was terminated. Narrow the query (lower --limit).`,
        });
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      finish({ code: -1, stdout, stderr: `${stderr}\n[spawn error] ${err.message}` });
    });
    child.on('close', (code) => {
      finish({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function execRp(args: string[], summary: string, timeoutMs?: number): Promise<ToolResult> {
  const { code, stdout, stderr } = await runRp(args, timeoutMs);
  const human = stderr.trim();

  if (code !== 0) {
    const detail = human || `rp.py exited with code ${code}`;
    return {
      content: text(
        `Error: rp ${summary} failed (exit ${code}).\n${detail}\n\n` +
          `If this is a key/quota issue (401/429), the Scopus path may be rate-limited — ` +
          `retry, narrow the query, or fall back to OpenAlex-only operations.`,
      ),
      details: { error: detail, exitCode: code },
    };
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      content: text(`${human}\n\n${stdout.trim() || '(no output)'}`),
      details: { raw: stdout, warning: 'non-JSON stdout' },
    };
  }

  const body = JSON.stringify(parsed, null, 2);
  return {
    content: text(human ? `${human}\n\n${body}` : body),
    details: parsed,
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function buildTools() {
  return [
    {
      name: 'rp_search',
      label: 'Literature search (Scopus + OpenAlex)',
      description:
        'Scopus relevance search enriched with OpenAlex abstracts and open-access PDF links. ' +
        'Use to find candidate papers on a topic with real citation counts and abstracts for ' +
        'relevance judgement. Returns candidate records (title, DOI, year, citations, abstract, ' +
        'oa_pdf_url). The Elsevier key is built in — no setup needed.',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query (keywords or phrase).' }),
        limit: Type.Optional(Type.Number({ description: 'Max candidates to return (default 50).' })),
        min_year: Type.Optional(Type.Number({ description: 'Only keep papers from this year onward.' })),
      }),
      execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
        const query = asString(params.query);
        if (!query) return { content: text('Error: query is required and must be a non-empty string.'), details: { error: 'empty_query' } };
        const args = ['search', query];
        const limit = asInt(params.limit);
        if (limit !== undefined) args.push('--limit', String(limit));
        const minYear = asInt(params.min_year);
        if (minYear !== undefined) args.push('--min-year', String(minYear));
        return execRp(args, `search "${query}"`, SEARCH_TIMEOUT_MS);
      },
    },
    {
      name: 'rp_abstracts',
      label: 'Batch abstracts (OpenAlex)',
      description:
        'Batch-fetch abstracts and open-access links for a list of DOIs via OpenAlex (no key). ' +
        'Use after you already have DOIs and need abstracts for screening/scoring.',
      parameters: Type.Object({
        dois: Type.Array(Type.String(), { description: 'List of DOIs.' }),
      }),
      execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
        const dois = Array.isArray(params.dois)
          ? params.dois.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
          : [];
        if (dois.length === 0) return { content: text('Error: dois must be a non-empty array of DOI strings.'), details: { error: 'no_dois' } };
        return execRp(['abstracts', ...dois], `abstracts (${dois.length} DOIs)`);
      },
    },
    {
      name: 'rp_cite',
      label: 'Citation traversal (OpenAlex)',
      description:
        'Citation traversal via OpenAlex. backward = referenced works, forward = papers citing it. ' +
        'Deduped, with abstracts. Use to expand a seed paper into its citation neighbourhood.',
      parameters: Type.Object({
        doi: Type.String({ description: 'Seed paper DOI.' }),
        direction: Type.Optional(
          Type.Union([Type.Literal('both'), Type.Literal('backward'), Type.Literal('forward')], {
            description: 'Traversal direction (default both).',
          }),
        ),
        limit: Type.Optional(Type.Number({ description: 'Max works per direction (default 50).' })),
      }),
      execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
        const doi = asString(params.doi);
        if (!doi) return { content: text('Error: doi is required.'), details: { error: 'empty_doi' } };
        const args = ['cite', doi];
        const direction = asString(params.direction);
        if (direction && ['both', 'backward', 'forward'].includes(direction)) args.push('--direction', direction);
        const limit = asInt(params.limit);
        if (limit !== undefined) args.push('--limit', String(limit));
        return execRp(args, `cite ${doi}`);
      },
    },
    {
      name: 'rp_fulltext',
      label: 'Open-access full text',
      description:
        'Fetch open-access full text for a DOI (Elsevier ScienceDirect OA first, then OpenAlex OA ' +
        'PDF/landing). Paywalled papers are reported unavailable. Returns availability + source + ' +
        'links; pass out to also save the text to a file.',
      parameters: Type.Object({
        doi: Type.String({ description: 'Paper DOI.' }),
        out: Type.Optional(Type.String({ description: 'Optional file path to save the full text to.' })),
      }),
      execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
        const doi = asString(params.doi);
        if (!doi) return { content: text('Error: doi is required.'), details: { error: 'empty_doi' } };
        const args = ['fulltext', doi];
        const out = asString(params.out);
        if (out) args.push('--out', out);
        return execRp(args, `fulltext ${doi}`);
      },
    },
  ];
}

export default function activate(api: {
  registerTool: (factory: unknown, opts?: { names?: string[] }) => void;
  logger?: { info: (msg: string) => void };
}) {
  api.registerTool(() => buildTools(), {
    names: ['rp_search', 'rp_abstracts', 'rp_cite', 'rp_fulltext'],
  });
  api.logger?.info('[research-superpower] registered 4 agent tools (rp_search, rp_abstracts, rp_cite, rp_fulltext)');
}
