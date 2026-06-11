import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionNamingService, sanitizeTitle } from '../session-naming/service.js';
import { registerSessionNamingRpc } from '../session-naming/rpc.js';
import type { RegisterMethod } from '../types.js';

let tmpDir: string;

function writeConfig(api: 'openai-completions' | 'anthropic-messages', baseUrl: string): string {
  const configPath = path.join(tmpDir, 'openclaw.json');
  fs.writeFileSync(configPath, JSON.stringify({
    agents: { defaults: { model: { primary: 'testprov/test-model' } } },
    models: {
      providers: {
        testprov: {
          baseUrl,
          api,
          apiKey: 'sk-test',
          models: [{ id: 'test-model', name: 'test-model' }],
        },
      },
    },
  }));
  return configPath;
}

function openaiResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

function anthropicResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ text }] }),
  } as unknown as Response;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-session-naming-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('sanitizeTitle', () => {
  it('takes the first non-empty line and trims whitespace', () => {
    expect(sanitizeTitle('\n  注意力机制论文整理  \n第二行')).toBe('注意力机制论文整理');
  });

  it('strips surrounding quotes (CJK and ASCII)', () => {
    expect(sanitizeTitle('"Attention Survey"')).toBe('Attention Survey');
    expect(sanitizeTitle('“注意力机制论文整理”')).toBe('注意力机制论文整理');
    expect(sanitizeTitle("'quoted title'")).toBe('quoted title');
  });

  it('strips trailing punctuation', () => {
    expect(sanitizeTitle('注意力机制论文整理。')).toBe('注意力机制论文整理');
    expect(sanitizeTitle('Attention survey.')).toBe('Attention survey');
  });

  it('strips a leading "标题:" / "Title:" label the model may prepend', () => {
    expect(sanitizeTitle('标题：注意力机制论文整理')).toBe('注意力机制论文整理');
    expect(sanitizeTitle('Title: Attention survey')).toBe('Attention survey');
    expect(sanitizeTitle('会话标题: 图神经网络')).toBe('图神经网络');
  });

  it('hard caps at 40 characters for an unbroken string', () => {
    expect(sanitizeTitle('x'.repeat(80))).toHaveLength(40);
  });

  it('backs off to a word boundary instead of chopping a Latin word', () => {
    const title = sanitizeTitle('GNN Molecular Property Prediction Methods Survey Overview Report');
    expect(title.length).toBeLessThanOrEqual(40);
    expect(title.endsWith(' ')).toBe(false);
    // Must not end mid-word — the last token is a complete word from the input.
    expect('GNN Molecular Property Prediction Methods Survey Overview Report').toContain(title.split(' ').pop()!);
  });

  it('hard-cuts a CJK title with no spaces at the cap', () => {
    expect(sanitizeTitle('图'.repeat(60))).toHaveLength(40);
  });

  it('returns empty string for blank input', () => {
    expect(sanitizeTitle('')).toBe('');
    expect(sanitizeTitle('  \n  ')).toBe('');
  });
});

function writeAuthProfiles(profiles: Record<string, { provider: string; type: string; key?: string }>): string {
  const authPath = path.join(tmpDir, 'auth-profiles.json');
  fs.writeFileSync(authPath, JSON.stringify({ profiles }));
  return authPath;
}

