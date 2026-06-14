import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import {
  ArrowDownToLine,
  ArrowLeft,
  Box,
  Clock,
  Copy,
  CopyPlus,
  FolderOpen,
  Image,
  Package,
  Pencil,
  Play,
  Plus,
  Puzzle,
  Search,
  Square,
  Trash2,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import { ServersTab } from "../components/ServersTab";
import { WorldsTab } from "../components/WorldsTab";
import {
  Field,
  LoaderBadge,
  ProgressBar,
  Spinner,
  Toggle,
  formatBytes,
  formatPlaytime,
  instanceIconSrc,
} from "../components/ui";
import { notify } from "../notify";
import type { Route } from "../routes";
import { errorText, useStore } from "../store";
import type { InstanceOverrides, ModFile } from "../types";
import { DeleteInstanceModal, RenameInstanceModal } from "./InstancesPage";

type Tab = "mods" | "worlds" | "servers" | "logs" | "settings";

type LogLevel = "error" | "warn" | "info";

/** Classifies a Minecraft log line by severity for colouring/filtering. */
function logLevelOf(line: string): LogLevel {
  if (/\/(ERROR|FATAL)\]|\bERROR\b|\bFATAL\b|Exception/.test(line)) return "error";
  if (/\/WARN\]|\bWARN(?:ING)?\b/.test(line)) return "warn";
  return "info";
}

/** Wraps case-insensitive matches of `q` (already lowercased) in <mark>. */
function highlightLog(line: string, q: string): ReactNode {
  if (!q) return line;
  const lower = line.toLowerCase();
  const out: ReactNode[] = [];
  let from = 0;
  let idx = lower.indexOf(q, from);
  while (idx !== -1) {
    if (idx > from) out.push(line.slice(from, idx));
    out.push(
      <mark key={idx} className="rounded-sm bg-amber-400/40 text-inherit">
        {line.slice(idx, idx + q.length)}
      </mark>,
    );
    from = idx + q.length;
    idx = lower.indexOf(q, from);
  }
  if (from < line.length) out.push(line.slice(from));
  return out;
}

