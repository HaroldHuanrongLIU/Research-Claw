import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import SettingsPanel from './SettingsPanel';
import { useConfigStore } from '../../stores/config';
import { useGatewayStore } from '../../stores/gateway';
import { serializeConfigForGatewayApply } from '../../utils/config-patch';

// Mock antd App.useApp (modal.confirm + message)
const mockModalConfirm = vi.fn();
const mockMessageSuccess = vi.fn();
const mockMessageError = vi.fn();
const mockMessageWarning = vi.fn();
vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  const MockApp = Object.assign(
    (props: Record<string, unknown>) => (actual.App as unknown as (p: unknown) => unknown)(props),
    { ...actual.App, useApp: () => ({
      modal: { confirm: (...args: unknown[]) => mockModalConfirm(...args) },
      message: { success: mockMessageSuccess, error: mockMessageError, warning: mockMessageWarning },
      notification: {},
    }) },
  );
  return { ...actual, App: MockApp };
});

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'count' in opts) return `${key}:${opts.count}`;
      if (opts && 'version' in opts) return `${key}:${opts.version}`;
      return key;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

/** Minimal valid gateway config for form rendering. */
function makeGatewayConfig(
  textModel = 'test-model',
  provider = 'custom',
  baseUrl = 'https://api.example.com/v1',
  overrides?: {
    apiKey?: string;
    extraProviders?: Record<string, Record<string, unknown>>;
  },
) {
  return {
    agents: {
      defaults: {
        model: { primary: `${provider}/${textModel}` },
        imageModel: { primary: `${provider}/${textModel}` },
      },
    },
    models: {
      providers: {
        [provider]: {
          baseUrl,
          api: 'openai-completions',
          ...(overrides?.apiKey ? { apiKey: overrides.apiKey } : {}),
          models: [{ id: textModel, name: textModel }],
        },
        ...(overrides?.extraProviders ?? {}),
      },
    },
  };
}

/** Create a mock gateway client. */
function createMockClient(requestFn?: (...args: unknown[]) => Promise<unknown>) {
  return {
    isConnected: true,
    request: requestFn ?? vi.fn().mockResolvedValue({}),
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as ReturnType<typeof useGatewayStore.getState>['client'];
}

function clickConfigSaveButton(): void {
  const saveButtons = screen.getAllByRole('button', { name: /settings\.save|setup\.gatewayRestarting/i });
  const configButton = saveButtons.find((button) => button.parentElement?.textContent?.includes('settings.restartHint')) ?? saveButtons[0];
  fireEvent.click(configButton);
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    mockModalConfirm.mockReset();
    mockMessageSuccess.mockReset();
    mockMessageError.mockReset();
    useConfigStore.setState({
      theme: 'dark',
      locale: 'en',
      systemPromptAppend: '',
      bootState: 'ready',
      pendingConfigRestart: false,
      gatewayConfig: null,
      gatewayConfigLoading: false,
      _configRetryCount: 0,
    });
    useGatewayStore.setState({
      client: null,
      state: 'disconnected',
      serverVersion: '0.42.0',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows disconnected message when not connected', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('status.disconnected')).toBeTruthy();
  });

  it('renders single scrollable panel (no tabs) when connected', () => {
    useGatewayStore.setState({
      state: 'connected',
      client: createMockClient(),
    });
    useConfigStore.setState({ gatewayConfig: makeGatewayConfig() });

    render(<SettingsPanel />);

    // Config source badge visible
    expect(screen.getByText('settings.configSource')).toBeTruthy();
    // About section inline (no tab click needed)
    expect(screen.getByText('settings.aboutDiagnostics')).toBeTruthy();
    // No tab elements
    expect(screen.queryByText('settings.model')).toBeNull();
    expect(screen.queryByText('settings.proxy')).toBeNull();
    expect(screen.queryByText('settings.about')).toBeNull();
  });

  it('renders vision enable toggle', () => {
    useGatewayStore.setState({
      state: 'connected',
      client: createMockClient(),
    });
    useConfigStore.setState({ gatewayConfig: makeGatewayConfig() });

    render(<SettingsPanel />);
    expect(screen.getByText('settings.enableVision')).toBeTruthy();
  });

  it('renders text model field when connected with config', () => {
    useGatewayStore.setState({
      state: 'connected',
      client: createMockClient(),
    });
    useConfigStore.setState({ gatewayConfig: makeGatewayConfig() });

    render(<SettingsPanel />);
    // The primary model label should be visible
    expect(screen.getByText('settings.primaryModel')).toBeTruthy();
  });
});

// ============================================================
// PR #18: syncNeeded ref — prevents WS reconnect from overwriting edits
// ============================================================

