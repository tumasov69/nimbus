import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  Contrast,
  FolderInput,
  FolderOpen,
  HardDrive,
  Languages,
  MemoryStick,
  Monitor,
  Moon,
  Package,
  RefreshCw,
  Search,
  Sun,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import {
  Field,
  LoaderBadge,
  SelectWrap,
  Spinner,
  Toggle,
  formatBytes,
} from "../components/ui";
import { LANGUAGES } from "../i18n";
import { downloadAndInstallGuarded, errorText, useStore } from "../store";
import type { McVersion, Settings } from "../types";

/** Accent presets — the swatch colour mirrors `[data-accent]` in index.css. */
const ACCENTS = [
  { value: "indigo", color: "#4f46e5" },
  { value: "sky", color: "#0284c7" },
  { value: "emerald", color: "#059669" },
  { value: "amber", color: "#d97706" },
  { value: "rose", color: "#e11d48" },
  { value: "violet", color: "#7c3aed" },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const { settings, setSettings, systemInfo, toast, refreshInstances } = useStore();
  const [local, setLocal] = useState<Settings | null>(settings);
  const [importing, setImporting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (settings && !local) setLocal(settings);
  }, [settings, local]);

  // Cancel a pending debounced save on unmount.
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  if (!local) return null;

  const update = (patch: Partial<Settings>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    setSettings(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.saveSettings(next).catch((e) => toast("error", errorText(e)));
    }, 400);
  };

  const maxMemory = systemInfo
    ? Math.max(2048, systemInfo.totalMemoryMb - 2048)
    : 16384;

  const importPack = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "Modrinth modpack", extensions: ["mrpack"] }],
    });
    if (typeof path !== "string") return;
    setImporting(true);
    try {
      await api.importMrpack(path);
      await refreshInstances();
      toast("success", t("settings.importDone"));
    } catch (e) {
      await refreshInstances();
      toast("error", errorText(e));
    } finally {
      setImporting(false);
    }
  };

  const THEMES = [
    { value: "light", label: t("settings.themeLight"), icon: Sun },
    { value: "dark", label: t("settings.themeDark"), icon: Moon },
    { value: "oled", label: t("settings.themeOled"), icon: Contrast },
    { value: "system", label: t("settings.themeSystem"), icon: Monitor },
  ] as const;

  return (
    <div className="animate-fade-up max-w-2xl pb-6">
      <h1 className="text-xl font-bold tracking-tight">{t("settings.title")}</h1>
      <p className="mt-1 text-sm text-t3">{t("settings.subtitle")}</p>

      {/* Appearance */}
      <div className="card mt-6 p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-t1">
          <Languages className="size-4 text-accent-text" />
          {t("settings.appearance")}
        </div>
        <div className="flex flex-col gap-4">
          <Field label={t("settings.language")}>
            <SelectWrap>
              <select
                className="select-base"
                value={local.language}
                onChange={(e) => update({ language: e.target.value })}
              >
                <option value="">{t("settings.languageAuto")}</option>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </Field>
          <Field label={t("tools.accentColor")}>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map(({ value, color }) => (
                <button
                  key={value}
                  onClick={() => update({ accent: value })}
                  title={value}
                  className={`size-8 rounded-full border-2 transition-all cursor-pointer ${
                    (local.accent ?? "indigo") === value
                      ? "border-t1 scale-110"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ background: color }}
                />
              ))}
            </div>
          </Field>
          <Field label={t("settings.theme")}>
            <div className="grid grid-cols-4 gap-1.5">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => update({ theme: value })}
                  title={label}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium transition-all cursor-pointer ${
                    local.theme === value
                      ? "border-accent bg-accent-soft text-accent-text"
                      : "border-stroke-strong bg-card text-t3 hover:text-t1"
                  }`}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </div>

      {/* Memory */}
      <div className="card mt-4 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-t1">
          <MemoryStick className="size-4 text-accent-text" />
          {t("settings.memory")}
          <div className="ml-auto flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-1">
            <input
              type="number"
              min={1}
              max={Math.ceil(maxMemory / 1024)}
              step={0.5}
              value={Number((local.memoryMb / 1024).toFixed(1))}
              onChange={(e) => {
                const gb = Number(e.target.value);
                if (!Number.isNaN(gb)) {
                  update({
                    memoryMb: Math.round(
                      Math.min(maxMemory, Math.max(1024, gb * 1024)),
                    ),
                  });
                }
              }}
              className="w-12 bg-transparent text-right text-sm font-semibold text-accent-text outline-none"
            />
            <span className="text-sm font-semibold text-accent-text">GB</span>
          </div>
        </div>
        <input
          type="range"
          min={1024}
          max={maxMemory}
          step={256}
          value={local.memoryMb}
          onChange={(e) => update({ memoryMb: Number(e.target.value) })}
          className="mt-4 w-full accent-indigo-500"
        />
        <div className="mt-1 flex justify-between text-xs text-t3">
          <span>1 GB</span>
          {systemInfo && (
            <span>
              {t("settings.totalInSystem", {
                gb: (systemInfo.totalMemoryMb / 1024).toFixed(0),
              })}
            </span>
          )}
          <span>{(maxMemory / 1024).toFixed(0)} GB</span>
        </div>
      </div>

      {/* Game window */}
      <div className="card mt-4 p-5">
        <div className="mb-4 text-sm font-medium text-t1">{t("settings.window")}</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("settings.width")}>
            <input
              type="number"
              className="input-base"
              value={local.gameWidth}
              disabled={local.fullscreen}
              onChange={(e) => update({ gameWidth: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label={t("settings.height")}>
            <input
              type="number"
              className="input-base"
              value={local.gameHeight}
              disabled={local.fullscreen}
              onChange={(e) => update({ gameHeight: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-t1">{t("settings.fullscreen")}</div>
            <div className="text-xs text-t3">{t("settings.fullscreenDesc")}</div>
          </div>
          <Toggle
            checked={local.fullscreen}
            onChange={(v) => update({ fullscreen: v })}
          />
        </div>
      </div>

      {/* Launcher behavior */}
      <div className="card mt-4 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-t1">
              {t("settings.hideLauncher")}
            </div>
            <div className="text-xs text-t3">{t("settings.hideLauncherDesc")}</div>
          </div>
          <Toggle
            checked={local.hideLauncher}
            onChange={(v) => update({ hideLauncher: v })}
          />
        </div>
      </div>

      {/* JVM */}
      <div className="card mt-4 p-5">
        <Field label={t("settings.jvmArgs")}>
          <input
            className="input-base font-mono !text-xs"
            placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
            value={local.javaArgs}
            onChange={(e) => update({ javaArgs: e.target.value })}
          />
        </Field>
        <p className="mt-2 text-xs text-t3">{t("settings.jvmArgsHint")}</p>
      </div>

      {/* Downloads */}
      <div className="card mt-4 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-t1">
          {t("settings.downloads")}
          <span className="ml-auto rounded-lg bg-accent-soft px-2.5 py-1 text-sm font-semibold text-accent-text">
            {local.downloadConcurrency}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={24}
          step={1}
          value={local.downloadConcurrency}
          onChange={(e) => update({ downloadConcurrency: Number(e.target.value) })}
          className="mt-4 w-full accent-indigo-500"
        />
        <p className="mt-1 text-xs text-t3">{t("settings.downloadsHint")}</p>
      </div>

      {/* Discord */}
      <div className="card mt-4 flex items-center justify-between p-5">
        <div>
          <div className="text-sm font-medium text-t1">{t("settings.discord")}</div>
          <div className="text-xs text-t3">{t("settings.discordDesc")}</div>
        </div>
        <Toggle
          checked={local.discordRpc}
          onChange={(v) => update({ discordRpc: v })}
        />
      </div>

      <div className="card mt-4 flex items-center justify-between p-5">
        <div>
          <div className="text-sm font-medium text-t1">
            {t("settings.notifications")}
          </div>
          <div className="text-xs text-t3">{t("settings.notificationsDesc")}</div>
        </div>
        <Toggle
          checked={local.notificationsEnabled}
          onChange={(v) => update({ notificationsEnabled: v })}
        />
      </div>

      <UpdatesCard />

      {/* Import mrpack */}
      <div className="card mt-4 flex items-center justify-between p-5">
        <div className="flex items-center gap-3">
          <Package className="size-4 text-accent-text" />
          <div>
            <div className="text-sm font-medium text-t1">{t("settings.importTitle")}</div>
            <div className="text-xs text-t3">{t("settings.importDesc")}</div>
          </div>
        </div>
        <button className="btn-secondary shrink-0" disabled={importing} onClick={importPack}>
          {importing && <Spinner />}
          {t("settings.importBtn")}
        </button>
      </div>

      <ImportLaunchersCard />

      <DiskCard />

      {/* Data folder */}
      <div className="card mt-4 flex items-center justify-between p-5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-t1">{t("settings.dataFolder")}</div>
          <div className="truncate text-xs text-t3">{systemInfo?.dataDir}</div>
        </div>
        <button
          className="btn-secondary shrink-0"
          onClick={() => api.openDataFolder().catch((e) => toast("error", errorText(e)))}
        >
          <FolderOpen className="size-4" /> {t("common.open")}
        </button>
      </div>
    </div>
  );
}

/**
 * Where the disk actually went. Launchers quietly accumulate tens of
 * gigabytes across shared game files, per-instance folders and the download
 * cache; this makes that visible and reclaimable.
 */
function DiskCard() {
  const { t } = useTranslation();
  const { toast } = useStore();
  const [usage, setUsage] = useState<api.DiskUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setUsage(await api.getDiskUsage());
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const run = async (action: "cache" | "versions") => {
    setBusy(true);
    try {
      const freed =
        action === "cache"
          ? await api.clearCache()
          : await api.cleanupUnusedVersions();
      toast("success", t("tools.diskFreed", { size: formatBytes(freed) }));
      await load();
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mt-4 p-5">
      <div className="flex items-center gap-3">
        <HardDrive className="size-4 text-accent-text" />
        <div className="mr-auto">
          <div className="text-sm font-medium text-t1">{t("tools.diskTitle")}</div>
          <div className="text-xs text-t3">
            {loading
              ? t("tools.diskCalculating")
              : usage
                ? `${t("tools.diskTotal")}: ${formatBytes(usage.totalBytes)}`
                : t("tools.diskInstances")}
          </div>
        </div>
        <button className="btn-secondary shrink-0" disabled={loading} onClick={load}>
          {loading ? <Spinner /> : <RefreshCw className="size-4" />}
          {t("tools.diskRefresh")}
        </button>
      </div>

      {usage && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 text-sm">
            <UsageRow label={t("tools.diskGame")} bytes={usage.gameBytes} total={usage.totalBytes} />
            <UsageRow label={t("tools.diskCache")} bytes={usage.cacheBytes} total={usage.totalBytes} />
            {usage.instances.slice(0, 6).map((i) => (
              <UsageRow key={i.id} label={i.name} bytes={i.bytes} total={usage.totalBytes} />
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={busy || usage.cacheBytes === 0} onClick={() => run("cache")}>
              {busy ? <Spinner /> : <Trash2 className="size-4" />}
              {t("tools.diskClearCache")} ({formatBytes(usage.cacheBytes)})
            </button>
            {usage.unusedVersions.length > 0 && (
              <button className="btn-secondary" disabled={busy} onClick={() => run("versions")}>
                <Trash2 className="size-4" />
                {t("tools.diskCleanVersions")} ({formatBytes(usage.unusedVersionBytes)})
              </button>
            )}
          </div>
          {usage.unusedVersions.length > 0 && (
            <div className="text-xs text-t3">
              {t("tools.diskUnused", { n: usage.unusedVersions.length })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UsageRow({
  label,
  bytes,
  total,
}: {
  label: string;
  bytes: number;
  total: number;
}) {
  const share = total > 0 ? bytes / total : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-xs text-t2">{label}</span>
      <div className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-bg-soft">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.max(2, share * 100)}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-t3">
        {formatBytes(bytes)}
      </span>
    </div>
  );
}

/**
 * Migration from other launchers: the main reason people don't switch is
 * having to rebuild everything by hand.
 */
function ImportLaunchersCard() {
  const { t } = useTranslation();
  const { toast, refreshInstances } = useStore();
  const [found, setFound] = useState<api.ExternalInstance[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [versions, setVersions] = useState<McVersion[]>([]);

  useEffect(() => {
    api.getMinecraftVersions().then(setVersions).catch(() => {});
  }, []);

  const scan = async () => {
    setScanning(true);
    try {
      setFound(await api.scanExternalLaunchers());
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setScanning(false);
    }
  };

  const doImport = async (item: api.ExternalInstance) => {
    if (!item.mcVersion) {
      toast("info", t("tools.importNeedVersion"));
      return;
    }
    setImporting(item.path);
    try {
      await api.importExternalInstance({
        path: item.path,
        name: item.name,
        mcVersion: item.mcVersion,
        loader: item.loader ?? "vanilla",
        loaderVersion: item.loaderVersion ?? null,
      });
      await refreshInstances();
      toast("success", t("tools.importDone"));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setImporting(null);
    }
  };

  const setVersion = (path: string, mcVersion: string) =>
    setFound((prev) =>
      prev?.map((i) => (i.path === path ? { ...i, mcVersion } : i)) ?? prev,
    );

  return (
    <div className="card mt-4 p-5">
      <div className="flex items-center gap-3">
        <FolderInput className="size-4 text-accent-text" />
        <div className="mr-auto min-w-0">
          <div className="text-sm font-medium text-t1">{t("tools.importTitle")}</div>
          <div className="text-xs text-t3">{t("tools.importDesc")}</div>
        </div>
        <button className="btn-secondary shrink-0" disabled={scanning} onClick={scan}>
          {scanning ? <Spinner /> : <Search className="size-4" />}
          {scanning ? t("tools.importScanning") : t("tools.importScan")}
        </button>
      </div>

      {found && found.length === 0 && (
        <div className="mt-4 text-sm text-t3">{t("tools.importNone")}</div>
      )}

      {found && found.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="text-xs text-t3">
            {t("tools.importFound", { n: found.length })} · {t("tools.importCopies")}
          </div>
          {found.map((item) => (
            <div
              key={item.path}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-stroke p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-t1">{item.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-t3">
                  <span className="rounded bg-bg-soft px-1.5 py-0.5 font-medium">
                    {item.source}
                  </span>
                  {item.loader && <LoaderBadge loader={item.loader} />}
                  <span>{formatBytes(item.sizeBytes)}</span>
                  <span>· {t("instance.mods")}: {item.modsCount}</span>
                  <span>· {t("instance.worlds")}: {item.worldsCount}</span>
                </div>
              </div>
              <div className="w-32 shrink-0">
                <SelectWrap>
                  <select
                    className="select-base !py-1.5 !text-xs"
                    value={item.mcVersion ?? ""}
                    onChange={(e) => setVersion(item.path, e.target.value)}
                  >
                    <option value="">—</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.id}
                      </option>
                    ))}
                  </select>
                </SelectWrap>
              </div>
              <button
                className="btn-secondary shrink-0 !py-2"
                disabled={importing !== null}
                onClick={() => doImport(item)}
              >
                {importing === item.path ? <Spinner /> : <FolderInput className="size-4" />}
                {t("tools.importAction")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UpdatesCard() {
  const { t } = useTranslation();
  const { toast } = useStore();
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      const result = await check({ timeout: 30_000 });
      setUpdate(result);
      if (!result) toast("success", t("settings.upToDate"));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setChecking(false);
    }
  };

  const installUpdate = async () => {
    if (!update) return;
    setInstalling(true);
    toast("info", t("settings.updateDownloading"));
    try {
      await downloadAndInstallGuarded(update);
      await relaunch();
    } catch (e) {
      toast("error", errorText(e));
      setInstalling(false);
    }
  };

  return (
    <div className="card mt-4 flex items-center justify-between p-5">
      <div className="flex items-center gap-3">
        <RefreshCw className="size-4 text-accent-text" />
        <div>
          <div className="text-sm font-medium text-t1">{t("settings.updates")}</div>
          <div className="text-xs text-t3">
            {update
              ? t("settings.updateAvailable", { v: update.version })
              : t("settings.version", { v: version })}
          </div>
        </div>
      </div>
      {update ? (
        <button className="btn-primary shrink-0" disabled={installing} onClick={installUpdate}>
          {installing && <Spinner />}
          {t("settings.updateInstall")}
        </button>
      ) : (
        <button className="btn-secondary shrink-0" disabled={checking} onClick={checkForUpdates}>
          {checking && <Spinner />}
          {t("settings.checkUpdates")}
        </button>
      )}
    </div>
  );
}