describe('SessionNamingService.generateTitle', () => {
  it('calls an openai-completions endpoint and returns the sanitized title', async () => {
    const configPath = writeConfig('openai-completions', 'https://llm.test/v1');
    const fetchMock = vi.fn().mockResolvedValue(openaiResponse('“注意力机制论文整理”\n'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new SessionNamingService({ configPath });
    const title = await service.generateTitle({
      userText: '请帮我整理 Transformer 注意力机制的代表性论文',
      assistantText: '好的，可以从 Attention Is All You Need 开始……',
    });

    expect(title).toBe('注意力机制论文整理');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://llm.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string) as { model: string; temperature: number; max_tokens: number; messages: Array<{ content: string }> };
    expect(body.model).toBe('test-model');
    expect(body.temperature).toBe(0);
    // Reasoning models burn max_tokens on CoT before emitting content —
    // the cap must leave generous headroom (title length is enforced by sanitizeTitle).
    expect(body.max_tokens).toBeGreaterThanOrEqual(1024);
    expect(body.messages[0].content).toContain('Transformer');
    // The prompt must instruct the model to follow the user's language.
    expect(body.messages[0].content.toLowerCase()).toContain('same language as the user');
    expect(body.messages[0].content).toContain('用户');
  });

  it('calls an anthropic-messages endpoint with x-api-key', async () => {
    const configPath = writeConfig('anthropic-messages', 'https://claude.test');
    const fetchMock = vi.fn().mockResolvedValue(anthropicResponse('Attention survey.'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new SessionNamingService({ configPath });
    const title = await service.generateTitle({ userText: 'q', assistantText: 'a' });

    expect(title).toBe('Attention survey');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://claude.test/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-test');
  });

  it('prefers the auth-profile api key over the stale config apiKey', async () => {
    // Real deployments store the live key in OC auth profiles (set via dashboard
    // provider RPC → setApiKeyProfile); the config apiKey can be stale → HTTP 401.
    const configPath = writeConfig('openai-completions', 'https://llm.test/v1');
    const authProfilesPath = writeAuthProfiles({
      'testprov:manual': { provider: 'testprov', type: 'api_key', key: 'sk-profile-live' },
      'other:oauth': { provider: 'other', type: 'oauth' },
    });
    const fetchMock = vi.fn().mockResolvedValue(openaiResponse('标题'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new SessionNamingService({ configPath, authProfilesPath });
    await service.generateTitle({ userText: 'q', assistantText: 'a' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-profile-live');
  });

  it('falls back to the config apiKey when no auth profile matches the provider', async () => {
    const configPath = writeConfig('openai-completions', 'https://llm.test/v1');
    const authProfilesPath = writeAuthProfiles({
      'other:manual': { provider: 'other', type: 'api_key', key: 'sk-other' },
    });
    const fetchMock = vi.fn().mockResolvedValue(openaiResponse('标题'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new SessionNamingService({ configPath, authProfilesPath });
    await service.generateTitle({ userText: 'q', assistantText: 'a' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('throws when no model config is available', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new SessionNamingService({ configPath: path.join(tmpDir, 'missing.json') });
    await expect(service.generateTitle({ userText: 'q', assistantText: 'a' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on HTTP error', async () => {
    const configPath = writeConfig('openai-completions', 'https://llm.test/v1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response));

    const service = new SessionNamingService({ configPath });
    await expect(service.generateTitle({ userText: 'q', assistantText: 'a' })).rejects.toThrow(/500/);
  });

  it('throws when the model returns an empty title', async () => {
    const configPath = writeConfig('openai-completions', 'https://llm.test/v1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openaiResponse('   ')));

    const service = new SessionNamingService({ configPath });
    await expect(service.generateTitle({ userText: 'q', assistantText: 'a' })).rejects.toThrow();
  });
});

describe('rc.session.autoName RPC', () => {
  function setup() {
    const handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>();
    const registerMethod: RegisterMethod = (method, handler) => handlers.set(method, handler);
    const configPath = writeConfig('openai-completions', 'https://llm.test/v1');
    registerSessionNamingRpc(registerMethod, new SessionNamingService({ configPath }));
    return handlers;
  }

  it('registers rc.session.autoName and returns { ok, title }', async () => {
    const handlers = setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openaiResponse('注意力机制论文整理')));

    expect(handlers.has('rc.session.autoName')).toBe(true);
    const result = await handlers.get('rc.session.autoName')!({
      key: 'agent:main:project-e5f6g7h8',
      userText: '请帮我整理 Transformer 注意力机制的代表性论文',
      assistantText: '好的……',
    });
    expect(result).toEqual({ ok: true, title: '注意力机制论文整理' });
  });

  it('rejects missing userText/assistantText', async () => {
    const handlers = setup();
    const handler = handlers.get('rc.session.autoName')!;
    await expect(Promise.resolve(handler({ assistantText: 'a' }))).rejects.toThrow(/userText/);
    await expect(Promise.resolve(handler({ userText: 'q' }))).rejects.toThrow(/assistantText/);
  });
});
