/**
 * Desktop-shell detection for the shared dashboard.
 *
 * The same dashboard build runs in three places: a plain browser, a Docker
 * deployment, and the Electron desktop app (`desktop/`). Only the Electron
 * shell injects `window.researchClaw.desktop` (see `desktop/src/preload.ts`),
 * so feature-detecting it tells us whether to switch on native-app styling
 * (frameless drag bar, traffic-light inset, vibrancy). Everywhere else this
 * returns false and the web UI is unchanged.
 */

interface DesktopInfo {
  platform: string;
  isMac: boolean;
}

interface NativeBridge {
  notify: (opts: { title: string; body?: string }) => Promise<void>;
  setBadge: (count: number) => Promise<void>;
}

interface ResearchClawBridge {
  desktop?: DesktopInfo;
  native?: NativeBridge;
}

function bridge(): ResearchClawBridge | undefined {
  return (window as unknown as { researchClaw?: ResearchClawBridge }).researchClaw;
}

/** True only when running inside the Electron desktop shell. */
export function isDesktop(): boolean {
  return Boolean(bridge()?.desktop);
}

/** Platform info from the desktop shell, or null in a plain browser. */
export function desktopInfo(): DesktopInfo | null {
  return bridge()?.desktop ?? null;
}

/**
 * Show a native OS notification when running in the desktop shell. No-op in a
 * plain browser (the in-app NotificationDropdown covers that case).
 */
export function notifyNative(title: string, body?: string): void {
  void bridge()?.native?.notify({ title, body });
}

/** Set the Dock badge to `count` active items (0 clears it). Desktop-only. */
export function setDockBadge(count: number): void {
  void bridge()?.native?.setBadge(count);
}
