import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  Contrast,
  FolderOpen,
  Languages,
  MemoryStick,
  Monitor,
  Moon,
  Package,
  RefreshCw,
  Sun,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import { Field, SelectWrap, Spinner, Toggle } from "../components/ui";
import { LANGUAGES } from "../i18n";
import { errorText, useStore } from "../store";
import type { Settings } from "../types";

export function SettingsPage() {
  const { t } = useTranslation();
  const { settings, setSettings, systemInfo, toast, refreshInstances } = useStore();
  const [local, setLocal] = useState<Settings | null>(settings);
  const [importing, setImporting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (settings && !local) setLocal(settings);
  }, [settings, local]);

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
      <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
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
      const result = await check();
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
      await update.downloadAndInstall();
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