export function InstancePage({
  id,
  navigate,
}: {
  id: string;
  navigate: (r: Route) => void;
}) {
  const { t } = useTranslation();
  const { instances, statuses, logs, toast, accounts, refreshInstances } =
    useStore();
  const instance = instances.find((i) => i.id === id);
  const status = statuses[id];
  const [tab, setTab] = useState<Tab>("mods");
  const [packUpdate, setPackUpdate] = useState<api.ModpackUpdate | null>(null);
  const [updatingPack, setUpdatingPack] = useState(false);
  const [mods, setMods] = useState<ModFile[]>([]);
  const [modsLoading, setModsLoading] = useState(false);
  const [modInfo, setModInfo] = useState<Record<string, api.ModInfo>>({});
  const [updatingMods, setUpdatingMods] = useState<Set<string>>(new Set());
  const [showRename, setShowRename] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const enrichSeq = useRef(0);
  const [logSearch, setLogSearch] = useState("");
  const [logLevel, setLogLevel] = useState<"all" | "warn" | "error">("all");
  const atBottomRef = useRef(true);

  const busy =
    status && ["preparing", "installing", "launching"].includes(status.state);
  const running = status?.state === "running";

  // Vanilla instances can't load mods — their content tab manages
  // resource packs instead (matching where installs actually go).
  const contentFolder: api.ContentFolder =
    instance?.loader === "vanilla" ? "resourcepacks" : "mods";

  const loadMods = useCallback(
    async (forceEnrich = false) => {
      // Each call gets a sequence number; a slow enrichment from an earlier call
      // must not overwrite the result of a newer one (toggle/delete/update).
      const seq = ++enrichSeq.current;
      setModsLoading(true);
      try {
        setMods(await api.listMods(id, contentFolder));
      } catch (e) {
        toast("error", errorText(e));
      } finally {
        setModsLoading(false);
      }
      // Modrinth enrichment (icons, names, available updates) loads after the
      // basic list so the UI is never blocked by the network.
      if (contentFolder !== "mods") return;
      api
        .modrinthEnrichMods(id, forceEnrich)
        .then((list) => {
          if (seq !== enrichSeq.current) return;
          const map: Record<string, api.ModInfo> = {};
          for (const info of list) map[info.fileName] = info;
          setModInfo(map);
        })
        .catch(() => {});
    },
    [id, toast, contentFolder],
  );

  /** Drops the update badge for a file immediately after a successful
   *  update, without waiting for re-enrichment (which may be rate-limited). */
  const clearUpdateBadge = (oldFileName: string, newFileName: string) => {
    setModInfo((prev) => {
      const next = { ...prev };
      const info = next[oldFileName];
      delete next[oldFileName];
      if (info) {
        next[newFileName] = {
          ...info,
          fileName: newFileName,
          versionNumber: info.updateVersionNumber ?? info.versionNumber,
          updateVersionId: undefined,
          updateVersionNumber: undefined,
        };
      }
      return next;
    });
  };

  const updateMod = async (fileName: string, versionId: string) => {
    setUpdatingMods((prev) => new Set(prev).add(fileName));
    try {
      const newFileName = await api.modrinthUpdateMod(id, fileName, versionId);
      clearUpdateBadge(fileName, newFileName);
      api.invalidateEnrich(id);
      setMods(await api.listMods(id));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setUpdatingMods((prev) => {
        const next = new Set(prev);
        next.delete(fileName);
        return next;
      });
    }
  };

  const updatableMods = mods.filter(
    (m) => modInfo[m.fileName]?.updateVersionId,
  );

  const updateAllMods = async () => {
    const targets = updatableMods.map((m) => ({
      fileName: m.fileName,
      versionId: modInfo[m.fileName].updateVersionId!,
    }));
    setUpdatingMods(new Set(targets.map((t) => t.fileName)));
    let updated = 0;
    for (const target of targets) {
      try {
        const newName = await api.modrinthUpdateMod(
          id,
          target.fileName,
          target.versionId,
        );
        clearUpdateBadge(target.fileName, newName);
        updated++;
      } catch {
        // keep going; failed mods stay on the old version
      }
    }
    setUpdatingMods(new Set());
    api.invalidateEnrich(id);
    setMods(await api.listMods(id));
    toast("success", t("instance.modsUpdated", { n: updated }));
    notify("Nimbus", t("instance.modsUpdated", { n: updated }));
  };

  useEffect(() => {
    loadMods();
  }, [loadMods]);

  // Check for a newer modpack version (only for Modrinth modpack instances).
  useEffect(() => {
    let cancelled = false;
    api
      .checkModpackUpdate(id)
      .then((u) => !cancelled && setPackUpdate(u))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  const doUpdatePack = async () => {
    setUpdatingPack(true);
    try {
      await api.updateModpack(id);
      await refreshInstances();
      await loadMods(true);
      setPackUpdate(null);
      toast("success", t("instance.packUpdated"));
      notify("Nimbus", t("instance.packUpdated"));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setUpdatingPack(false);
    }
  };

  const doClone = async () => {
    try {
      const clone = await api.cloneInstance(id);
      await refreshInstances();
      toast("success", t("instance.cloned"));
      navigate({ page: "instance", id: clone.id });
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  const doExport = async () => {
    if (!instance) return;
    const path = await save({
      defaultPath: `${instance.name}.mrpack`,
      filters: [{ name: "Modrinth modpack", extensions: ["mrpack"] }],
    });
    if (!path) return;
    try {
      await api.exportMrpack(id, path);
      toast("success", t("instance.exported"));
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  const doRepair = async () => {
    try {
      await api.repairInstance(id);
      toast("success", t("instance.repaired"));
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  const doSetIcon = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "Изображение", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof path !== "string") return;
    try {
      await api.setInstanceIcon(id, path);
      await refreshInstances();
      toast("success", t("instance.iconSet"));
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  // Reset to "follow tail" each time the logs tab is opened.
  useEffect(() => {
    if (tab === "logs") atBottomRef.current = true;
  }, [tab]);

  // Auto-scroll to the newest line only while the user is at the bottom, so
  // scrolling up to read isn't yanked back down by incoming lines.
  useEffect(() => {
    if (tab === "logs" && logRef.current && atBottomRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [tab, logs, status?.state]);

  if (!instance) {
    return (
      <div className="animate-fade-up">
        <button className="btn-ghost" onClick={() => navigate({ page: "instances" })}>
          <ArrowLeft className="size-4" /> {t("common.back")}
        </button>
        <div className="card mt-4 p-10 text-center text-t3">
          {t("instance.notFound")}
        </div>
      </div>
    );
  }

  const play = async () => {
    if (!accounts.active) {
      toast("info", t("accounts.accountFirst"));
      navigate({ page: "accounts" });
      return;
    }
    try {
      await api.launchInstance(id);
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  const stop = async () => {
    try {
      await api.killInstance(id);
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  const progress = status?.progress;
  const supportsMods = instance.loader !== "vanilla";

  return (
    <div className="animate-fade-up flex h-full flex-col">
      <button
        className="btn-ghost -ml-2 mb-3 self-start"
        onClick={() => navigate({ page: "instances" })}
      >
        <ArrowLeft className="size-4" /> {t("instance.all")}
      </button>

      <div className="card relative mb-3 overflow-hidden p-4">
        {(() => {
          const icon = instanceIconSrc(instance);
          return icon ? (
            <>
              <img src={icon} alt="" className="banner-img !opacity-20 dark:!opacity-15" />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, transparent 0%, var(--card) 90%)",
                }}
              />
            </>
          ) : null;
        })()}
        <div className="relative flex flex-wrap items-center gap-3">
          {(() => {
            const icon = instanceIconSrc(instance);
            return icon ? (
              <img src={icon} alt="" className="size-16 rounded-2xl object-cover shadow-lg" />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
                <Box className="size-8" />
              </div>
            );
          })()}
          <div className="min-w-40 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {instance.name}
            </h1>
            <div className="mt-1.5 flex items-center gap-2">
              <LoaderBadge loader={instance.loader} />
              <span className="text-sm text-t3">
                {instance.mcVersion}
                {instance.loaderVersion ? ` · ${instance.loaderVersion}` : ""}
              </span>
              {instance.modpack?.versionNumber && (
                <span className="text-sm text-t3">
                  · {t("instance.modpackV", { v: instance.modpack.versionNumber })}
                </span>
              )}
              {(instance.totalPlaytimeSecs ?? 0) > 0 && (
                <span
                  className="flex items-center gap-1 text-sm text-t3"
                  title={t("instance.playtime")}
                >
                  <Clock className="size-3.5" />
                  {formatPlaytime(instance.totalPlaytimeSecs ?? 0)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary !p-2.5"
              title={t("instances.openFolder")}
              onClick={() =>
                api.openInstanceFolder(id).catch((e) => toast("error", errorText(e)))
              }
            >
              <FolderOpen className="size-4" />
            </button>
            {running ? (
              <button className="btn-danger" onClick={stop}>
                <Square className="size-4 fill-current" /> {t("common.stop")}
              </button>
            ) : (
              <button className="btn-primary !px-6" disabled={!!busy} onClick={play}>
                {busy ? <Spinner /> : <Play className="size-4 fill-current" />}
                {status?.state === "preparing"
                  ? t("status.preparing")
                  : status?.state === "installing"
                    ? t("status.installing")
                    : status?.state === "launching"
                      ? t("status.launching")
                      : t("common.play")}
              </button>
            )}
          </div>
        </div>

        {busy && progress && (
          <div className="relative mt-4">
            <div className="mb-1.5 flex justify-between text-xs text-t3">
              <span className="truncate pr-4">{progress.path.split(/[\\/]/).pop()}</span>
              <span>
                {progress.kind === "multiple"
                  ? `${progress.current} / ${progress.total}`
                  : `${formatBytes(progress.current)} / ${formatBytes(progress.total)}`}
              </span>
            </div>
            <ProgressBar value={progress.current / Math.max(1, progress.total)} />
          </div>
        )}
      </div>

      {packUpdate && (
        <div className="card mb-4 flex items-center gap-3 border-accent/30 bg-accent-soft p-4">
          <ArrowDownToLine className="size-5 shrink-0 text-accent-text" />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-medium text-t1">
              {t("instance.packUpdateAvailable", { v: packUpdate.versionNumber })}
            </span>
          </div>
          <button className="btn-primary" disabled={updatingPack} onClick={doUpdatePack}>
            {updatingPack && <Spinner />}
            {t("instance.packUpdateBtn")}
          </button>
        </div>
      )}

      <div className="mb-4 flex gap-1">
        {(
          [
            ["mods", supportsMods ? t("instance.mods") : t("browse.resourcepacks")],
            ["worlds", t("instance.worlds")],
            ["servers", t("instance.servers")],
            ["logs", t("instance.logs")],
            ["settings", t("instance.manage")],
          ] as [Tab, string][]
        ).map(([tabKey, label]) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-all cursor-pointer ${
              tab === tabKey ? "tab-active" : "text-t3 hover:bg-accent-soft hover:text-t1"
            }`}
          >
            {label}
            {tabKey === "mods" && mods.length > 0 && (
              <span className="ml-1.5 text-xs text-t3">{mods.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "mods" && (
          <div className="flex flex-col gap-3">
            <div className="flex justify-end gap-2">
              {updatableMods.length > 0 && (
                <button
                  className="btn-secondary"
                  disabled={updatingMods.size > 0}
                  onClick={updateAllMods}
                >
                  {updatingMods.size > 0 ? (
                    <Spinner />
                  ) : (
                    <ArrowDownToLine className="size-4" />
                  )}
                  {t("instance.updateAll", { n: updatableMods.length })}
                </button>
              )}
              <button
                className="btn-primary"
                onClick={() =>
                  navigate({
                    page: "browse",
                    projectType: supportsMods ? "mod" : "resourcepack",
                    instanceId: id,
                  })
                }
              >
                <Plus className="size-4" />
                {supportsMods ? t("instance.addMods") : t("instance.addResourcepacks")}
              </button>
            </div>
            {modsLoading ? (
              <div className="card flex items-center justify-center gap-2 py-12 text-t3">
                <Spinner /> {t("common.loading")}
              </div>
            ) : mods.length === 0 ? (
              <div className="card py-12 text-center text-t3">
                {t("instance.noMods")}
              </div>
            ) : (
              <div className="card divide-y divide-stroke">
                {mods.map((mod) => {
                  const info = modInfo[mod.fileName];
                  const updating = updatingMods.has(mod.fileName);
                  const openProject = info?.projectId
                    ? () =>
                        navigate({
                          page: "project",
                          projectId: info.projectId!,
                          projectType: "mod",
                          instanceId: id,
                        })
                    : undefined;
                  return (
                    <div
                      key={mod.fileName}
                      onClick={openProject}
                      className={`flex items-center gap-3 px-4 py-3 ${
                        openProject
                          ? "cursor-pointer transition-colors hover:bg-bg-soft"
                          : ""
                      }`}
                    >
                      <span onClick={(e) => e.stopPropagation()}>
                        <Toggle
                          checked={mod.enabled}
                          onChange={async (checked) => {
                            try {
                              await api.toggleMod(id, mod.fileName, checked, contentFolder);
                              api.invalidateEnrich(id);
                              loadMods(true);
                            } catch (err) {
                              toast("error", errorText(err));
                            }
                          }}
                        />
                      </span>
                      {info?.iconUrl ? (
                        <img
                          src={info.iconUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          width={32}
                          height={32}
                          className="size-8 shrink-0 rounded-lg bg-bg-soft object-cover"
                        />
                      ) : (
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-bg-soft text-t3">
                          <Puzzle className="size-4" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate text-sm font-medium ${
                            mod.enabled ? "text-t1" : "text-t3 line-through"
                          }`}
                        >
                          {info?.title ?? mod.displayName}
                        </div>
                        <div className="truncate text-xs text-t3">
                          {info?.versionNumber
                            ? `${info.versionNumber} · ${formatBytes(mod.sizeBytes)}`
                            : formatBytes(mod.sizeBytes)}
                        </div>
                      </div>
                      {info?.updateVersionId && (
                        <button
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-success-soft px-2.5 py-1.5 text-xs font-medium text-success transition-all hover:brightness-110 disabled:opacity-60 cursor-pointer"
                          title={info.updateVersionNumber}
                          disabled={updating}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateMod(mod.fileName, info.updateVersionId!);
                          }}
                        >
                          {updating ? (
                            <Spinner className="size-3.5" />
                          ) : (
                            <ArrowDownToLine className="size-3.5" />
                          )}
                          {info.updateVersionNumber}
                        </button>
                      )}
                      <button
                        className="btn-ghost !p-2 hover:!bg-danger-soft hover:!text-danger"
                        title={t("common.delete")}
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await api.deleteMod(id, mod.fileName, contentFolder);
                            api.invalidateEnrich(id);
                            loadMods(true);
                          } catch (err) {
                            toast("error", errorText(err));
                          }
                        }}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "worlds" && <WorldsTab id={id} />}
        {tab === "servers" && <ServersTab id={id} />}

        {tab === "logs" &&
          (() => {
            const allLines = logs[id] ?? [];
            const q = logSearch.trim().toLowerCase();
            const visible = allLines
              .map((line, i) => ({ i, line, level: logLevelOf(line) }))
              .filter(({ line, level }) => {
                if (logLevel === "error" && level !== "error") return false;
                if (logLevel === "warn" && level === "info") return false;
                if (q && !line.toLowerCase().includes(q)) return false;
                return true;
              });
            return (
              <div className="flex h-full flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-t3" />
                    <input
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      placeholder={t("instance.logSearch")}
                      className="input-base !py-2 pl-9"
                    />
                  </div>
                  <div className="flex shrink-0 overflow-hidden rounded-lg border border-stroke-strong">
                    {(
                      [
                        ["all", t("instance.logAll")],
                        ["warn", t("instance.logWarnings")],
                        ["error", t("instance.logErrors")],
                      ] as ["all" | "warn" | "error", string][]
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => setLogLevel(k)}
                        className={`px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                          logLevel === k
                            ? "bg-accent text-accent-fg"
                            : "text-t3 hover:bg-accent-soft hover:text-t1"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {allLines.length > 0 && (
                    <button
                      className="btn-secondary shrink-0 !py-2"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(allLines.join("\n"))
                          .then(() => toast("success", t("instance.logsCopied")))
                          .catch(() => {});
                      }}
                    >
                      <Copy className="size-3.5" /> {t("instance.copyLogs")}
                    </button>
                  )}
                </div>
                <div
                  ref={logRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    atBottomRef.current =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                  }}
                  className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-stroke p-4 font-mono text-xs leading-relaxed text-slate-300 select-text"
                  style={{
                    background: "var(--console-bg)",
                    maxHeight: "calc(100vh - 410px)",
                  }}
                >
                  {allLines.length === 0 ? (
                    <span className="text-slate-500">{t("instance.logsEmpty")}</span>
                  ) : visible.length === 0 ? (
                    <span className="text-slate-500">{t("instance.logNoMatch")}</span>
                  ) : (
                    visible.map(({ i, line, level }) => (
                      <div
                        key={i}
                        className={
                          level === "error"
                            ? "text-rose-400"
                            : level === "warn"
                              ? "text-amber-300"
                              : undefined
                        }
                      >
                        {highlightLog(line, q)}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })()}

        {tab === "settings" && (
          <div className="flex flex-col gap-4 pb-4">
            <OverridesCard instanceId={id} />

            <div className="card divide-y divide-stroke">
              <ManageRow
                title={t("instance.renameTitle")}
                desc={t("instance.renameDesc")}
                btn={
                  <button className="btn-secondary" onClick={() => setShowRename(true)}>
                    <Pencil className="size-4" /> {t("common.rename")}
                  </button>
                }
              />
              <ManageRow
                title={t("instance.iconTitle")}
                desc={t("instance.iconDesc")}
                btn={
                  <button className="btn-secondary" onClick={doSetIcon}>
                    <Image className="size-4" /> {t("instance.iconBtn")}
                  </button>
                }
              />
              <ManageRow
                title={t("instance.cloneTitle")}
                desc={t("instance.cloneDesc")}
                btn={
                  <button className="btn-secondary" onClick={doClone}>
                    <CopyPlus className="size-4" /> {t("instance.cloneBtn")}
                  </button>
                }
              />
              <ManageRow
                title={t("instance.exportTitle")}
                desc={t("instance.exportDesc")}
                btn={
                  <button className="btn-secondary" onClick={doExport}>
                    <Package className="size-4" /> {t("instance.exportBtn")}
                  </button>
                }
              />
              <ManageRow
                title={t("instance.repairTitle")}
                desc={t("instance.repairDesc")}
                btn={
                  <button className="btn-secondary" disabled={!!busy} onClick={doRepair}>
                    <Wrench className="size-4" /> {t("instance.repairBtn")}
                  </button>
                }
              />
              <ManageRow
                title={t("instance.folderTitle")}
                desc={t("instance.folderDesc")}
                btn={
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      api.openInstanceFolder(id).catch((e) => toast("error", errorText(e)))
                    }
                  >
                    <FolderOpen className="size-4" /> {t("common.open")}
                  </button>
                }
              />
              <ManageRow
                title={t("instance.deleteTitle")}
                desc={t("instance.deleteDesc")}
                danger
                btn={
                  <button className="btn-danger" onClick={() => setShowDelete(true)}>
                    <Trash2 className="size-4" /> {t("common.delete")}
                  </button>
                }
              />
            </div>
          </div>
        )}
      </div>

      {showRename && (
        <RenameInstanceModal instance={instance} onClose={() => setShowRename(false)} />
      )}
      {showDelete && (
        <DeleteInstanceModal
          instance={instance}
          onClose={() => setShowDelete(false)}
          onDeleted={() => navigate({ page: "instances" })}
        />
      )}
    </div>
  );
}

function ManageRow({
  title,
  desc,
  btn,
  danger,
}: {
  title: string;
  desc: string;
  btn: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <div className={`text-sm font-medium ${danger ? "text-danger" : "text-t1"}`}>
          {title}
        </div>
        <div className="text-xs text-t3">{desc}</div>
      </div>
      {btn}
    </div>
  );
}

function OverridesCard({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation();
  const { instances, settings, systemInfo, refreshInstances, toast } = useStore();
  const instance = instances.find((i) => i.id === instanceId);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [local, setLocal] = useState<InstanceOverrides | null>(
    instance?.overrides ?? null,
  );

  // Cancel a pending debounced save if the card unmounts (tab switch / navigate).
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  if (!instance || !settings) return null;

  const enabled = local !== null;
  const maxMemory = systemInfo
    ? Math.max(2048, systemInfo.totalMemoryMb - 2048)
    : 16384;

  const persist = (next: InstanceOverrides | null) => {
    setLocal(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.setInstanceOverrides(instanceId, next);
        await refreshInstances();
      } catch (e) {
        toast("error", errorText(e));
      }
    }, 400);
  };

  const memory = local?.memoryMb ?? settings.memoryMb;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-t1">
            {t("instance.overridesTitle")}
          </div>
          <div className="text-xs text-t3">{t("instance.overridesDesc")}</div>
        </div>
        <Toggle
          checked={enabled}
          onChange={(on) =>
            persist(
              on
                ? {
                    memoryMb: settings.memoryMb,
                    javaArgs: settings.javaArgs,
                    gameWidth: settings.gameWidth,
                    gameHeight: settings.gameHeight,
                    fullscreen: settings.fullscreen,
                  }
                : null,
            )
          }
        />
      </div>

      {enabled && local && (
        <div className="mt-5 flex flex-col gap-4">
          <div>
            <div className="mb-2 flex justify-between text-sm">
              <span className="font-medium text-t2">
                {t("instance.overridesMemory", {
                  gb: ((local.memoryMb ?? settings.memoryMb) / 1024).toFixed(1),
                })}
              </span>
            </div>
            <input
              type="range"
              min={1024}
              max={maxMemory}
              step={512}
              value={memory}
              onChange={(e) => persist({ ...local, memoryMb: Number(e.target.value) })}
              className="w-full accent-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.width")}>
              <input
                type="number"
                className="input-base"
                value={local.gameWidth ?? settings.gameWidth}
                disabled={local.fullscreen ?? settings.fullscreen}
                onChange={(e) =>
                  persist({ ...local, gameWidth: Number(e.target.value) || 0 })
                }
              />
            </Field>
            <Field label={t("settings.height")}>
              <input
                type="number"
                className="input-base"
                value={local.gameHeight ?? settings.gameHeight}
                disabled={local.fullscreen ?? settings.fullscreen}
                onChange={(e) =>
                  persist({ ...local, gameHeight: Number(e.target.value) || 0 })
                }
              />
            </Field>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-t2">
              {t("settings.fullscreen")}
            </span>
            <Toggle
              checked={local.fullscreen ?? settings.fullscreen}
              onChange={(v) => persist({ ...local, fullscreen: v })}
            />
          </div>

          <Field label={t("settings.jvmArgs")}>
            <input
              className="input-base font-mono !text-xs"
              placeholder="-XX:+UseG1GC"
              value={local.javaArgs ?? ""}
              onChange={(e) => persist({ ...local, javaArgs: e.target.value })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