describe('PR #18: syncNeeded — form sync gating', () => {
  beforeEach(() => {
    mockModalConfirm.mockReset();
    mockMessageSuccess.mockReset();
    mockMessageError.mockReset();
    useConfigStore.setState({
      theme: 'dark',
      locale: 'en',
      systemPromptAppend: '',
      bootState: 'ready',
      pendingConfigRestart: false,
      gatewayConfig: null,
      gatewayConfigLoading: false,
      _configRetryCount: 0,
    });
    useGatewayStore.setState({
      client: createMockClient(),
      state: 'connected',
      serverVersion: '0.5.6',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs form fields on initial config load', () => {
    // Set config BEFORE render — the initial useEffect should sync
    useConfigStore.setState({ gatewayConfig: makeGatewayConfig('gpt-4o', 'openai', 'https://api.openai.com/v1') });

    render(<SettingsPanel />);

    // The text model field should have the value from config
    const modelInput = screen.getByDisplayValue('gpt-4o');
    expect(modelInput).toBeTruthy();
  });

  it('does NOT overwrite user edits when gatewayConfig changes (WS reconnect)', () => {
    // Initial config load
    useConfigStore.setState({ gatewayConfig: makeGatewayConfig('original-model') });

    render(<SettingsPanel />);

    // Verify initial sync happened
    expect(screen.getByDisplayValue('original-model')).toBeTruthy();

    // User types a new model name
    const modelInput = screen.getByDisplayValue('original-model');
    fireEvent.change(modelInput, { target: { value: 'user-edited-model' } });
    expect(screen.getByDisplayValue('user-edited-model')).toBeTruthy();

    // Simulate WS reconnect: gatewayConfig gets a new object reference with old values
    act(() => {
      useConfigStore.setState({ gatewayConfig: makeGatewayConfig('original-model') });
    });

    // User's edit should be preserved — NOT overwritten back to 'original-model'
    expect(screen.getByDisplayValue('user-edited-model')).toBeTruthy();
  });

  it('syncs form when refresh button is clicked', () => {
    const loadGatewayConfig = vi.fn();
    useConfigStore.setState({
      gatewayConfig: makeGatewayConfig('initial-model'),
      loadGatewayConfig,
    });

    render(<SettingsPanel />);

    // User edits the model
    const modelInput = screen.getByDisplayValue('initial-model');
    fireEvent.change(modelInput, { target: { value: 'user-edit' } });
    expect(screen.getByDisplayValue('user-edit')).toBeTruthy();

    // Click refresh button
    const refreshButton = screen.getByText('settings.refreshConfig');
    fireEvent.click(refreshButton);

    // loadGatewayConfig should have been called
    expect(loadGatewayConfig).toHaveBeenCalled();

    // Simulate the config reload arriving with server value
    act(() => {
      useConfigStore.setState({ gatewayConfig: makeGatewayConfig('server-updated-model') });
    });

    // Form should now show the new server value (syncNeeded was set to true by refresh)
    expect(screen.getByDisplayValue('server-updated-model')).toBeTruthy();
  });

  it('syncs form after successful save + gateway restart', async () => {
    const mockRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'config.get') {
        return Promise.resolve({
          config: makeGatewayConfig('old-model'),
          hash: 'hash123',
        });
      }
      if (method === 'config.apply') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    useGatewayStore.setState({ client: createMockClient(mockRequest) });
    useConfigStore.setState({ gatewayConfig: makeGatewayConfig('old-model') });

    render(<SettingsPanel />);

    // Dirty the form so the Save button is enabled (Save is gated on changes).
    fireEvent.change(screen.getByDisplayValue('old-model'), { target: { value: 'old-model-edited' } });

    // Click save button to trigger modal.confirm
    const saveButtons = screen.getAllByRole('button', { name: /settings\.save|setup\.gatewayRestarting/i });
    fireEvent.click(saveButtons[0]);

    expect(mockModalConfirm).toHaveBeenCalledTimes(1);

    // Simulate user confirming the dialog
    const confirmCall = mockModalConfirm.mock.calls[0][0] as {
      onOk: () => Promise<void>;
    };
    await confirmCall.onOk();

    // After save, syncNeeded should be true. Simulate gateway restart and new config.
    act(() => {
      useConfigStore.setState({ gatewayConfig: makeGatewayConfig('new-saved-model') });
    });

    // Form should sync to the newly saved model (because syncNeeded was set to true after save)
    expect(screen.getByDisplayValue('new-saved-model')).toBeTruthy();
  });

  it('preserves user edits across multiple WS reconnections', () => {
    useConfigStore.setState({ gatewayConfig: makeGatewayConfig('server-model') });

    render(<SettingsPanel />);

    // User edits the model
    const modelInput = screen.getByDisplayValue('server-model');
    fireEvent.change(modelInput, { target: { value: 'my-custom-model' } });

    // Simulate 3 consecutive WS reconnections
    for (let i = 0; i < 3; i++) {
      act(() => {
        useConfigStore.setState({ gatewayConfig: makeGatewayConfig('server-model') });
      });
    }

    // User's edit should still be preserved after all reconnections
    expect(screen.getByDisplayValue('my-custom-model')).toBeTruthy();
  });

  it('does not sync when save fails (preserves user edits for retry)', () => {
    const mockRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'config.get') {
        return Promise.resolve({
          config: makeGatewayConfig('current-model'),
          hash: 'hash123',
        });
      }
      if (method === 'config.apply') {
        return Promise.reject(new Error('Save failed'));
      }
      return Promise.resolve({});
    });

    useGatewayStore.setState({ client: createMockClient(mockRequest) });
    useConfigStore.setState({ gatewayConfig: makeGatewayConfig('current-model') });

    render(<SettingsPanel />);

    // Verify initial value
    expect(screen.getByDisplayValue('current-model')).toBeTruthy();

    // User edits
    const modelInput = screen.getByDisplayValue('current-model');
    fireEvent.change(modelInput, { target: { value: 'attempted-change' } });

    // Simulate WS reconnect after failed save
    act(() => {
      useConfigStore.setState({ gatewayConfig: makeGatewayConfig('current-model') });
    });

    // User's edit should be preserved (syncNeeded was never set to true since save failed)
    expect(screen.getByDisplayValue('attempted-change')).toBeTruthy();
  });
});

