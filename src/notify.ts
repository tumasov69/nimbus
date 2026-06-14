import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let granted: boolean | null = null;
let enabled = true;

/** Mirrors the `notificationsEnabled` setting so callers needn't pass it. */
export function setNotificationsEnabled(v: boolean): void {
  enabled = v;
}

/**
 * Sends a native OS notification for a finished background operation. No-op when
 * the launcher window is focused (the user already sees the in-app toast) or
 * when permission is denied. Callers gate this on the `notificationsEnabled`
 * setting. Never throws.
 */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (!enabled) return;
    if (await getCurrentWindow().isFocused()) return;
    if (granted === null) {
      granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
    }
    if (granted) sendNotification({ title, body });
  } catch {
    // Notifications are best-effort; ignore failures.
  }
}
