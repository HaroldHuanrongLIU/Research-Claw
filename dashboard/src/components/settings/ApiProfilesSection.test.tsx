import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ApiProfilesSection from './ApiProfilesSection';
import type { ApiProfile, ApiProfileEntry } from '../../utils/api-profiles';

// Mock antd App.useApp (modal.confirm)
vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  const MockApp = Object.assign(
    (props: Record<string, unknown>) => (actual.App as unknown as (p: unknown) => unknown)(props),
    {
      ...actual.App,
      useApp: () => ({ modal: { confirm: vi.fn() }, message: {}, notification: {} }),
    },
  );
  return { ...actual, App: MockApp };
});

// Mock i18next — the t mock echoes the key so we can assert which key was used.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      typeof opts?.defaultValue === 'string' && !key.includes('.') ? (opts.defaultValue as string) : key,
    i18n: { changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

function makeProfile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    id: 'custom-relay-a',
    label: 'Relay A',
    baseUrl: 'https://a.example/v1',
    api: 'openai-completions',
    modelId: 'm0',
    apiKeyConfigured: true,
    isActive: false,
    isBuiltin: false,
    requiresApiKey: true,
    ...overrides,
  };
}

function renderSection(profiles: ApiProfileEntry[], onSelectProfile = vi.fn()) {
  return render(
    <ApiProfilesSection
      profiles={profiles}
      activeProviderId=""
      onSelectProfile={onSelectProfile}
      onActivateProfile={vi.fn().mockResolvedValue(undefined)}
      onAddProfile={vi.fn()}
      onDeleteProfile={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe('ApiProfilesSection', () => {
  it('shows an OAuth status for OAuth presets instead of "API key missing"', () => {
    renderSection([
      makeProfile({
        id: 'openai',
        label: 'OpenAI ChatGPT (OAuth)',
        isBuiltin: true,
        requiresApiKey: false,
        apiKeyConfigured: false,
      }),
    ]);
    expect(screen.getByText(/settings\.apiProfilesOAuth/)).toBeTruthy();
    expect(screen.queryByText(/settings\.apiKeyMissing/)).toBeNull();
  });

  it('shows Configured for a non-OAuth preset with a saved key', () => {
    renderSection([
      makeProfile({
        id: 'deepseek',
        label: 'DeepSeek',
        isBuiltin: true,
        requiresApiKey: true,
        apiKeyConfigured: true,
      }),
    ]);
    expect(screen.getByText(/settings\.providerConfigured/)).toBeTruthy();
    expect(screen.queryByText(/settings\.apiProfilesOAuth/)).toBeNull();
  });

  it('shows the missing-key status for a non-OAuth profile without a key', () => {
    renderSection([makeProfile({ apiKeyConfigured: false })]);
    expect(screen.getByText(/settings\.apiKeyMissing/)).toBeTruthy();
  });

  it('renders an unsaved draft entry with the draft marker and no activation, and does not re-select on click', () => {
    const onSelect = vi.fn();
    const draft: ApiProfileEntry = {
      ...makeProfile({ id: 'custom-2', label: 'Draft X', apiKeyConfigured: false }),
      unsaved: true,
    };
    renderSection([draft], onSelect);

    // Shared draft marker is shown; no "Use" activation button for an unsaved draft.
    expect(screen.getByText('providerPicker.unsavedDraft')).toBeTruthy();
    expect(screen.queryByText(/settings\.apiProfilesUse/)).toBeNull();

    // Clicking the row must not re-select (would re-hydrate config and wipe edits).
    fireEvent.click(screen.getByText('Draft X'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
