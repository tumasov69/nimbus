import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import i18n, { resolveLanguage } from "./i18n";
import { setNotificationsEnabled } from "./notify";
import type {
  AccountStore,
  InstallProgress,
  Instance,
  InstanceRunState,
  ModpackProgress,
  Settings,
  SystemInfo,
} from "./types";

export interface InstanceStatus {
  state: InstanceRunState;
  progress?: InstallProgress;
  packProgress?: ModpackProgress;
  error?: string;
}

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

// The Update handle from the updater plugin lives outside React state.
let pendingUpdate: import("@tauri-apps/plugin-updater").Update | null = null;

interface Store {
  instances: Instance[];
  accounts: AccountStore;
  settings: Settings | null;
  systemInfo: SystemInfo | null;
  statuses: Record<string, InstanceStatus>;
  logs: Record<string, string[]>;
  /** Bumped (throttled) when new console lines arrive; `logs` keeps the same
   *  object identity, so effects that follow the log tail must depend on this. */
  logsVersion: number;
  toasts: Toast[];
  appUpdate: { version: string } | null;
  updateInstalling: boolean;
  forcedUpdate: boolean;
  installAppUpdate: () => Promise<void>;
  refreshInstances: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  setSettings: (s: Settings) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
}

const StoreContext = createContext<Store | null>(null);