describe('API key status guidance', () => {
  beforeEach(() => {
    mockModalConfirm.mockReset();
    mockMessageSuccess.mockReset();
    mockMessageError.mockReset();
    useConfigStore.setState({
      theme: 'dark',
      locale: 'en',
      systemPromptAppend: '',
      bootState: 'ready',
      pendingConfigRestart: false,
      gatewayConfig: null,
      gatewayConfigLoading: false,
      _configRetryCount: 0,
    });
    useGatewayStore.setState({
      client: createMockClient(),
      state: 'connected',
      serverVersion: '0.5.11',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows keep-current-key guidance via placeholder when the current provider already has a configured key', () => {
    useConfigStore.setState({
      gatewayConfig: makeGatewayConfig('deepseek-v4-pro', 'deepseek', 'https://api.deepseek.com', {
        apiKey: '__OPENCLAW_REDACTED__',
      }),
    });

    render(<SettingsPanel />);

    expect(screen.getByPlaceholderText('setup.apiKeyExisting')).toBeTruthy();
    // The configured deepseek preset now also surfaces as a saved API profile
    // row, so the "configured" suffix can appear on both the provider button
    // and the profile row.
    expect(screen.getAllByText(/settings\.providerConfigured/).length).toBeGreaterThan(0);
  });

  it('shows replace guidance after typing a new API key', () => {
    useConfigStore.setState({
      gatewayConfig: makeGatewayConfig('deepseek-v4-pro', 'deepseek', 'https://api.deepseek.com', {
        apiKey: '__OPENCLAW_REDACTED__',
      }),
    });

    render(<SettingsPanel />);

    const apiKeyInput = screen.getByPlaceholderText('setup.apiKeyExisting');
    fireEvent.change(apiKeyInput, { target: { value: 'sk-new-openai-key' } });

    expect(screen.getAllByText('settings.apiKeyWillUpdate').length).toBeGreaterThan(0);
  });

  it('shows delete guidance after clearing an existing API key', () => {
    useConfigStore.setState({
      gatewayConfig: makeGatewayConfig('deepseek-v4-pro', 'deepseek', 'https://api.deepseek.com', {
        apiKey: '__OPENCLAW_REDACTED__',
      }),
    });

    render(<SettingsPanel />);

    fireEvent.click(screen.getByText('settings.clearApiKey'));

    expect(screen.getAllByText('settings.apiKeyDeletePending').length).toBeGreaterThan(0);
  });

  it('removes "configured" suffix from provider button after clearing API key', () => {
    useConfigStore.setState({
      gatewayConfig: makeGatewayConfig('deepseek-v4-pro', 'deepseek', 'https://api.deepseek.com', {
        apiKey: '__OPENCLAW_REDACTED__',
      }),
    });

    render(<SettingsPanel />);

    // Before clear: the provider button shows the configured suffix.
    // (Scope to the button label form "DeepSeek · …" so the saved-profile
    // row's own "configured" suffix does not interfere.)
    expect(screen.getByText(/DeepSeek · settings\.providerConfigured/)).toBeTruthy();

    fireEvent.click(screen.getByText('settings.clearApiKey'));

    // After clear: the provider button suffix must disappear immediately.
    expect(screen.queryByText(/DeepSeek · settings\.providerConfigured/)).toBeNull();
  });

  it('does not keep the existing-key placeholder after clear is requested', () => {
    useConfigStore.setState({
      gatewayConfig: makeGatewayConfig('deepseek-v4-pro', 'deepseek', 'https://api.deepseek.com', {
        apiKey: '__OPENCLAW_REDACTED__',
      }),
    });

    render(<SettingsPanel />);

    fireEvent.click(screen.getByText('settings.clearApiKey'));

    expect(screen.queryByPlaceholderText('setup.apiKeyExisting')).toBeNull();
    expect(screen.getByPlaceholderText('setup.apiKeyPlaceholder')).toBeTruthy();
  });

  it('marks inactive providers with configured status in the provider picker labels', () => {
    useConfigStore.setState({
      gatewayConfig: makeGatewayConfig('deepseek-v4-pro', 'deepseek', 'https://api.deepseek.com', {
        apiKey: '__OPENCLAW_REDACTED__',
        extraProviders: {
          anthropic: {
            baseUrl: 'https://api.anthropic.com/v1',
            api: 'anthropic-messages',
            apiKey: '__OPENCLAW_REDACTED__',
            models: [{ id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5' }],
          },
        },
      }),
    });

    render(<SettingsPanel />);

    expect(screen.getByText(/DeepSeek · settings\.providerConfigured/)).toBeTruthy();
  });

  it('sends the current provider key with the atomic provider upsert', async () => {
    const mockRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'rc.auth.statuses') return Promise.resolve({ deepseek: { configured: true } });
      if (method === 'config.get') {
        return Promise.resolve({
          config: makeGatewayConfig('deepseek-v4-pro', 'deepseek', 'https://api.deepseek.com', {
            apiKey: '__OPENCLAW_REDACTED__',
          }),
          hash: 'hash123',
        });
      }
      if (method === 'rc.auth.setApiKey') return Promise.resolve({ ok: true, provider: 'deepseek', profileId: 'deepseek:manual' });
      if (method === 'config.apply') return Promise.resolve({});
      return Promise.resolve({});
    });

    useGatewayStore.setState({ client: createMockClient(mockRequest) });
    useConfigStore.setState({
      gatewayConfig: makeGatewayConfig('deepseek-v4-pro', 'deepseek', 'https://api.deepseek.com', {
        apiKey: '__OPENCLAW_REDACTED__',
      }),
    });

    render(<SettingsPanel />);
    expect(screen.getByDisplayValue('deepseek-v4-pro')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('setup.apiKeyExisting'), {
      target: { value: 'sk-fresh-openai' },
    });
    clickConfigSaveButton();

    const confirmCall = mockModalConfirm.mock.calls[0][0] as { onOk: () => Promise<void> };
    await confirmCall.onOk();

    expect(mockRequest).toHaveBeenCalledWith('rc.provider.upsert', expect.objectContaining({
      desiredConfig: expect.any(Object),
      authActions: [{ provider: 'deepseek', apiKey: 'sk-fresh-openai' }],
    }));
  });

  it('clears the auth-profile key when the user removes it and saves', async () => {
    const mockRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'rc.auth.statuses') return Promise.resolve({ deepseek: { configured: true } });
      if (method === 'config.get') {
        return Promise.resolve({
          config: makeGatewayConfig('deepseek-v4-pro', 'deepseek', 'https://api.deepseek.com', {
            apiKey: '__OPENCLAW_REDACTED__',
          }),
          hash: 'hash456',
        });
      }
      if (method === 'rc.auth.clearApiKey') return Promise.resolve({ ok: true, provider: 'deepseek', removed: ['deepseek:manual'] });
      if (method === 'config.apply') return Promise.resolve({});
      return Promise.resolve({});
    });

    useGatewayStore.setState({ client: createMockClient(mockRequest) });
    useConfigStore.setState({
      gatewayConfig: makeGatewayConfig('deepseek-v4-pro', 'deepseek', 'https://api.deepseek.com', {
        apiKey: '__OPENCLAW_REDACTED__',
      }),
    });

    render(<SettingsPanel />);
    expect(screen.getByDisplayValue('deepseek-v4-pro')).toBeTruthy();

    fireEvent.click(screen.getByText('settings.clearApiKey'));
    clickConfigSaveButton();

    const confirmCall = mockModalConfirm.mock.calls[0][0] as { onOk: () => Promise<void> };
    await confirmCall.onOk();

    expect(mockRequest).toHaveBeenCalledWith('rc.provider.upsert', expect.objectContaining({
      authActions: [{ provider: 'deepseek', clear: true }],
    }));
  });

  it('does not write the redacted sentinel back into config when only auth-profiles has the key', async () => {
    const mockRequest = vi.fn().mockImplementation((method: string, params?: unknown) => {
      if (method === 'rc.auth.statuses') return Promise.resolve({ 'zai-coding': { configured: true } });
      if (method === 'config.get') {
        return Promise.resolve({
          config: makeGatewayConfig('glm-5', 'zai-coding', 'https://open.bigmodel.cn/api/coding/paas/v4'),
          hash: 'hash789',
        });
      }
      if (method === 'config.apply') return Promise.resolve({});
      return Promise.resolve({});
    });

    useGatewayStore.setState({ client: createMockClient(mockRequest) });
    useConfigStore.setState({
      gatewayConfig: makeGatewayConfig('glm-5', 'zai-coding', 'https://open.bigmodel.cn/api/coding/paas/v4'),
    });

    render(<SettingsPanel />);
    expect(screen.getByDisplayValue('glm-5')).toBeTruthy();

    // Dirty the form so the Save button is enabled (Save is gated on changes).
    fireEvent.change(screen.getByDisplayValue('glm-5'), { target: { value: 'glm-5-edited' } });

    clickConfigSaveButton();

    const confirmCall = mockModalConfirm.mock.calls[0][0] as { onOk: () => Promise<void> };
    await confirmCall.onOk();

    const upsertCall = mockRequest.mock.calls.find((call: unknown[]) => call[0] === 'rc.provider.upsert');
    expect(upsertCall).toBeTruthy();
    const upsertPayload = upsertCall?.[1] as { desiredConfig: Record<string, unknown> };
    expect(JSON.stringify(upsertPayload.desiredConfig)).not.toContain('__OPENCLAW_REDACTED__');
  });

  it('preserves a previously seen redacted provider when a later config.get snapshot omits it', async () => {
    const initialProjectConfig = {
      agents: {
        defaults: {
          model: { primary: 'zai-coding-global/glm-5' },
          imageModel: { primary: 'zai-coding-global/glm-5' },
        },
      },
      models: {
        providers: {
          'zai-coding-global': {
            baseUrl: 'https://api.z.ai/api/coding/paas/v4',
            api: 'openai-completions',
            apiKey: '__OPENCLAW_REDACTED__',
            models: [{ id: 'glm-5', name: 'glm-5' }],
          },
        },
      },
    };

    const minimaxOnlyProjectConfig = {
      agents: {
        defaults: {
          model: { primary: 'minimax/MiniMax-M2.7' },
          imageModel: { primary: 'minimax/MiniMax-M2.7' },
        },
      },
      models: {
        providers: {
          minimax: {
            baseUrl: 'https://api.minimax.io/anthropic',
            api: 'anthropic-messages',
            apiKey: '__OPENCLAW_REDACTED__',
            models: [{ id: 'MiniMax-M2.7', name: 'MiniMax-M2.7' }],
          },
        },
      },
    };

    const mockRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'rc.auth.statuses') return Promise.resolve({});
      if (method === 'config.get') {
        return Promise.resolve({
          config: minimaxOnlyProjectConfig,
          hash: 'hash-preserve-provider',
        });
      }
      if (method === 'config.apply') return Promise.resolve({});
      return Promise.resolve({});
    });

    useGatewayStore.setState({ client: createMockClient(mockRequest) });
    useConfigStore.setState({
      gatewayConfig: {
        ...(initialProjectConfig as ReturnType<typeof makeGatewayConfig>),
        projectConfig: initialProjectConfig,
      },
    });

    render(<SettingsPanel />);
    expect(screen.getByDisplayValue('glm-5')).toBeTruthy();

    act(() => {
      useConfigStore.setState({
        gatewayConfig: {
          ...(minimaxOnlyProjectConfig as ReturnType<typeof makeGatewayConfig>),
          projectConfig: minimaxOnlyProjectConfig,
        },
      });
    });

    // Form keeps the stale glm-5 (syncNeeded false); dirty it so Save is enabled.
    fireEvent.change(screen.getByDisplayValue('glm-5'), { target: { value: 'glm-5-edited' } });

    clickConfigSaveButton();

    const confirmCall = mockModalConfirm.mock.calls[0][0] as { onOk: () => Promise<void> };
    await confirmCall.onOk();

    const upsertCall = mockRequest.mock.calls.find((call: unknown[]) => call[0] === 'rc.provider.upsert');
    expect(upsertCall).toBeTruthy();
    const upsertPayload = upsertCall?.[1] as { desiredConfig: Record<string, unknown> };
    const serialized = JSON.stringify(upsertPayload.desiredConfig);
    expect(serialized).toContain('"zai-coding-global"');
    expect(serialized).toContain('__OPENCLAW_REDACTED__');
  });
});

