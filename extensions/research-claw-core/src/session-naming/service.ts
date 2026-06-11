import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TITLE_MAX_CHARS = 40;
const LLM_TIMEOUT_MS = 30_000;
// Reasoning models (e.g. deepseek-v4-pro) spend max_tokens on chain-of-thought
// first — a small cap yields an EMPTY content field. Give generous headroom;
// the title itself is still hard-capped at 30 chars by sanitizeTitle.
const LLM_MAX_TOKENS = 2048;

/** First non-empty line, label/quotes/trailing punctuation stripped, capped at 40 chars (word-aware for Latin). */
export function sanitizeTitle(raw: string): string {
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';
  const unquoted = firstLine
    // Drop a leading "标题:" / "Title:" label the model may prepend despite instructions.
    .replace(/^\s*(?:标题|title|会话标题|session title)\s*[:：]\s*/i, '')
    .replace(/^["'“”‘’《【\s]+/, '')
    .replace(/["'“”‘’》】\s]+$/, '')
    .replace(/[。．.!！?？,，;；:：]+$/, '')
    .trim();
  if (unquoted.length <= TITLE_MAX_CHARS) return unquoted;
  const capped = unquoted.slice(0, TITLE_MAX_CHARS);
  // If the cap lands mid-word on a space-delimited (Latin) title, back off to
  // the last word boundary so we don't show a chopped word like "Predict".
  // CJK titles have no spaces (lastSpace = -1) → hard cut, which is correct.
  const cutsMidWord = /\S/.test(unquoted.charAt(TITLE_MAX_CHARS));
  const lastSpace = capped.lastIndexOf(' ');
  if (cutsMidWord && lastSpace > 0) return capped.slice(0, lastSpace).trim();
  return capped.trim();
}

interface ModelConfig {
  provider: string;
  model: string;
  api: string;
  baseUrl: string;
  apiKey: string;
}

export interface SessionNamingOptions {
  configPath?: string;
  authProfilesPath?: string;
}

export class SessionNamingService {
  private readonly explicitConfigPath?: string;
  private readonly authProfilesPath: string;

  constructor(options: SessionNamingOptions = {}) {
    this.explicitConfigPath = options.configPath;
    this.authProfilesPath =
      options.authProfilesPath ||
      path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');
  }

  async generateTitle(input: { userText: string; assistantText: string }): Promise<string> {
    const modelCfg = this.loadCurrentModelConfig();
    if (!modelCfg?.baseUrl) throw new Error('No configured model for session naming');

    // The instruction is bilingual and the language rule is stated first so the
    // title follows the USER's language (not the assistant's, and not the frame's).
    const prompt = [
      'Generate one short title for the conversation below. / 为下面的对话生成一个简短标题。',
      '',
      'Rules / 要求:',
      "1. Write the title in the SAME language as the User's message. If the user wrote Chinese, the title MUST be Chinese; if English, English. / 标题语言必须与下面“用户”消息的语言一致(用户用中文则标题用中文,用英文则用英文),不要跟随助手的语言。",
      '2. Summarize the user\'s topic or intent — at most 6 English words or 15 Chinese characters. / 概括用户的主题或意图,最多 6 个英文单词或 15 个汉字。',
      '3. Output ONLY the title text — no quotes, punctuation, labels, prefixes, or explanation. / 只输出标题本身,不要引号、标点、前缀(如“标题:”)或任何解释。',
      '',
      `User / 用户: ${input.userText}`,
      `Assistant / 助手: ${input.assistantText}`,
    ].join('\n');

    const raw = await this.complete(modelCfg, prompt);
    const title = sanitizeTitle(raw);
    if (!title) throw new Error('Session naming model returned an empty title');
    return title;
  }

  private async complete(modelCfg: ModelConfig, prompt: string): Promise<string> {
    if (modelCfg.api === 'anthropic-messages') {
      const baseUrl = modelCfg.baseUrl.replace(/\/v1\/?$/, '');
      const res = await this.fetchWithTimeout(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          ...(modelCfg.apiKey ? { 'x-api-key': modelCfg.apiKey } : {}),
        },
        body: JSON.stringify({
          model: modelCfg.model,
          max_tokens: LLM_MAX_TOKENS,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        }),
      }, LLM_TIMEOUT_MS);
      if (!res.ok) throw new Error(`session naming model failed: HTTP ${res.status}`);
      const json = await res.json() as { content?: Array<{ text?: string }> };
      return (json.content ?? []).map((part) => part.text ?? '').join('\n').trim();
    }

    if (modelCfg.api === 'openai-completions') {
      const endpoint = modelCfg.baseUrl.endsWith('/chat/completions')
        ? modelCfg.baseUrl
        : `${modelCfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
      const res = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(modelCfg.apiKey ? { authorization: `Bearer ${modelCfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: modelCfg.model,
          temperature: 0,
          max_tokens: LLM_MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        }),
      }, LLM_TIMEOUT_MS);
      if (!res.ok) throw new Error(`session naming model failed: HTTP ${res.status}`);
      const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      return json.choices?.[0]?.message?.content?.trim() ?? '';
    }

    throw new Error(`Unsupported session naming API: ${modelCfg.api}`);
  }

  private loadCurrentModelConfig(): ModelConfig | null {
    const configPath =
      this.explicitConfigPath ||
      process.env.OPENCLAW_CONFIG_PATH ||
      path.join(process.cwd(), 'config', 'openclaw.json');
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      const defaults = (cfg.agents as Record<string, unknown> | undefined)?.defaults as Record<string, unknown> | undefined;
      const modelRefObj = defaults?.model as { primary?: string } | undefined;
      const primary = typeof modelRefObj?.primary === 'string' ? modelRefObj.primary : '';
      const slash = primary.indexOf('/');
      if (slash <= 0) return null;
      const provider = primary.slice(0, slash);
      const model = primary.slice(slash + 1);
      const providers = (cfg.models as Record<string, unknown> | undefined)?.providers as Record<string, Record<string, unknown>> | undefined;
      const entry = providers?.[provider];
      if (!entry) return null;
      const modelEntry = Array.isArray(entry.models)
        ? entry.models.find((item) => {
            if (!item || typeof item !== 'object') return false;
            const rec = item as Record<string, unknown>;
            return rec.id === model || rec.name === model || rec.model === model;
          }) as Record<string, unknown> | undefined
        : undefined;
      const baseUrl = (
        typeof modelEntry?.baseUrl === 'string'
          ? modelEntry.baseUrl
          : typeof entry.baseUrl === 'string'
            ? entry.baseUrl
            : ''
      ).replace(/\/+$/, '');
      const configApiKey = typeof modelEntry?.apiKey === 'string'
        ? modelEntry.apiKey
        : typeof entry.apiKey === 'string'
          ? entry.apiKey
          : '';
      return {
        provider,
        model,
        api: typeof modelEntry?.api === 'string'
          ? modelEntry.api
          : typeof entry.api === 'string'
            ? entry.api
            : 'openai-completions',
        baseUrl,
        // Auth profiles hold the live key (dashboard key updates go there via
        // setApiKeyProfile); the config apiKey can be stale → prefer the profile.
        apiKey: this.loadAuthProfileKey(provider) || configApiKey,
      };
    } catch {
      return null;
    }
  }

  private loadAuthProfileKey(provider: string): string {
    try {
      const store = JSON.parse(fs.readFileSync(this.authProfilesPath, 'utf8')) as {
        profiles?: Record<string, { provider?: string; type?: string; key?: string }>;
      };
      for (const profile of Object.values(store.profiles ?? {})) {
        if (profile.provider === provider && profile.type === 'api_key' && typeof profile.key === 'string' && profile.key) {
          return profile.key;
        }
      }
      return '';
    } catch {
      return '';
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