let toastId = 0;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [accounts, setAccounts] = useState<AccountStore>({ accounts: [] });
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [statuses, setStatuses] = useState<Record<string, InstanceStatus>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [appUpdate, setAppUpdate] = useState<{ version: string } | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [forcedUpdate, setForcedUpdate] = useState(false);
  const logsRef = useRef<Record<string, string[]>>({});
  const [logsVersion, setLogsVersion] = useState(0);
  const logFlushTimer = useRef<number | null>(null);
  // Timestamp of the last batch (file-count) progress event per instance.
  const lastMultipleAt = useRef<Record<string, number>>({});

  const refreshInstances = useCallback(async () => {
    setInstances(await api.listInstances());
  }, []);

  const refreshAccounts = useCallback(async () => {
    setAccounts(await api.getAccounts());
  }, []);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  // Apply language preference.
  useEffect(() => {
    if (!settings) return;
    const lang = resolveLanguage(settings.language);
    if (i18n.language !== lang) i18n.changeLanguage(lang);
  }, [settings]);

  // Apply theme preference (light / dark / system) and sync the native
  // window theme so the Mica tint matches.
  useEffect(() => {
    const theme = settings?.theme ?? "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        theme === "dark" ||
        theme === "oled" ||
        (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("oled", theme === "oled");
    };
    apply();
    invoke("set_window_theme", {
      theme: theme === "oled" ? "dark" : theme,
    }).catch(() => {});
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings?.theme]);

  // Keep the notifications helper in sync with the setting.
  useEffect(() => {
    setNotificationsEnabled(settings?.notificationsEnabled ?? true);
  }, [settings?.notificationsEnabled]);

  // Mark the document when a native backdrop (Mica/Acrylic) is active.
  useEffect(() => {
    document.documentElement.classList.toggle("mica", !!systemInfo?.mica);
  }, [systemInfo?.mica]);

  useEffect(() => {
    refreshInstances();
    refreshAccounts();
    api.getSettings().then(setSettingsState);
    api.getSystemInfo().then(setSystemInfo);
    // The window starts hidden (no white flash / resize jump); reveal it as
    // soon as the UI has mounted.
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        return win.show().then(() => win.setFocus());
      })
      .catch(() => {});
    // Forced update on startup: if a new version exists, install it and
    // relaunch before the user can do anything (keeps everyone current).
    import("@tauri-apps/plugin-updater")
      .then(({ check }) => check())
      .then(async (update) => {
        if (!update) return;
        pendingUpdate = update;
        setAppUpdate({ version: update.version });
        setForcedUpdate(true);
        setUpdateInstalling(true);
        try {
          await update.downloadAndInstall();
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        } catch {
          // If the forced update fails (offline mid-download etc.), fall back
          // to the manual pill so the user can retry.
          setForcedUpdate(false);
          setUpdateInstalling(false);
        }
      })
      .catch(() => {});
    api.getRunningInstances().then((ids) => {
      setStatuses((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = { state: "running" };
        return next;
      });
    });

    const unlisteners: Promise<() => void>[] = [];

    unlisteners.push(
      listen<{ instanceId: string; state: string; error?: string }>(
        "instance-state",
        (e) => {
          const { instanceId, state, error } = e.payload;
          // Surface crashes as a toast so users notice even off the page.
          if (state === "crashed" && error) {
            toast("error", error);
          }
          const settled = state === "stopped" || state === "crashed";
          setStatuses((prev) => ({
            ...prev,
            [instanceId]: {
              state: (settled ? "idle" : state) as InstanceRunState,
              error,
              progress:
                state === "running" || settled
                  ? undefined
                  : prev[instanceId]?.progress,
              packProgress: prev[instanceId]?.packProgress,
            },
          }));
        },
      ),
    );

    unlisteners.push(
      listen<InstallProgress>("install-progress", (e) => {
        const p = e.payload;
        // Batch downloads also emit per-chunk byte events for individual
        // files; mixing both scales makes the bar jump around. While batch
        // events are flowing, ignore the byte-level ones.
        if (p.kind === "multiple") {
          lastMultipleAt.current[p.instanceId] = Date.now();
        } else if (
          Date.now() - (lastMultipleAt.current[p.instanceId] ?? 0) < 3000
        ) {
          return;
        }
        setStatuses((prev) => ({
          ...prev,
          [p.instanceId]: {
            ...(prev[p.instanceId] ?? { state: "installing" }),
            state: prev[p.instanceId]?.state ?? "installing",
            progress: p,
          },
        }));
      }),
    );

    unlisteners.push(
      listen<ModpackProgress>("modpack-progress", (e) => {
        const p = e.payload;
        setStatuses((prev) => ({
          ...prev,
          [p.instanceId]: {
            ...(prev[p.instanceId] ?? { state: "idle" }),
            state:
              p.stage === "done" || p.stage === "error"
                ? "idle"
                : "installing",
            packProgress: p.stage === "done" || p.stage === "error" ? undefined : p,
          },
        }));
      }),
    );

    unlisteners.push(
      // The backend batches console output (~200 ms per flush) so a chatty
      // game costs one IPC event per tick instead of one per line.
      listen<{ instanceId: string; lines: string[] }>("console-lines", (e) => {
        const { instanceId, lines } = e.payload;
        const logs = logsRef.current;
        if (!logs[instanceId]) logs[instanceId] = [];
        logs[instanceId].push(...lines);
        if (logs[instanceId].length > 600) {
          logs[instanceId] = logs[instanceId].slice(-500);
        }
        // Coalesce log-driven re-renders: during game startup the game can
        // emit 100+ lines/second; bumping every line would re-render the app
        // that often. Bump at most ~4×/second.
        if (logFlushTimer.current === null) {
          logFlushTimer.current = window.setTimeout(() => {
            logFlushTimer.current = null;
            setLogsVersion((v) => v + 1);
          }, 250);
        }
      }),
    );

    return () => {
      unlisteners.forEach((u) => u.then((fn) => fn()));
      if (logFlushTimer.current !== null) {
        clearTimeout(logFlushTimer.current);
        logFlushTimer.current = null;
      }
    };
  }, [refreshAccounts, refreshInstances]);

  // Drop logs for instances that no longer exist (prevents unbounded growth).
  useEffect(() => {
    const ids = new Set(instances.map((i) => i.id));
    for (const id of Object.keys(logsRef.current)) {
      if (!ids.has(id)) delete logsRef.current[id];
    }
  }, [instances]);

  const installAppUpdate = useCallback(async () => {
    if (!pendingUpdate) return;
    setUpdateInstalling(true);
    toast("info", i18n.t("settings.updateDownloading"));
    try {
      await pendingUpdate.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      toast("error", errorText(e));
      setUpdateInstalling(false);
    }
  }, [toast]);

  // Memoize the context value so consumers only re-render when real state
  // changes. logsVersion is included so log views update on the throttled bump.
  const value = useMemo<Store>(
    () => ({
      instances,
      accounts,
      settings,
      systemInfo,
      statuses,
      logs: logsRef.current,
      logsVersion,
      toasts,
      appUpdate,
      updateInstalling,
      forcedUpdate,
      installAppUpdate,
      refreshInstances,
      refreshAccounts,
      setSettings: setSettingsState,
      toast,
      dismissToast,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      instances,
      accounts,
      settings,
      systemInfo,
      statuses,
      toasts,
      appUpdate,
      updateInstalling,
      forcedUpdate,
      logsVersion,
      installAppUpdate,
      refreshInstances,
      refreshAccounts,
      toast,
      dismissToast,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside provider");
  return store;
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