// ============================================================
// Saved API profile switch ("Use" / 切换)
// ============================================================

describe('Saved API profile switch', () => {
  /** Config with two custom profiles; custom-relay-a is active. */
  function makeTwoProfileConfig() {
    return {
      agents: {
        defaults: {
          model: { primary: 'custom-relay-a/m0' },
          imageModel: { primary: 'custom-relay-a/m0' },
        },
      },
      models: {
        providers: {
          'custom-relay-a': {
            baseUrl: 'https://a.example/v1',
            api: 'openai-completions',
            apiKey: '__OPENCLAW_REDACTED__',
            models: [{ id: 'm0', name: 'Relay A' }],
          },
          'custom-relay-b': {
            baseUrl: 'https://b.example/v1',
            api: 'openai-completions',
            apiKey: '__OPENCLAW_REDACTED__',
            models: [{ id: 'gpt-4o', name: 'Relay B' }],
          },
        },
      },
    };
  }

  beforeEach(() => {
    mockModalConfirm.mockReset();
    mockMessageSuccess.mockReset();
    mockMessageError.mockReset();
    useConfigStore.setState({
      theme: 'dark',
      locale: 'en',
      systemPromptAppend: '',
      bootState: 'ready',
      pendingConfigRestart: false,
      gatewayConfig: null,
      gatewayConfigLoading: false,
      _configRetryCount: 0,
    });
    useGatewayStore.setState({
      client: createMockClient(),
      state: 'connected',
      serverVersion: '0.7.1',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('upserts a config whose primary points at the target profile and shows success', async () => {
    const mockRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'rc.auth.statuses') return Promise.resolve({});
      if (method === 'config.get') {
        return Promise.resolve({ config: makeTwoProfileConfig(), hash: 'hash-switch' });
      }
      if (method === 'rc.provider.upsert') return Promise.resolve({});
      return Promise.resolve({});
    });

    useGatewayStore.setState({ client: createMockClient(mockRequest) });
    useConfigStore.setState({ gatewayConfig: makeTwoProfileConfig() });

    render(<SettingsPanel />);

    // The non-active profile (Relay B) exposes a "Use" control.
    const useButton = screen.getByText('settings.apiProfilesUse');
    await act(async () => {
      fireEvent.click(useButton);
    });

    const upsertCall = mockRequest.mock.calls.find((call: unknown[]) => call[0] === 'rc.provider.upsert');
    expect(upsertCall).toBeTruthy();
    const upsertPayload = upsertCall?.[1] as { desiredConfig: Record<string, unknown> };
    const defaults = (upsertPayload.desiredConfig.agents as Record<string, unknown>).defaults as Record<string, unknown>;
    expect((defaults.model as { primary?: string }).primary).toBe('custom-relay-b/gpt-4o');

    // Switching must not drop the non-target provider entry from the upsert payload.
    const providers = (
      (upsertPayload.desiredConfig.models as Record<string, unknown>).providers as Record<string, unknown>
    );
    expect(providers['custom-relay-a']).toBeDefined();

    expect(mockMessageSuccess).toHaveBeenCalled();
    expect(mockMessageError).not.toHaveBeenCalled();
  });

  it('shows an error message when the switch upsert rejects', async () => {
    const mockRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'rc.auth.statuses') return Promise.resolve({});
      if (method === 'config.get') {
        return Promise.resolve({ config: makeTwoProfileConfig(), hash: 'hash-switch' });
      }
      if (method === 'rc.provider.upsert') return Promise.reject(new Error('switch failed'));
      return Promise.resolve({});
    });

    useGatewayStore.setState({ client: createMockClient(mockRequest) });
    useConfigStore.setState({ gatewayConfig: makeTwoProfileConfig() });

    render(<SettingsPanel />);

    const useButton = screen.getByText('settings.apiProfilesUse');
    await act(async () => {
      fireEvent.click(useButton);
    });

    expect(mockMessageError).toHaveBeenCalled();
    expect(mockMessageSuccess).not.toHaveBeenCalled();
  });
});

