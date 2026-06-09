import { theme as antdTheme } from 'antd';
import type { ThemeConfig } from 'antd';

export const darkTheme = {
  bg: {
    primary: '#030303',
    secondary: '#0A0A0B',
    surface: '#141415',
    surfaceHover: '#1C1C1E',
    code: '#161618',
  },
  text: {
    primary: '#E4E4E7',
    secondary: '#A1A1AA',
    muted: '#71717A',
  },
  border: {
    default: 'rgba(255,255,255,0.08)',
    hover: 'rgba(255,255,255,0.15)',
  },
  accent: {
    red: '#EF4444',
    redHover: '#DC2626',
    blue: '#3B82F6',
    blueHover: '#2563EB',
    green: '#10B981',
    amber: '#F59E0B',
    error: '#F43F5E',
  },
  effects: {
    glowRed: '0 0 20px rgba(239,68,68,0.3)',
    glowBlue: '0 0 20px rgba(59,130,246,0.3)',
    glassBg: 'rgba(10,10,11,0.7)',
    glassBlur: '16px',
  },
} as const;

export const lightTheme = {
  bg: {
    primary: '#FFFBF5',
    secondary: '#FFF8F0',
    surface: '#FFF3E8',
    surfaceHover: '#FFEDD5',
    code: '#F5F0EA',
  },
  text: {
    primary: '#1C1917',
    secondary: '#78716C',
    muted: '#A8A29E',
  },
  border: {
    default: 'rgba(28,25,23,0.08)',
    hover: 'rgba(28,25,23,0.15)',
  },
  accent: {
    red: '#DC2626',
    redHover: '#B91C1C',
    blue: '#2563EB',
    blueHover: '#1D4ED8',
    green: '#059669',
    amber: '#D97706',
    error: '#E11D48',
  },
  effects: {
    glowRed: '0 0 20px rgba(239,68,68,0.15)',
    glowBlue: '0 0 20px rgba(59,130,246,0.15)',
    glassBg: 'rgba(255,251,245,0.85)',
    glassBlur: '12px',
  },
} as const;

export type ThemeTokens = {
  bg: { primary: string; secondary: string; surface: string; surfaceHover: string; code: string };
  text: { primary: string; secondary: string; muted: string };
  border: { default: string; hover: string };
  accent: { red: string; redHover: string; blue: string; blueHover: string; green: string; amber: string; error: string };
  effects: { glowRed: string; glowBlue: string; glassBg: string; glassBlur: string };
};

export function getThemeTokens(mode: 'dark' | 'light'): ThemeTokens {
  return mode === 'dark' ? darkTheme : lightTheme;
}

export function getAntdThemeConfig(mode: 'dark' | 'light'): ThemeConfig {
  const tokens = getThemeTokens(mode);
  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: tokens.accent.red,
      colorInfo: tokens.accent.blue,
      colorSuccess: tokens.accent.green,
      colorWarning: tokens.accent.amber,
      colorError: tokens.accent.error,
      colorBgContainer: tokens.bg.surface,
      colorBgElevated: tokens.bg.secondary,
      colorBgLayout: tokens.bg.primary,
      colorText: tokens.text.primary,
      colorTextSecondary: tokens.text.secondary,
      colorTextTertiary: tokens.text.muted,
      colorBorder: tokens.border.default,
      colorBorderSecondary: tokens.border.hover,
      borderRadius: 8,
      borderRadiusLG: 12,
      borderRadiusSM: 4,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      fontFamilyCode: "'Fira Code', 'JetBrains Mono', Consolas, monospace",
    },
    components: {
      Layout: {
        headerBg: tokens.bg.primary,
        bodyBg: tokens.bg.primary,
        footerBg: tokens.bg.primary,
        siderBg: tokens.bg.secondary,
      },
      Menu: {
        darkItemBg: 'transparent',
        darkSubMenuItemBg: 'transparent',
      },
      Button: {
        borderRadius: 8,
      },
      Input: {
        borderRadius: 8,
      },
      Switch: {
        // On-state carries the semantic "enabled/healthy" green instead of brand red,
        // so a toggle's state is legible at a glance in both themes.
        colorPrimary: tokens.accent.green,
        colorPrimaryHover: mode === 'dark' ? '#34D399' : '#047857',
      },
      Segmented: {
        // Default selected-thumb contrast is near-invisible on RC's ultra-dark and
        // warm-paper surfaces; sink the track and lift the thumb so the selection reads.
        trackBg: tokens.bg.primary,
        itemSelectedBg: tokens.bg.surfaceHover,
        itemSelectedColor: tokens.text.primary,
        itemColor: tokens.text.secondary,
        itemHoverColor: tokens.text.primary,
      },
    },
  };
}
