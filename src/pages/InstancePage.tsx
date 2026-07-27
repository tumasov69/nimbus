import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import {
  ArrowDownToLine,
  ArrowLeft,
  Clock,
  Copy,
  CopyPlus,
  ExternalLink,
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
  TriangleAlert,
  Undo2,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import { ServersTab } from "../components/ServersTab";
import { WorldsTab } from "../components/WorldsTab";
import {
  Field,
  InstanceIcon,
  LOADER_GRADIENTS,
  LoaderBadge,
  Modal,
  ProgressBar,
  Spinner,
  Toggle,
  formatBytes,
  formatDuration,
  useTransferStats,
  formatPlaytime,
  instanceIconSrc,
} from "../components/ui";
import { notify } from "../notify";
import type { Route } from "../routes";
import { errorText, useStore } from "../store";
import type { InstanceOverrides, ModFile } from "../types";
import { DeleteInstanceModal, RenameInstanceModal } from "./InstancesPage";

type Tab = "mods" | "worlds" | "servers" | "logs" | "crashes" | "settings";

type ModFilter = "all" | "updates" | "disabled";

type LogLevel = "error" | "warn" | "info";

/** Classifies a Minecraft log line by severity for colouring/filtering. */
function logLevelOf(line: string): LogLevel {
  if (/\/(ERROR|FATAL)\]|\bERROR\b|\bFATAL\b|Exception/.test(line)) return "error";
  if (/\/WARN\]|\bWARN(?:ING)?\b/.test(line)) return "warn";
  return "info";
}

/** "sodium-fabric-0.5.8.jar" → "sodium-fabric": the part of a mod file name
 *  that stays stable across versions. Mirrors the backend helper so a kept
 *  backup can be matched to the installed file. */
