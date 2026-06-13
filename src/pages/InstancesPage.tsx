import {
  Box,
  Clock,
  Folder,
  FolderInput,
  FolderOpen,
  MoreVertical,
  Package,
  Pencil,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import {
  Dropdown,
  Field,
  LoaderBadge,
  LOADER_LABELS,
  Modal,
  ProgressBar,
  SelectWrap,
  Spinner,
  formatRelativeDate,
  instanceIconSrc,
} from "../components/ui";
import type { Route } from "../routes";
import { errorText, useStore, type InstanceStatus } from "../store";
import type { Instance, LoaderKind, McVersion } from "../types";

function useStatusLabel() {
  const { t } = useTranslation();
  return (status?: InstanceStatus): string | null => {
    switch (status?.state) {
      case "preparing":
        return t("status.preparing");
      case "installing":
        return status.packProgress
          ? t("status.packDownloading", {
              current: status.packProgress.current,
              total: status.packProgress.total,
            })
          : t("status.installing");
      case "launching":
        return t("status.launching");
      case "running":
        return t("status.running");
      default:
        return null;
    }
  };
}

function InstanceCard({
  instance,
  status,
  onOpen,
  onPlay,
  onStop,
  onRename,
  onDelete,
  onMoveToFolder,
}: {
  instance: Instance;
  status?: InstanceStatus;
  onOpen: () => void;
  onPlay: () => void;
  onStop: () => void;
  onRename: () => void;
  onDelete: () => void;
  onMoveToFolder: () => void;
}) {
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();
  const busy =
    status &&
    ["preparing", "installing", "launching"].includes(status.state);
  const running = status?.state === "running";
  const label = statusLabel(status);

  const progress = status?.packProgress
    ? status.packProgress.current / Math.max(1, status.packProgress.total)
    : status?.progress
      ? status.progress.current / Math.max(1, status.progress.total)
      : null;

  const icon = instanceIconSrc(instance);

  // Loader-flavoured fallback gradient for the cover banner.
  const LOADER_GRADIENTS: Record<string, string> = {
    vanilla: "linear-gradient(135deg, #10b981 0%, #0ea5e9 120%)",
    fabric: "linear-gradient(135deg, #f59e0b 0%, #f97316 120%)",
    quilt: "linear-gradient(135deg, #d946ef 0%, #8b5cf6 120%)",
    forge: "linear-gradient(135deg, #64748b 0%, #334155 120%)",
    neoforge: "linear-gradient(135deg, #f97316 0%, #ef4444 120%)",
  };

  return (
    <div
      onClick={onOpen}
      className="card group cursor-pointer overflow-hidden !p-0 transition-all hover:-translate-y-0.5"
    >
      {/* Cover banner: blurred icon backdrop (or loader gradient) */}
      <div
        className="relative h-20 overflow-hidden"
        style={!icon ? { background: LOADER_GRADIENTS[instance.loader] } : undefined}
      >
        {icon && <img src={icon} alt="" className="banner-img" />}

        {/* Hover play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
          <button
            onClick={(e) => {
              e.stopPropagation();
              running ? onStop() : onPlay();
            }}
            disabled={busy}
            title={running ? t("common.stop") : t("common.play")}
            className={`flex size-12 items-center justify-center rounded-full shadow-lg transition-all active:scale-95 cursor-pointer disabled:cursor-default ${
              running
                ? "bg-danger text-white opacity-100"
                : "btn-primary !rounded-full !p-0 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100"
            } ${busy ? "!opacity-100 !scale-100" : ""}`}
          >
            {busy ? (
              <Spinner className="size-5" />
            ) : running ? (
              <Square className="size-5 fill-current" />
            ) : (
              <Play className="size-5 fill-current" />
            )}
          </button>
        </div>

        {/* Context menu (top-right of banner) */}
        <div
          className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <Dropdown
            trigger={
              <button className="flex size-8 items-center justify-center rounded-lg bg-black/35 text-white backdrop-blur transition-colors hover:bg-black/55 cursor-pointer">
                <MoreVertical className="size-4" />
              </button>
            }
            items={[
              {
                label: t("instances.openFolder"),
                icon: <FolderOpen className="size-4" />,
                onClick: () => api.openInstanceFolder(instance.id),
              },
              {
                label: t("common.rename"),
                icon: <Pencil className="size-4" />,
                onClick: onRename,
              },
              {
                label: t("instances.moveToFolder"),
                icon: <FolderInput className="size-4" />,
                onClick: onMoveToFolder,
              },
              {
                label: t("common.delete"),
                icon: <Trash2 className="size-4" />,
                danger: true,
                onClick: onDelete,
              },
            ]}
          />
        </div>
      </div>

      {/* Body: floating icon + name + meta */}
      <div className="relative px-3.5 pb-3.5">
        <div className="-mt-7 mb-1.5 inline-block rounded-xl border-[3px] border-card bg-card shadow-sm">
          {icon ? (
            <img src={icon} alt="" className="size-12 rounded-lg object-cover" />
          ) : (
            <div className="flex size-12 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
              <Box className="size-6" />
            </div>
          )}
        </div>

        <div className="truncate text-[15px] font-semibold tracking-tight text-t1">
          {instance.name}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <LoaderBadge loader={instance.loader} />
          <span className="text-xs text-t3">{instance.mcVersion}</span>
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-t3">
          {label ? (
            <span
              className={
                running ? "font-medium text-success" : "text-accent-text animate-pulse-soft"
              }
            >
              {label}
            </span>
          ) : (
            <>
              <Clock className="size-3.5" />
              {formatRelativeDate(instance.lastPlayed)}
            </>
          )}
        </div>
        {progress !== null && busy && <ProgressBar value={progress} className="mt-2" />}
      </div>
    </div>
  );
}

export function CreateInstanceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (instance: Instance) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useStore();
  const [name, setName] = useState("");
  const [versions, setVersions] = useState<McVersion[]>([]);
  const [versionType, setVersionType] = useState<"release" | "snapshot" | "old">(
    "release",
  );
  const [mcVersion, setMcVersion] = useState("");
  const [loader, setLoader] = useState<LoaderKind>("vanilla");
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loaderVersion, setLoaderVersion] = useState("");
  const [loadingLoaders, setLoadingLoaders] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .getMinecraftVersions()
      .then((v) => {
        setVersions(v);
        const firstRelease = v.find((x) => x.type === "release");
        if (firstRelease) setMcVersion(firstRelease.id);
      })
      .catch((e) => toast("error", errorText(e)));
  }, [toast]);

  useEffect(() => {
    setLoaderVersions([]);
    setLoaderVersion("");
    if (loader === "vanilla" || !mcVersion) return;
    setLoadingLoaders(true);
    api
      .getLoaderVersions(loader, mcVersion)
      .then((list) => {
        setLoaderVersions(list);
        setLoaderVersion(list[0] ?? "");
      })
      .catch(() => setLoaderVersions([]))
      .finally(() => setLoadingLoaders(false));
  }, [loader, mcVersion]);

  const visibleVersions = useMemo(
    () =>
      versions.filter((v) => {
        if (versionType === "release") return v.type === "release";
        if (versionType === "snapshot") return v.type === "snapshot";
        return v.type === "old_beta" || v.type === "old_alpha";
      }),
    [versions, versionType],
  );

  // Keep the selected version valid when the type filter changes.
  useEffect(() => {
    if (visibleVersions.length === 0) return;
    if (!visibleVersions.some((v) => v.id === mcVersion)) {
      setMcVersion(visibleVersions[0].id);
    }
  }, [visibleVersions, mcVersion]);

  const create = async () => {
    setCreating(true);
    try {
      const instance = await api.createInstance(
        name,
        mcVersion,
        loader,
        loader === "vanilla" ? null : loaderVersion,
      );
      onCreated(instance);
      toast("success", t("instances.created", { name: instance.name }));
      onClose();
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setCreating(false);
    }
  };

  const canCreate =
    name.trim().length > 0 && mcVersion && (loader === "vanilla" || loaderVersion);

  return (
    <Modal title={t("instances.newInstance")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label={t("instances.name")}>
          <input
            className="input-base"
            placeholder={t("instances.namePlaceholder")}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label={t("instances.mcVersion")}>
          <div className="mb-2 flex gap-1">
            {(
              [
                ["release", t("instances.typeRelease")],
                ["snapshot", t("instances.typeSnapshot")],
                ["old", t("instances.typeOld")],
              ] as ["release" | "snapshot" | "old", string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setVersionType(key)}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                  versionType === key
                    ? "border-accent bg-accent-soft text-accent-text"
                    : "border-stroke-strong bg-card text-t3 hover:text-t1"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <SelectWrap>
            <select
              className="select-base"
              value={mcVersion}
              onChange={(e) => setMcVersion(e.target.value)}
            >
              {visibleVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                </option>
              ))}
            </select>
          </SelectWrap>
        </Field>

        <Field label={t("instances.loader")}>
          <div className="grid grid-cols-5 gap-1.5">
            {(Object.keys(LOADER_LABELS) as LoaderKind[]).map((l) => (
              <button
                key={l}
                onClick={() => setLoader(l)}
                className={`rounded-xl border px-1 py-2 text-xs font-medium transition-all cursor-pointer ${
                  loader === l
                    ? "border-accent bg-accent-soft text-accent-text"
                    : "border-stroke-strong bg-card text-t3 hover:text-t1"
                }`}
              >
                {LOADER_LABELS[l]}
              </button>
            ))}
          </div>
        </Field>

        {loader !== "vanilla" && (
          <Field label={t("instances.loaderVersion")}>
            {loadingLoaders ? (
              <div className="flex items-center gap-2 py-2 text-sm text-t3">
                <Spinner /> {t("instances.loadingVersions")}
              </div>
            ) : loaderVersions.length === 0 ? (
              <div className="py-2 text-sm text-danger">
                {t("instances.noLoaderVersions", {
                  loader: LOADER_LABELS[loader],
                  mc: mcVersion,
                })}
              </div>
            ) : (
              <SelectWrap>
                <select
                  className="select-base"
                  value={loaderVersion}
                  onChange={(e) => setLoaderVersion(e.target.value)}
                >
                  {loaderVersions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </SelectWrap>
            )}
          </Field>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn-primary" disabled={!canCreate || creating} onClick={create}>
            {creating && <Spinner />}
            {t("common.create")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function DeleteInstanceModal({
  instance,
  onClose,
  onDeleted,
}: {
  instance: Instance;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { toast, refreshInstances } = useStore();
  return (
    <Modal title={t("instance.deleteConfirmTitle")} onClose={onClose}>
      <p className="text-sm text-t2">
        {t("instance.deleteConfirmText", { name: instance.name })}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          className="btn-danger"
          onClick={async () => {
            try {
              await api.deleteInstance(instance.id);
              await refreshInstances();
              toast("success", t("instances.deleted"));
              onClose();
              onDeleted();
            } catch (e) {
              toast("error", errorText(e));
            }
          }}
        >
          <Trash2 className="size-4" /> {t("instance.deleteForever")}
        </button>
      </div>
    </Modal>
  );
}

export function RenameInstanceModal({
  instance,
  onClose,
}: {
  instance: Instance;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast, refreshInstances } = useStore();
  const [name, setName] = useState(instance.name);
  return (
    <Modal title={t("instance.renameTitle")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label={t("instances.name")}>
          <input
            className="input-base"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="btn-primary"
            disabled={!name.trim()}
            onClick={async () => {
              try {
                await api.renameInstance(instance.id, name);
                await refreshInstances();
                onClose();
              } catch (e) {
                toast("error", errorText(e));
              }
            }}
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

type InstanceFilter = "all" | "modpacks" | "custom";
type InstanceSort = "recent" | "name" | "created";

export function MoveToFolderModal({
  instance,
  folders,
  onClose,
}: {
  instance: Instance;
  folders: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast, refreshInstances } = useStore();
  const [name, setName] = useState(instance.group ?? "");

  const apply = async (value: string | null) => {
    try {
      await api.setInstanceGroup(instance.id, value);
      await refreshInstances();
      onClose();
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  return (
    <Modal title={t("instances.moveToFolder")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label={t("instances.folderName")}>
          <input
            className="input-base"
            placeholder={t("instances.folderPlaceholder")}
            value={name}
            autoFocus
            list="folder-suggestions"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply(name.trim() || null)}
          />
          <datalist id="folder-suggestions">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
        {folders.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {folders.map((f) => (
              <button
                key={f}
                className="rounded-lg border border-stroke-strong px-2.5 py-1 text-xs font-medium text-t2 hover:bg-bg-soft cursor-pointer"
                onClick={() => setName(f)}
              >
                {f}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-between gap-2">
          {instance.group && (
            <button className="btn-ghost !text-danger" onClick={() => apply(null)}>
              {t("instances.removeFromFolder")}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button className="btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button className="btn-primary" onClick={() => apply(name.trim() || null)}>
              {t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function InstancesPage({ navigate }: { navigate: (r: Route) => void }) {
  const { t } = useTranslation();
  const { instances, statuses, refreshInstances, toast, accounts } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [renameFor, setRenameFor] = useState<Instance | null>(null);
  const [deleteFor, setDeleteFor] = useState<Instance | null>(null);
  const [moveFor, setMoveFor] = useState<Instance | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InstanceFilter>("all");
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<InstanceSort>("recent");

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const i of instances) if (i.group) set.add(i.group);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [instances]);

  const counts = useMemo(
    () => ({
      all: instances.length,
      modpacks: instances.filter((i) => i.modpack).length,
      custom: instances.filter((i) => !i.modpack).length,
    }),
    [instances],
  );

  const visible = useMemo(() => {
    let list = instances.filter((i) => {
      if (filter === "modpacks" && !i.modpack) return false;
      if (filter === "custom" && i.modpack) return false;
      if (folderFilter && i.group !== folderFilter) return false;
      if (query && !i.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "created")
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      // recent: last played first, then by creation
      const ta = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
      const tb = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
      if (ta !== tb) return tb - ta;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return list;
  }, [instances, filter, folderFilter, query, sort]);

  const play = async (id: string) => {
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

  const stop = async (id: string) => {
    try {
      await api.killInstance(id);
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {t("instances.title")}
          </h1>
          <p className="mt-0.5 text-xs text-t3">
            {instances.length > 0
              ? t("instances.count", { n: instances.length })
              : t("instances.emptySubtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() => navigate({ page: "browse", projectType: "modpack" })}
          >
            {t("instances.modpacksBtn")}
          </button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="size-4" />
            {t("common.create")}
          </button>
        </div>
      </div>

      {instances.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
            <Box className="size-7" />
          </div>
          <div className="text-t3">{t("instances.empty")}</div>
          <button className="btn-primary mt-1" onClick={() => setShowCreate(true)}>
            <Plus className="size-4" />
            {t("instances.newInstance")}
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {(
                [
                  ["all", t("instances.filterAll"), counts.all],
                  ["modpacks", t("instances.filterModpacks"), counts.modpacks],
                  ["custom", t("instances.filterCustom"), counts.custom],
                ] as [InstanceFilter, string, number][]
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-all cursor-pointer ${
                    filter === key ? "tab-active" : "text-t3 hover:bg-accent-soft hover:text-t1"
                  }`}
                >
                  {label}
                  <span className="ml-1.5 text-xs text-t3">{count}</span>
                </button>
              ))}
            </div>
            <div className="relative ml-auto w-48 min-w-40 max-w-full flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-t3" />
              <input
                className="input-base !py-2 !pl-9"
                placeholder={t("instances.searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <SelectWrap>
              <select
                className="select-base !w-40 !py-2"
                value={sort}
                onChange={(e) => setSort(e.target.value as InstanceSort)}
              >
                <option value="recent">{t("instances.sortRecent")}</option>
                <option value="name">{t("instances.sortName")}</option>
                <option value="created">{t("instances.sortCreated")}</option>
              </select>
            </SelectWrap>
          </div>

          {folders.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setFolderFilter(null)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                  folderFilter === null
                    ? "bg-accent text-accent-fg"
                    : "border border-stroke-strong text-t2 hover:bg-bg-soft"
                }`}
              >
                {t("instances.allFolders")}
              </button>
              {folders.map((f) => (
                <button
                  key={f}
                  onClick={() => setFolderFilter(folderFilter === f ? null : f)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                    folderFilter === f
                      ? "bg-accent text-accent-fg"
                      : "border border-stroke-strong text-t2 hover:bg-bg-soft"
                  }`}
                >
                  <Folder className="size-3.5" />
                  {f}
                </button>
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 py-16 text-center text-t3">
              <Package className="size-7 opacity-50" />
              {t("instances.nothingFound")}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-4">
              {visible.map((inst) => (
                <InstanceCard
                  key={inst.id}
                  instance={inst}
                  status={statuses[inst.id]}
                  onOpen={() => navigate({ page: "instance", id: inst.id })}
                  onPlay={() => play(inst.id)}
                  onStop={() => stop(inst.id)}
                  onRename={() => setRenameFor(inst)}
                  onDelete={() => setDeleteFor(inst)}
                  onMoveToFolder={() => setMoveFor(inst)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateInstanceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => refreshInstances()}
        />
      )}
      {renameFor && (
        <RenameInstanceModal instance={renameFor} onClose={() => setRenameFor(null)} />
      )}
      {deleteFor && (
        <DeleteInstanceModal
          instance={deleteFor}
          onClose={() => setDeleteFor(null)}
          onDeleted={() => {}}
        />
      )}
      {moveFor && (
        <MoveToFolderModal
          instance={moveFor}
          folders={folders}
          onClose={() => setMoveFor(null)}
        />
      )}
    </div>
  );
}
