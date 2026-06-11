import { Plus, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import { errorText, useStore } from "../store";
import { Field, Modal, Spinner } from "./ui";

export function ServersTab({ id }: { id: string }) {
  const { t } = useTranslation();
  const { toast } = useStore();
  const [servers, setServers] = useState<api.ServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setServers(await api.listServers(id));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    setSaving(true);
    try {
      setServers(await api.addServer(id, name, ip));
      setShowAdd(false);
      setName("");
      setIp("");
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (index: number) => {
    try {
      setServers(await api.removeServer(id, index));
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          <Plus className="size-4" /> {t("servers.add")}
        </button>
      </div>

      {loading ? (
        <div className="card flex items-center justify-center gap-2 py-12 text-t3">
          <Spinner /> {t("common.loading")}
        </div>
      ) : servers.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center text-t3">
          <Server className="size-7 opacity-50" />
          {t("servers.empty")}
        </div>
      ) : (
        <div className="card divide-y divide-stroke">
          {servers.map((server, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              {server.icon ? (
                <img
                  src={`data:image/png;base64,${server.icon}`}
                  alt=""
                  className="size-9 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                  <Server className="size-4.5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-t1">{server.name}</div>
                <div className="truncate text-xs text-t3">{server.ip}</div>
              </div>
              <button
                className="btn-ghost !p-2 hover:!bg-danger-soft hover:!text-danger"
                title={t("common.delete")}
                onClick={() => remove(i)}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <Modal title={t("servers.add")} onClose={() => setShowAdd(false)}>
          <div className="flex flex-col gap-4">
            <Field label={t("servers.name")}>
              <input
                className="input-base"
                placeholder="Hypixel"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label={t("servers.address")}>
              <input
                className="input-base"
                placeholder="mc.hypixel.net"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowAdd(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn-primary"
                disabled={!name.trim() || !ip.trim() || saving}
                onClick={add}
              >
                {saving && <Spinner />}
                {t("common.create")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
