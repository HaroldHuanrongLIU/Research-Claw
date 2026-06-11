import {
  normalizeSessionKey,
  isMainSessionKey,
  isHeartbeatSessionKey,
  isSubagentSessionKey,
} from './session-key';
import { sanitizeUserMessage } from './sanitize-message';

/** Default labels assigned by the dashboard at session creation ("Session 3" / "项目 3"). */
const DEFAULT_LABEL_RE = /^(?:Session|项目)\s*\d+$/i;

const MAX_EXCHANGE_CHARS = 800;

export interface AutoNameSessionRow {
  key: string;
  label?: string;
}

/**
 * A session qualifies for LLM auto-naming only if the user never renamed it
 * (name once, user rename wins forever) and it is a real user-facing project session.
 */
export function isAutoNameCandidate(session: AutoNameSessionRow): boolean {
  const { key, label } = session;
  if (isMainSessionKey(key) || isHeartbeatSessionKey(key) || isSubagentSessionKey(key)) return false;
  const rest = normalizeSessionKey(key);
  if (rest === 'cron' || rest.startsWith('cron:')) return false;
  if (!label || !label.trim()) return true;
  return DEFAULT_LABEL_RE.test(label.trim());
}

export interface HistoryMessage {
  role?: string;
  content?: unknown;
  text?: unknown;
}

function extractText(message: HistoryMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((block) => {
        if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
          return (block as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof message.text === 'string') return message.text;
  return '';
}

/**
 * Extract the first real user→assistant exchange from a chat.history message list.
 * Returns null when the exchange is not complete yet (no reply, or the user
 * message is pure RC-injected metadata) — caller may retry later.
 */
export function extractFirstExchange(
  messages: HistoryMessage[],
): { userText: string; assistantText: string } | null {
  const userIndex = messages.findIndex((m) => m.role === 'user');
  if (userIndex < 0) return null;
  const userText = sanitizeUserMessage(extractText(messages[userIndex])).trim();
  if (!userText) return null;
  const assistant = messages.slice(userIndex + 1).find((m) => m.role === 'assistant');
  if (!assistant) return null;
  const assistantText = extractText(assistant).trim();
  if (!assistantText) return null;
  return {
    userText: userText.slice(0, MAX_EXCHANGE_CHARS),
    assistantText: assistantText.slice(0, MAX_EXCHANGE_CHARS),
  };
}