// ============================================================
// Restart button in settings panel
// ============================================================

describe('Restart Research-Claw button', () => {
  beforeEach(() => {
    mockModalConfirm.mockReset();
    mockMessageSuccess.mockReset();
    mockMessageError.mockReset();
    useConfigStore.setState({
      theme: 'dark',
      locale: 'en',
      systemPromptAppend: '',
      bootState: 'ready',
      pendingConfigRestart: false,
      gatewayConfig: makeGatewayConfig(),
      gatewayConfigLoading: false,
      _configRetryCount: 0,
    });
    useGatewayStore.setState({
      client: createMockClient(),
      state: 'connected',
      serverVersion: '0.6.0',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders restart button in about section', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('settings.restart')).toBeTruthy();
  });

  it('opens confirm modal when restart button is clicked', () => {
    render(<SettingsPanel />);
    const restartBtn = screen.getByText('settings.restart');
    fireEvent.click(restartBtn);
    expect(mockModalConfirm).toHaveBeenCalledTimes(1);
    expect(mockModalConfirm.mock.calls[0][0]).toHaveProperty('title', 'settings.restartConfirm');
  });

  it('calls config.get + config.apply on confirm (no-op restart)', async () => {
    const mockRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'config.get') {
        return Promise.resolve({
          config: makeGatewayConfig(),
          raw: '{"test":true}',
          hash: 'abc123',
        });
      }
      if (method === 'config.apply') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    useGatewayStore.setState({ client: createMockClient(mockRequest) });

    render(<SettingsPanel />);
    const restartBtn = screen.getByText('settings.restart');
    fireEvent.click(restartBtn);

    // Invoke the onOk callback from the confirm modal
    const confirmCall = mockModalConfirm.mock.calls[0][0] as { onOk: () => Promise<void> };
    await confirmCall.onOk();

    // Should have called config.get then config.apply with serialized snapshot config
    expect(mockRequest).toHaveBeenCalledWith('config.get', {});
    expect(mockRequest).toHaveBeenCalledWith('config.apply', {
      raw: serializeConfigForGatewayApply(makeGatewayConfig()),
      baseHash: 'abc123',
    });
    expect(mockMessageSuccess).toHaveBeenCalledWith('settings.restartSuccess');
  });

  it('shows error message when restart fails', async () => {
    const mockRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'config.get') {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({});
    });

    useGatewayStore.setState({ client: createMockClient(mockRequest) });

    render(<SettingsPanel />);
    fireEvent.click(screen.getByText('settings.restart'));

    const confirmCall = mockModalConfirm.mock.calls[0][0] as { onOk: () => Promise<void> };
    await confirmCall.onOk();

    expect(mockMessageError).toHaveBeenCalledWith('settings.restartFailed');
  });
});

