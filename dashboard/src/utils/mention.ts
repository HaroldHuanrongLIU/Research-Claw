/**
 * Pure helpers for the composer `@`-mention file picker.
 *
 * The composer is a plain <textarea>, so we cannot embed rich chips inline.
 * Instead, typing `@<query>` opens a workspace-file menu; selecting a file
 * removes the `@<query>` text and adds a reference chip. These helpers isolate
 * the cursor/token math so it can be unit-tested without a DOM.
 */

export interface MentionQuery {
  /** Text typed after `@` (may be empty right after typing `@`). */
  query: string;
  /** Index of the `@` character in the source text. */
  start: number;
  /** Cursor position (exclusive end of the token). */
  end: number;
}

/**
 * Detect an active `@mention` token immediately before the cursor.
 * The `@` must be at the start of the input or preceded by whitespace — this
 * avoids triggering on emails ("a@b") and mid-word `@`.
 * Returns null when no mention token is active.
 */
export function computeMentionQuery(text: string, cursor: number): MentionQuery | null {
  if (cursor < 0 || cursor > text.length) return null;
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  // The `@` must be line-start or preceded by whitespace.
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  // A mention token ends at the first whitespace — a query with a space is stale.
  if (/\s/.test(query)) return null;
  return { query, start: at, end: cursor };
}

/** Remove the `@<query>` token from `text`, returning new text + caret index. */
export function stripMentionToken(text: string, token: MentionQuery): { text: string; cursor: number } {
  const next = text.slice(0, token.start) + text.slice(token.end);
  return { text: next, cursor: token.start };
}

function matchScore(pathLower: string, q: string): number {
  const base = pathLower.slice(pathLower.lastIndexOf('/') + 1);
  if (base.startsWith(q)) return 0;
  if (base.includes(q)) return 1;
  if (pathLower.includes(q)) return 2;
  return -1;
}

/** Rank workspace file paths against a query (basename matches win), capped. */
export function filterMentionCandidates(paths: string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return paths.slice(0, limit);
  return paths
    .map((p) => ({ p, score: matchScore(p.toLowerCase(), q) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.p);
}

interface TreeNodeLike {
  path: string;
  type: 'file' | 'directory';
  children?: TreeNodeLike[];
}

/** Flatten a workspace tree into a flat list of file paths (files only). */
export function flattenWorkspaceFiles(tree: TreeNodeLike[]): string[] {
  const out: string[] = [];
  const walk = (nodes: TreeNodeLike[]) => {
    for (const n of nodes) {
      if (n.type === 'file') out.push(n.path);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree);
  return out;
}
