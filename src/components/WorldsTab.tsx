import { save } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Globe, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import { errorText, useStore } from "../store";
import { Modal, Spinner, formatBytes, formatRelativeDate } from "./ui";

export function WorldsTab({ id }: { id: string }) {
  const { t } = useTranslation();
  const { toast } = useStore();
  const [worlds, setWorlds] = useState<api.WorldInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<api.WorldInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWorlds(await api.listWorlds(id));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const backup = async (folder: string) => {
    const path = await save({
      defaultPath: `${folder}.zip`,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (!path) return;
    setBusy(folder);
    try {
      await api.backupWorld(id, folder, path);
      toast("success", t("worlds.backupDone"));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusy(null);
    }
  };

  // A world folder is deleted outright (not moved to the recycle bin), so
  // losing one is unrecoverable — always confirm first.
  const remove = async (folder: string) => {
    setConfirmDelete(null);
    setBusy(folder);
    try {
      await api.deleteWorld(id, folder);
      await load();
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="card flex items-center justify-center gap-2 py-12 text-t3">
        <Spinner /> {t("common.loading")}
      </div>
    );
  }
  if (worlds.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 py-12 text-center text-t3">
        <Globe className="size-7 opacity-50" />
        {t("worlds.empty")}
      </div>
    );
  }

  return (
    <>
    <div className="card divide-y divide-stroke">
      {worlds.map((world) => (
        <div key={world.folder} className="flex items-center gap-3 px-4 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
            <Globe className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-t1">{world.name}</div>
            <div className="text-xs text-t3">
              {formatBytes(world.sizeBytes)}
              {world.lastPlayed
                ? ` · ${formatRelativeDate(new Date(world.lastPlayed).toISOString())}`
                : ""}
            </div>
          </div>
          <button
            className="btn-ghost !p-2"
            title={t("worlds.backup")}
            disabled={busy === world.folder}
            onClick={() => backup(world.folder)}
          >
            {busy === world.folder ? <Spinner className="size-4" /> : <Download className="size-4" />}
          </button>
          <button
            className="btn-ghost !p-2"
            title={t("instances.openFolder")}
            onClick={() => api.openWorldFolder(id, world.folder).catch(() => {})}
          >
            <FolderOpen className="size-4" />
          </button>
          <button
            className="btn-ghost !p-2 hover:!bg-danger-soft hover:!text-danger"
            title={t("common.delete")}
            disabled={busy === world.folder}
            onClick={() => setConfirmDelete(world)}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
    </div>

    {confirmDelete && (
      <Modal
        title={t("worlds.deleteTitle")}
        onClose={() => setConfirmDelete(null)}
        width="max-w-md"
      >
        <p className="text-sm text-t2">
          {t("worlds.deleteWarn", { name: confirmDelete.name })}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>
            {t("common.cancel")}
          </button>
          <button
            className="btn-danger"
            onClick={() => remove(confirmDelete.folder)}
          >
            <Trash2 className="size-4" /> {t("common.delete")}
          </button>
        </div>
      </Modal>
    )}
    </>
  );
}