// ============================================================
// Save button dirty gating — disabled until a config field changes
// ============================================================

describe('Save button dirty gating', () => {
  function getConfigSaveButton(): HTMLButtonElement {
    const saveButtons = screen.getAllByRole('button', { name: /settings\.save|setup\.gatewayRestarting/i });
    const btn = saveButtons.find((b) => b.parentElement?.textContent?.includes('settings.restartHint')) ?? saveButtons[0];
    return btn as HTMLButtonElement;
  }

  beforeEach(() => {
    mockModalConfirm.mockReset();
    mockMessageSuccess.mockReset();
    mockMessageError.mockReset();
    useConfigStore.setState({
      theme: 'dark',
      locale: 'en',
      systemPromptAppend: '',
      bootState: 'ready',
      pendingConfigRestart: false,
      gatewayConfig: null,
      gatewayConfigLoading: false,
      _configRetryCount: 0,
    });
    useGatewayStore.setState({
      client: createMockClient(),
      state: 'connected',
      serverVersion: '0.6.3',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables the save button when the form matches the loaded config', () => {
    useConfigStore.setState({ gatewayConfig: makeGatewayConfig('m1', 'openai', 'https://api.openai.com/v1') });

    render(<SettingsPanel />);

    expect(getConfigSaveButton().disabled).toBe(true);
  });

  it('enables the save button after editing a config field', () => {
    useConfigStore.setState({ gatewayConfig: makeGatewayConfig('m1', 'openai', 'https://api.openai.com/v1') });

    render(<SettingsPanel />);
    expect(getConfigSaveButton().disabled).toBe(true);

    fireEvent.change(screen.getByDisplayValue('m1'), { target: { value: 'm2' } });

    expect(getConfigSaveButton().disabled).toBe(false);
  });

  it('disables the save button again when the edit is reverted to the baseline', () => {
    useConfigStore.setState({ gatewayConfig: makeGatewayConfig('m1', 'openai', 'https://api.openai.com/v1') });

    render(<SettingsPanel />);

    const modelInput = screen.getByDisplayValue('m1');
    fireEvent.change(modelInput, { target: { value: 'm2' } });
    expect(getConfigSaveButton().disabled).toBe(false);

    fireEvent.change(screen.getByDisplayValue('m2'), { target: { value: 'm1' } });
    expect(getConfigSaveButton().disabled).toBe(true);
  });
});

// ============================================================
// Task 2: independent vision endpoint + protocol auto-align
// ============================================================

describe('Vision independent endpoint + protocol auto-align', () => {
  /** Text on openai, vision on a distinct custom-* profile. */
  function makeSeparateVisionConfig() {
    return {
      agents: {
        defaults: {
          model: { primary: 'openai/gpt-4o' },
          imageModel: { primary: 'custom-relay-b/qwen-vl' },
        },
      },
      models: {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            api: 'openai-completions',
            apiKey: '__OPENCLAW_REDACTED__',
            models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
          },
          'custom-relay-b': {
            baseUrl: 'https://b.example/v1',
            api: 'openai-completions',
            apiKey: '__OPENCLAW_REDACTED__',
            models: [{ id: 'qwen-vl', name: 'Qwen VL' }],
          },
        },
      },
    };
  }

  /** Text and vision both on bare `custom` (same key → vision inherits). */
  function makeSharedVisionConfig() {
    return {
      agents: {
        defaults: {
          model: { primary: 'custom/text-model' },
          imageModel: { primary: 'custom/vision-model' },
        },
      },
      models: {
        providers: {
          custom: {
            baseUrl: 'https://api.example.com/v1',
            api: 'openai-completions',
            apiKey: '__OPENCLAW_REDACTED__',
            models: [
              { id: 'text-model', name: 'Text' },
              { id: 'vision-model', name: 'Vision' },
            ],
          },
        },
      },
    };
  }

  beforeEach(() => {
    mockModalConfirm.mockReset();
    mockMessageSuccess.mockReset();
    mockMessageError.mockReset();
    useConfigStore.setState({
      theme: 'dark',
      locale: 'en',
      systemPromptAppend: '',
      bootState: 'ready',
      pendingConfigRestart: false,
      gatewayConfig: null,
      gatewayConfigLoading: false,
      _configRetryCount: 0,
    });
    useGatewayStore.setState({
      client: createMockClient(),
      state: 'connected',
      serverVersion: '0.7.1',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the vision URL, protocol Select, and key fields when vision uses a distinct custom profile', () => {
    useConfigStore.setState({ gatewayConfig: makeSeparateVisionConfig() });

    render(<SettingsPanel />);

    // Vision URL field is visible with the vision provider's own baseUrl
    expect(screen.getByDisplayValue('https://b.example/v1')).toBeTruthy();
    // Vision advanced label + protocol field render (text provider is openai → no text protocol Select)
    expect(screen.getByText('settings.advancedVisionEndpoint')).toBeTruthy();
    expect(screen.getByText('settings.apiProtocol')).toBeTruthy();
    // Vision key field label is visible
    expect(screen.getByText('settings.visionApiKey')).toBeTruthy();
  });

  it('auto-aligns the vision protocol to anthropic-messages when the vision URL contains /anthropic', () => {
    useConfigStore.setState({ gatewayConfig: makeSeparateVisionConfig() });

    render(<SettingsPanel />);

    const visionUrlInput = screen.getByDisplayValue('https://b.example/v1');
    fireEvent.change(visionUrlInput, { target: { value: 'https://relay-b.example/anthropic' } });

    // The vision protocol Select now displays the Anthropic-compatible option label
    expect(screen.getByText('Anthropic Compatible')).toBeTruthy();
  });

  it('hides independent vision fields and shows the inherit hint when vision provider equals the text provider', () => {
    useConfigStore.setState({ gatewayConfig: makeSharedVisionConfig() });

    render(<SettingsPanel />);

    // No independent vision endpoint fields
    expect(screen.queryByText('settings.advancedVisionEndpoint')).toBeNull();
    expect(screen.queryByText('settings.visionApiKey')).toBeNull();
    // The inherit hint is shown
    expect(screen.getByText('settings.visionInheritsText')).toBeTruthy();
  });

  /** Text on openai + vision on openai (distinct model) → vision enabled and
   *  initially inheriting the text provider, with NO custom-* keys in config. */
  function makeVisionInheritsOpenaiConfig() {
    return {
      agents: {
        defaults: {
          model: { primary: 'openai/gpt-4o' },
          imageModel: { primary: 'openai/gpt-4o-vision' },
        },
      },
      models: {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            api: 'openai-completions',
            apiKey: '__OPENCLAW_REDACTED__',
            models: [
              { id: 'gpt-4o', name: 'GPT-4o' },
              { id: 'gpt-4o-vision', name: 'GPT-4o Vision' },
            ],
          },
        },
      },
    };
  }

  it('allocates a vision provider key distinct from an in-flight (unsaved) text custom profile', () => {
    // Config has no custom-* keys: an in-flight text custom profile the user
    // just created via "Add custom profile" is NOT yet persisted, so it does
    // not appear in listApiProfilesFromConfig. The first such profile claims the
    // bare `custom` slot. When the user then creates a vision custom profile,
    // a naive allocator that only consulted the config-derived profile set would
    // re-pick `custom` and overwrite the in-flight text endpoint. The explicit
    // existingIds.add(provider) guard in beginNewVisionCustomProfile prevents
    // that collision.
    useConfigStore.setState({ gatewayConfig: makeVisionInheritsOpenaiConfig() });

    render(<SettingsPanel />);

    const openaiProviderButtons = () =>
      screen.getAllByRole('button').filter((b) => /^OpenAI/.test(b.textContent ?? ''));

    // Initially both the text and vision provider buttons read "OpenAI".
    expect(openaiProviderButtons().length).toBe(2);

    // 1) Create an in-flight TEXT custom profile → claims the bare `custom` key,
    //    which is NOT present in config (so config-listing cannot see it). The
    //    text provider button is the first of the two OpenAI buttons.
    fireEvent.click(openaiProviderButtons()[0]);
    act(() => {
      fireEvent.click(screen.getByText('providerPicker.addCustomProfile'));
    });

    // The text provider button now shows the in-flight `custom` key; no `custom-*`
    // slot exists yet.
    expect(screen.getAllByText('custom').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^custom-/)).toBeNull();

    // 2) Create a VISION custom profile. The vision provider still reads OpenAI
    //    (it was never changed), so it is now the single remaining OpenAI button.
    const remainingOpenai = openaiProviderButtons();
    expect(remainingOpenai.length).toBe(1);
    fireEvent.click(remainingOpenai[0]);
    act(() => {
      // The vision picker mounts after the text picker in document order, so the
      // last "add custom profile" card belongs to the (now open) vision picker.
      const addCards = screen.getAllByText('providerPicker.addCustomProfile');
      fireEvent.click(addCards[addCards.length - 1]);
    });

    // The new vision profile MUST land on a key distinct from the in-flight text
    // `custom` provider — observable two ways through the public UI:
    //  (1) the separate vision-endpoint advanced section now renders — it only
    //      appears when visionProvider !== provider, so a collision back onto
    //      `custom` would have kept it hidden; and
    //  (2) a fresh `custom-*` provider key surfaces (the new vision slot) while
    //      the in-flight text `custom` key is still present, proving the text
    //      profile was not overwritten by the vision entry.
    expect(screen.getByText('settings.advancedVisionEndpoint')).toBeTruthy();
    expect(screen.getAllByText(/^custom-/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('custom').length).toBeGreaterThan(0);
  });
});
