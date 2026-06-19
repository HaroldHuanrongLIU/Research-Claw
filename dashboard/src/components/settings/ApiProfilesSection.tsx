import React from 'react';
import { App, Button, Collapse, List, Space, Tag, Tooltip, Typography } from 'antd';
import { CheckOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ApiProfile, ApiProfileEntry } from '../../utils/api-profiles';
import { UNSAVED_PROFILE_BORDER, UNSAVED_PROFILE_BG, UNSAVED_PROFILE_TAG_KEY } from './api-profile-card-style';

const { Text } = Typography;

export interface ApiProfilesSectionProps {
  profiles: ApiProfileEntry[];
  /** Currently edited provider key in the form. */
  activeProviderId: string;
  loading?: boolean;
  /** Load profile fields into the editor (no save). */
  onSelectProfile: (profile: ApiProfile) => void;
  /** Switch agents.defaults.model.primary to this profile and save. */
  onActivateProfile: (profile: ApiProfile) => Promise<void>;
  /** Create a new custom profile slot (same flow as provider picker → Custom). */
  onAddProfile: () => void;
  /** Remove profile from config on save. */
  onDeleteProfile: (profile: ApiProfile) => Promise<void>;
}

function summarizeUrl(url: string): string {
  if (!url) return '—';
  try {
    const u = new URL(url);
    return u.host + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url.length > 36 ? `${url.slice(0, 36)}…` : url;
  }
}

export default function ApiProfilesSection({
  profiles,
  activeProviderId,
  loading,
  onSelectProfile,
  onActivateProfile,
  onAddProfile,
  onDeleteProfile,
}: ApiProfilesSectionProps) {
  const { t } = useTranslation();
  const { modal } = App.useApp();

  const hasProfiles = profiles.length > 0;

  return (
    <div style={{ marginBottom: 12 }}>
      <Collapse
        ghost
        defaultActiveKey={[]}
        size="small"
        expandIconPosition="start"
        style={{
          background: 'transparent',
          border: 'none',
        }}
        items={[
          {
            key: 'apiProfiles',
            label: (
              <div style={{ display: 'flex', alignItems: 'center', minHeight: 28 }}>
                <Text style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {t('settings.apiProfilesTitle', { defaultValue: 'Saved API profiles' })}
                </Text>
              </div>
            ),
            extra: (
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  onAddProfile();
                }}
                style={{ padding: '0 2px', height: 24, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                {t('settings.apiProfilesAdd', { defaultValue: 'Add' })}
              </Button>
            ),
            style: {
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'transparent',
              overflow: 'hidden',
            },
            styles: {
              header: {
                padding: '8px 10px',
                alignItems: 'center',
                background: 'rgba(255,255,255,0.02)',
                borderBottom: '1px solid var(--border)',
              },
              body: {
                padding: '10px',
              },
            },
            children: (
              <>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
                  {t('settings.apiProfilesDesc', {
                    defaultValue:
                      'Save multiple custom gateways (base URL, API key, model). Switch without re-entering.',
                  })}
                </Text>

                {!hasProfiles ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('settings.apiProfilesEmpty', {
                      defaultValue:
                        'No saved profiles yet. Click Add or choose Custom under Provider, then fill in URL, key, and model below and Save.',
                    })}
                  </Text>
                ) : (
                  <List
                    size="small"
                    dataSource={profiles}
                    style={{
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      overflow: 'hidden',
                    }}
                    renderItem={(profile) => {
                      const selected = profile.id === activeProviderId;
                      const unsaved = profile.unsaved === true;
                      const statusText = !profile.requiresApiKey
                        ? t('settings.apiProfilesOAuth', { defaultValue: 'OAuth' })
                        : profile.apiKeyConfigured
                          ? t('settings.providerConfigured')
                          : t('settings.apiKeyMissing');
                      return (
                        <List.Item
                          style={{
                            padding: '12px 14px',
                            cursor: unsaved ? 'default' : 'pointer',
                            alignItems: 'stretch',
                            // An unsaved draft is already loaded in the editor below, so it
                            // gets a distinct dashed-accent treatment but no re-select click
                            // (which would re-hydrate from config and wipe in-progress edits).
                            border: unsaved ? UNSAVED_PROFILE_BORDER : undefined,
                            background: unsaved
                              ? UNSAVED_PROFILE_BG
                              : selected
                                ? 'rgba(59, 130, 246, 0.12)'
                                : undefined,
                          }}
                          onClick={unsaved ? undefined : () => onSelectProfile(profile)}
                        >
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'minmax(0, 1fr) 104px',
                              alignItems: 'start',
                              gap: 12,
                              width: '100%',
                              minWidth: 0,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                                {profile.isActive ? <CheckOutlined style={{ color: 'var(--accent-primary)', fontSize: 13, flexShrink: 0 }} /> : null}
                                <span
                                  style={{
                                    display: 'block',
                                    minWidth: 0,
                                    maxWidth: '100%',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: 'var(--text-primary)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {profile.label}
                                </span>
                              </div>
                              <div style={{ display: 'grid', gap: 3, marginTop: 5, fontSize: 11, color: 'var(--text-tertiary)', minWidth: 0 }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {summarizeUrl(profile.baseUrl)}
                                </span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {profile.modelId || '—'} · {statusText}
                                </span>
                              </div>
                            </div>

                            <div
                              style={{
                                width: 104,
                                flexShrink: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                                gap: 8,
                                minHeight: 34,
                              }}
                            >
                              {unsaved ? (
                                <Tag
                                  style={{
                                    margin: 0,
                                    borderStyle: 'dashed',
                                    borderColor: 'var(--accent-primary)',
                                    color: 'var(--accent-primary)',
                                    background: 'transparent',
                                    maxWidth: 88,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {t(UNSAVED_PROFILE_TAG_KEY)}
                                </Tag>
                              ) : (
                                <>
                                  {profile.isActive ? (
                                    <Tag color="blue" style={{ margin: 0, lineHeight: '20px' }}>
                                      {t('settings.apiProfilesInUse', { defaultValue: 'In use' })}
                                    </Tag>
                                  ) : (
                                    <Button
                                      type="link"
                                      size="small"
                                      disabled={loading}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        // The handler surfaces its own success/error feedback; catch
                                        // here only to avoid an unhandled promise rejection.
                                        onActivateProfile(profile).catch(() => {});
                                      }}
                                      style={{ padding: '0 2px', height: 24 }}
                                    >
                                      {t('settings.apiProfilesUse', { defaultValue: 'Use' })}
                                    </Button>
                                  )}
                                  <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
                                  <Tooltip title={t('common.delete', { defaultValue: 'Delete' })}>
                                    <Button
                                      key="delete"
                                      type="text"
                                      size="small"
                                      danger
                                      icon={<DeleteOutlined />}
                                      disabled={loading}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        modal.confirm({
                                          title: t('settings.apiProfilesDeleteTitle', { defaultValue: 'Delete profile?' }),
                                          content: t('settings.apiProfilesDeleteDesc', {
                                            defaultValue: 'This removes saved credentials for "{{name}}".',
                                            name: profile.label,
                                          }),
                                          okText: t('common.delete', { defaultValue: 'Delete' }),
                                          okButtonProps: { danger: true },
                                          cancelText: t('settings.cancel'),
                                          centered: true,
                                          onOk: () => onDeleteProfile(profile),
                                        });
                                      }}
                                      style={{ width: 24, height: 24 }}
                                    />
                                  </Tooltip>
                                </>
                              )}
                            </div>
                          </div>
                        </List.Item>
                      );
                    }}
                  />
                )}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