function modKey(fileName: string): string {
  const stem = fileName.replace(/\.disabled$/, "").replace(/\.jar$/, "");
  const out: string[] = [];
  for (const part of stem.split(/[-_+]/)) {
    if (/^\d/.test(part)) break;
    out.push(part);
  }
  return out.join("-").toLowerCase();
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

/**
 * Crash diagnostics. Minecraft writes `crash-reports/*.txt` on every hard
 * crash and nobody reads them — this surfaces the newest one, names the mods
 * that appear in the stack trace and offers to switch them off right there.
 */
function CrashesTab({
  id,
  contentFolder,
  onModsChanged,
}: {
  id: string;
  contentFolder: api.ContentFolder;
  onModsChanged: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useStore();
  const [reports, setReports] = useState<api.CrashReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [detail, setDetail] = useState<api.CrashReportDetail | null>(null);
  const [disabling, setDisabling] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listCrashReports(id)
      .then((list) => {
        if (cancelled) return;
        setReports(list);
        // Open the newest report right away — that is why people come here.
        if (list[0]) setOpenFile(list[0].file);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!openFile) return;
    let cancelled = false;
    setDetail(null);
    api
      .readCrashReport(id, openFile)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && toast("error", errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [id, openFile, toast]);

  const disableMod = async (fileName: string) => {
    setDisabling(fileName);
    try {
      await api.toggleMod(id, fileName, false, contentFolder);
      api.invalidateEnrich(id);
      onModsChanged();
      toast("success", t("tools.crashDisable"));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setDisabling(null);
    }
  };

  if (loading) {
    return (
      <div className="card flex items-center justify-center gap-2 py-12 text-t3">
        <Spinner /> {t("common.loading")}
      </div>
    );
  }
  if (reports.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 py-14 text-center text-t3">
        <TriangleAlert className="size-7 opacity-40" />
        {t("tools.crashEmpty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {reports.slice(0, 8).map((r) => (
            <button
              key={r.file}
              onClick={() => setOpenFile(r.file)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                openFile === r.file
                  ? "tab-active"
                  : "text-t3 hover:bg-accent-soft hover:text-t1"
              }`}
            >
              {new Date(r.modifiedMs).toLocaleString()}
            </button>
          ))}
        </div>
        <button
          className="btn-secondary ml-auto !py-2"
          onClick={() => api.openInstanceFolder(id).catch(() => {})}
        >
          <FolderOpen className="size-3.5" /> {t("tools.crashOpenFolder")}
        </button>
      </div>

      {!detail ? (
        <div className="card flex items-center justify-center gap-2 py-10 text-t3">
          <Spinner /> {t("common.loading")}
        </div>
      ) : (
        <>
          <div className="card card-action py-4 pl-5 pr-4">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-medium text-t1">
                  {detail.summary || t("tools.crashTitle")}
                </div>
                {detail.suspects.length > 0 && (
                  <>
                    <div className="mt-3 text-xs font-medium text-t2">
                      {t("tools.crashSuspects")}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {detail.suspects.map((s) => (
                        <span
                          key={s}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-soft px-2 py-1 text-xs text-t2"
                        >
                          <Puzzle className="size-3" />
                          <span className="max-w-56 truncate">{s}</span>
                          <button
                            className="text-t3 transition-colors hover:text-danger cursor-pointer"
                            title={t("tools.crashDisable")}
                            disabled={disabling === s}
                            onClick={() => disableMod(s)}
                          >
                            {disabling === s ? (
                              <Spinner className="size-3" />
                            ) : (
                              <Square className="size-3" />
                            )}
                          </button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                className="btn-secondary shrink-0 !py-2"
                onClick={() => {
                  navigator.clipboard
                    .writeText(detail.text)
                    .then(() => toast("success", t("tools.crashCopied")))
                    .catch(() => {});
                }}
              >
                <Copy className="size-3.5" /> {t("tools.crashCopy")}
              </button>
            </div>
          </div>

          <div
            className="min-h-0 flex-1 overflow-auto rounded-2xl border border-stroke p-4 font-mono text-xs leading-relaxed text-slate-300 select-text"
            style={{ background: "var(--console-bg)", maxHeight: "calc(100vh - 430px)" }}
          >
            <pre className="whitespace-pre-wrap break-words">{detail.text}</pre>
          </div>
        </>
      )}
    </div>
  );
}

export function InstancePage({
  id,
  navigate,
}: {
  id: string;
  navigate: (r: Route) => void;
}) {
  const { t } = useTranslation();
  const { instances, statuses, logs, logsVersion, toast, accounts, refreshInstances } =
    useStore();
  const instance = instances.find((i) => i.id === id);
  const status = statuses[id];
  const [tab, setTab] = useState<Tab>("mods");
  const [packUpdate, setPackUpdate] = useState<api.ModpackUpdate | null>(null);
  const [updatingPack, setUpdatingPack] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
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
  const [modSearch, setModSearch] = useState("");
  const [modFilter, setModFilter] = useState<ModFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [backups, setBackups] = useState<Record<string, api.ModBackup>>({});

  const busy =
    status && ["preparing", "installing", "launching"].includes(status.state);
  const running = status?.state === "running";
  const progress = status?.progress;
  // Hook order matters: this must run before the early "instance not found".
  const transfer = useTransferStats(progress?.current ?? 0, progress?.total ?? 0);

  // Filtering/classifying up to 600 log lines is not free — recompute only
  // when new lines arrive (logsVersion) or the filters change, not on every
  // unrelated re-render (status ticks, toasts, …).
  const logQuery = logSearch.trim().toLowerCase();
  const visibleLogLines = useMemo(
    () =>
      (logs[id] ?? [])
        .map((line, i) => ({ i, line, level: logLevelOf(line) }))
        .filter(({ line, level }) => {
          if (logLevel === "error" && level !== "error") return false;
          if (logLevel === "warn" && level === "info") return false;
          if (logQuery && !line.toLowerCase().includes(logQuery)) return false;
          return true;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logsVersion, logQuery, logLevel, id],
  );

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
      setMods(await api.listMods(id, contentFolder));
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

  // Kept previous versions, so a bad update can be undone from the list.
  useEffect(() => {
    if (contentFolder !== "mods") return;
    let cancelled = false;
    api
      .listModBackups(id)
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, api.ModBackup> = {};
        for (const b of list) map[modKey(b.fileName)] = b;
        setBackups(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, contentFolder, mods]);

  const rollback = async (fileName: string) => {
    try {
      await api.rollbackMod(id, fileName);
      api.invalidateEnrich(id);
      await loadMods(true);
      toast("success", t("tools.rollbackDone"));
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  // Visible list: search + filter. Selection is keyed by file name.
  const visibleMods = useMemo(() => {
    const q = modSearch.trim().toLowerCase();
    return mods.filter((m) => {
      if (modFilter === "updates" && !modInfo[m.fileName]?.updateVersionId) return false;
      if (modFilter === "disabled" && m.enabled) return false;
      if (!q) return true;
      const title = modInfo[m.fileName]?.title ?? "";
      return (
        m.displayName.toLowerCase().includes(q) ||
        title.toLowerCase().includes(q)
      );
    });
  }, [mods, modInfo, modSearch, modFilter]);

  const toggleSelected = (fileName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(fileName) ? next.delete(fileName) : next.add(fileName);
      return next;
    });
  };

  /** Applies an action to every selected mod, then refreshes once. */
  const bulkAction = async (action: "enable" | "disable" | "delete") => {
    const targets = mods.filter((m) => selected.has(m.fileName));
    if (targets.length === 0) return;
    setBulkBusy(true);
    let failed = 0;
    for (const mod of targets) {
      try {
        if (action === "delete") {
          await api.deleteMod(id, mod.fileName, contentFolder);
        } else {
          const enabled = action === "enable";
          if (mod.enabled === enabled) continue;
          await api.toggleMod(id, mod.fileName, enabled, contentFolder);
        }
      } catch {
        failed++;
      }
    }
    setSelected(new Set());
    api.invalidateEnrich(id);
    await loadMods(true);
    setBulkBusy(false);
    if (failed) toast("error", errorText(`${failed}`));
  };

  const updateAllMods = async () => {
    const targets = updatableMods.map((m) => ({
      fileName: m.fileName,
      versionId: modInfo[m.fileName].updateVersionId!,
    }));
    setUpdatingMods(new Set(targets.map((t) => t.fileName)));
    let updated = 0;
    let failed = 0;
    // A few downloads in flight at once: much faster than one-by-one for
    // large packs, still gentle on the Modrinth API.
    const queue = [...targets];
    const worker = async () => {
      for (;;) {
        const target = queue.shift();
        if (!target) return;
        try {
          const newName = await api.modrinthUpdateMod(
            id,
            target.fileName,
            target.versionId,
          );
          clearUpdateBadge(target.fileName, newName);
          updated++;
        } catch {
          failed++; // failed mods stay on the old version
        } finally {
          setUpdatingMods((prev) => {
            const next = new Set(prev);
            next.delete(target.fileName);
            return next;
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(3, targets.length) }, worker),
    );
    setUpdatingMods(new Set());
    api.invalidateEnrich(id);
    setMods(await api.listMods(id, contentFolder));
    const message = failed
      ? t("instance.modsUpdatedPartial", { n: updated, m: failed })
      : t("instance.modsUpdated", { n: updated });
    toast(failed ? "info" : "success", message);
    notify("Nimbus", message);
  };

  useEffect(() => {
    loadMods();
  }, [loadMods]);

  // Files dropped on the window are installed by App; refresh when that lands.
  useEffect(() => {
    const refresh = () => loadMods(true);
    window.addEventListener("nimbus:mods-changed", refresh);
    return () => window.removeEventListener("nimbus:mods-changed", refresh);
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
  // `logs` never changes identity — logsVersion is the actual "new lines" signal.
  useEffect(() => {
    if (tab === "logs" && logRef.current && atBottomRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [tab, logsVersion, status?.state]);

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
        {/* Give the page a face: the instance's own art, or its loader colour
            when it has none — the plain grey header read as a form. */}
        <div className="absolute inset-0" aria-hidden>
          {instanceIconSrc(instance) ? (
            <img
              src={instanceIconSrc(instance)!}
              alt=""
              className="banner-img !opacity-25 dark:!opacity-20"
            />
          ) : (
            <div
              className="size-full opacity-[0.15] dark:opacity-25"
              style={{ background: LOADER_GRADIENTS[instance.loader] }}
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(105deg, var(--card) 30%, transparent 125%)",
            }}
          />
        </div>
        <div className="relative flex flex-wrap items-center gap-3">
          <InstanceIcon
            instance={instance}
            size={64}
            rounded="rounded-2xl"
            className="shadow-lg"
          />
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
            <div className="mb-1.5 flex justify-between gap-4 text-xs text-t3">
              <span className="truncate">{progress.path.split(/[\\/]/).pop()}</span>
              <span className="shrink-0 tabular-nums">
                {progress.kind === "multiple"
                  ? `${progress.current} / ${progress.total}`
                  : `${formatBytes(progress.current)} / ${formatBytes(progress.total)}`}
                {transfer && progress.kind !== "multiple" && (
                  <>
                    {" · "}
                    {t("tools.speed", { speed: formatBytes(transfer.speed) })}
                    {" · "}
                    {t("tools.eta", { time: formatDuration(transfer.etaSec) })}
                  </>
                )}
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
          <button
            className="btn-primary"
            disabled={updatingPack}
            onClick={() => setShowChangelog(true)}
          >
            {updatingPack && <Spinner />}
            {t("instance.packUpdateBtn")}
          </button>
        </div>
      )}

      {/* What the update actually changes — people fear breaking their world. */}
      {showChangelog && packUpdate && (
        <Modal
          title={t("tools.changelogTitle", { v: packUpdate.versionNumber })}
          onClose={() => setShowChangelog(false)}
        >
          <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-t2 select-text">
            {packUpdate.changelog || t("tools.changelogEmpty")}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setShowChangelog(false)}>
              {t("common.cancel")}
            </button>
            <button
              className="btn-primary"
              disabled={updatingPack}
              onClick={() => {
                setShowChangelog(false);
                doUpdatePack();
              }}
            >
              <ArrowDownToLine className="size-4" /> {t("tools.updateNow")}
            </button>
          </div>
        </Modal>
      )}

      <div className="mb-4 flex gap-1">
        {(
          [
            ["mods", supportsMods ? t("instance.mods") : t("browse.resourcepacks")],
            ["worlds", t("instance.worlds")],
            ["servers", t("instance.servers")],
            ["logs", t("instance.logs")],
            ["crashes", t("tools.crashTitle")],
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
            {/* Search + filters: a modpack can hold hundreds of mods. */}
            {mods.length > 6 && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-48 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-t3" />
                  <input
                    value={modSearch}
                    onChange={(e) => setModSearch(e.target.value)}
                    placeholder={t("tools.modSearch")}
                    className="input-base !py-2 pl-9"
                  />
                </div>
                <div className="flex shrink-0 overflow-hidden rounded-lg border border-stroke-strong">
                  {(
                    [
                      ["all", t("tools.filterAll"), mods.length],
                      ["updates", t("tools.filterUpdates"), updatableMods.length],
                      [
                        "disabled",
                        t("tools.filterDisabled"),
                        mods.filter((m) => !m.enabled).length,
                      ],
                    ] as [ModFilter, string, number][]
                  ).map(([key, label, count]) => (
                    <button
                      key={key}
                      onClick={() => setModFilter(key)}
                      className={`px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        modFilter === key
                          ? "bg-accent text-accent-fg"
                          : "text-t3 hover:bg-accent-soft hover:text-t1"
                      }`}
                    >
                      {label} <span className="opacity-70">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Bulk actions appear only with a selection. */}
            {selected.size > 0 && (
              <div className="card card-action flex flex-wrap items-center gap-2 py-2.5 pl-4 pr-3">
                <span className="mr-auto text-sm font-medium text-t1">
                  {t("tools.selected", { n: selected.size })}
                </span>
                <button
                  className="btn-ghost !py-1.5"
                  disabled={bulkBusy}
                  onClick={() => bulkAction("enable")}
                >
                  {t("tools.enableSel")}
                </button>
                <button
                  className="btn-ghost !py-1.5"
                  disabled={bulkBusy}
                  onClick={() => bulkAction("disable")}
                >
                  {t("tools.disableSel")}
                </button>
                <button
                  className="btn-ghost !py-1.5 hover:!bg-danger-soft hover:!text-danger"
                  disabled={bulkBusy}
                  onClick={() => bulkAction("delete")}
                >
                  {bulkBusy ? <Spinner className="size-3.5" /> : <Trash2 className="size-3.5" />}
                  {t("tools.deleteSel")}
                </button>
                <button
                  className="btn-ghost !py-1.5"
                  onClick={() => setSelected(new Set())}
                >
                  {t("tools.clearSel")}
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2">
              {visibleMods.length > 1 && (
                <button
                  className="btn-ghost mr-auto"
                  onClick={() =>
                    setSelected(
                      selected.size === visibleMods.length
                        ? new Set()
                        : new Set(visibleMods.map((m) => m.fileName)),
                    )
                  }
                >
                  {selected.size === visibleMods.length
                    ? t("tools.clearSel")
                    : t("tools.selectAll")}
                </button>
              )}
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
            ) : visibleMods.length === 0 ? (
              <div className="card py-12 text-center text-t3">
                {t("instance.logNoMatch")}
              </div>
            ) : (
              <div className="card divide-y divide-stroke">
                {visibleMods.map((mod) => {
                  const info = modInfo[mod.fileName];
                  const updating = updatingMods.has(mod.fileName);
                  const backup = backups[modKey(mod.fileName)];
                  const isSelected = selected.has(mod.fileName);
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
                        isSelected ? "bg-accent-soft" : ""
                      } ${
                        openProject
                          ? "cursor-pointer transition-colors hover:bg-bg-soft"
                          : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelected(mod.fileName)}
                        className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
                      />
                      <span onClick={(e) => e.stopPropagation()}>
                        <Toggle
                          checked={mod.enabled}
                          onChange={async (checked) => {
                            try {
                              await api.toggleMod(id, mod.fileName, checked, contentFolder);
                              // A toggle only renames the file — patch state
                              // locally instead of re-hashing every jar and
                              // re-querying Modrinth.
                              const newName = checked
                                ? mod.fileName.replace(/\.disabled$/, "")
                                : `${mod.fileName}.disabled`;
                              setMods((prev) =>
                                prev.map((m) =>
                                  m.fileName === mod.fileName
                                    ? { ...m, fileName: newName, enabled: checked }
                                    : m,
                                ),
                              );
                              setModInfo((prev) => {
                                const info = prev[mod.fileName];
                                if (!info) return prev;
                                const next = { ...prev };
                                delete next[mod.fileName];
                                next[newName] = { ...info, fileName: newName };
                                return next;
                              });
                              api.invalidateEnrich(id);
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
                      {backup && (
                        <button
                          className="btn-ghost !p-2"
                          title={t("tools.rollbackHint")}
                          onClick={(e) => {
                            e.stopPropagation();
                            rollback(backup.fileName);
                          }}
                        >
                          <Undo2 className="size-4" />
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
        {tab === "crashes" && (
          <CrashesTab
            id={id}
            contentFolder={contentFolder}
            onModsChanged={() => loadMods(true)}
          />
        )}

        {tab === "logs" &&
          (() => {
            const allLines = logs[id] ?? [];
            const q = logQuery;
            const visible = visibleLogLines;
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
                title={t("tools.shortcutTitle")}
                desc={t("tools.shortcutDesc")}
                btn={
                  <button
                    className="btn-secondary"
                    onClick={async () => {
                      try {
                        await api.createDesktopShortcut(id);
                        toast("success", t("tools.shortcutDone"));
                      } catch (e) {
                        toast("error", errorText(e));
                      }
                    }}
                  >
                    <ExternalLink className="size-4" /> {t("tools.shortcutBtn")}
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
