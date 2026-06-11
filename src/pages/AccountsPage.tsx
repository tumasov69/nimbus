import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Plus, Shirt, Trash2, User } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import { Field, Modal, Spinner } from "../components/ui";
import { errorText, useStore } from "../store";
import type { Account } from "../types";

export function AccountsPage() {
  const { t } = useTranslation();
  const { accounts, refreshAccounts, toast } = useStore();
  const [showOffline, setShowOffline] = useState(false);
  const [username, setUsername] = useState("");
  const [busyOffline, setBusyOffline] = useState(false);
  const [busyMs, setBusyMs] = useState(false);
  const [skinFor, setSkinFor] = useState<Account | null>(null);

  const addOffline = async () => {
    setBusyOffline(true);
    try {
      await api.addOfflineAccount(username);
      await refreshAccounts();
      setShowOffline(false);
      setUsername("");
      toast("success", t("accounts.added"));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusyOffline(false);
    }
  };

  const loginMs = async () => {
    setBusyMs(true);
    try {
      const account = await api.loginMicrosoft();
      await refreshAccounts();
      toast("success", t("accounts.loggedAs", { name: account.username }));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusyMs(false);
    }
  };

  return (
    <div className="animate-fade-up max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("accounts.title")}</h1>
      <p className="mt-1 text-sm text-t3">{t("accounts.subtitle")}</p>

      <div className="mt-6 flex gap-2">
        <button className="btn-primary" disabled={busyMs} onClick={loginMs}>
          {busyMs ? <Spinner /> : <Plus className="size-4" />}
          {t("accounts.msLogin")}
        </button>
        <button className="btn-secondary" onClick={() => setShowOffline(true)}>
          <User className="size-4" />
          {t("accounts.offlineAccount")}
        </button>
      </div>

      <div className="mt-5">
        {accounts.accounts.length === 0 ? (
          <div className="card py-14 text-center text-t3">{t("accounts.empty")}</div>
        ) : (
          <div className="card divide-y divide-stroke">
            {accounts.accounts.map((acc) => {
              const isActive = acc.id === accounts.active;
              return (
                <div key={acc.id} className="flex items-center gap-3 px-4 py-3.5">
                  <img
                    src={`https://mc-heads.net/avatar/${
                      acc.kind === "microsoft" ? acc.uuid : acc.username
                    }/48`}
                    alt=""
                    className="size-10 rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-t1">
                      {acc.username}
                    </div>
                    <div className="text-xs text-t3">
                      {acc.kind === "microsoft"
                        ? t("accounts.licensed")
                        : t("accounts.offline")}
                    </div>
                  </div>
                  {acc.kind === "microsoft" && (
                    <button
                      className="btn-ghost !p-2"
                      title={t("accounts.changeSkin")}
                      onClick={() => setSkinFor(acc)}
                    >
                      <Shirt className="size-4" />
                    </button>
                  )}
                  {isActive ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-success-soft px-2.5 py-1.5 text-xs font-medium text-success">
                      <Check className="size-3.5" /> {t("accounts.active")}
                    </span>
                  ) : (
                    <button
                      className="btn-ghost"
                      onClick={async () => {
                        await api.setActiveAccount(acc.id);
                        refreshAccounts();
                      }}
                    >
                      {t("accounts.choose")}
                    </button>
                  )}
                  <button
                    className="btn-ghost !p-2 hover:!bg-danger-soft hover:!text-danger"
                    onClick={async () => {
                      await api.removeAccount(acc.id);
                      refreshAccounts();
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

      {skinFor && (
        <SkinModal account={skinFor} onClose={() => setSkinFor(null)} />
      )}

      {showOffline && (
        <Modal title={t("accounts.offlineAccount")} onClose={() => setShowOffline(false)}>
          <div className="flex flex-col gap-4">
            <Field label={t("accounts.nick")}>
              <input
                className="input-base"
                placeholder="Steve"
                value={username}
                autoFocus
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && username.trim() && addOffline()}
              />
            </Field>
            <p className="text-xs text-t3">{t("accounts.nickRules")}</p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowOffline(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn-primary"
                disabled={!username.trim() || busyOffline}
                onClick={addOffline}
              >
                {busyOffline && <Spinner />}
                {t("common.create")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SkinModal({
  account,
  onClose,
}: {
  account: Account;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useStore();
  const [variant, setVariant] = useState<"classic" | "slim">("classic");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<{ path: string; preview: string } | null>(
    null,
  );

  const pickFile = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (typeof path !== "string") return;
    try {
      const preview = await api.readImagePreview(path);
      setPicked({ path, preview });
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  const upload = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await api.setSkin(account.id, picked.path, variant);
      toast("success", t("accounts.skinChanged"));
      onClose();
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("accounts.changeSkin")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-5">
          {/* Current skin */}
          <div className="text-center">
            <div className="mb-1 text-xs font-medium text-t3">
              {t("accounts.skinCurrent")}
            </div>
            <img
              src={`https://mc-heads.net/body/${account.uuid}/100`}
              alt=""
              className="h-40 object-contain"
            />
          </div>

          {/* New skin preview (pixelated texture) */}
          {picked && (
            <div className="text-center">
              <div className="mb-1 text-xs font-medium text-t3">
                {t("accounts.skinNew")}
              </div>
              <img
                src={picked.preview}
                alt=""
                className="h-40 w-40 rounded-lg border border-stroke object-contain bg-bg-soft"
                style={{ imageRendering: "pixelated" }}
              />
            </div>
          )}

          <div className="flex-1">
            <div className="mb-1.5 text-sm font-medium text-t2">
              {t("accounts.skinModel")}
            </div>
            <div className="flex gap-1.5">
              {(["classic", "slim"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVariant(v)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all cursor-pointer ${
                    variant === v
                      ? "border-accent bg-accent-soft text-accent-text"
                      : "border-stroke-strong text-t3 hover:text-t1"
                  }`}
                >
                  {v === "classic" ? t("accounts.skinClassic") : t("accounts.skinSlim")}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-t3">{t("accounts.skinHint")}</p>
            <button
              className="mt-2 text-xs font-medium text-accent-text hover:underline cursor-pointer"
              onClick={() => openUrl("https://ru.namemc.com/minecraft-skins").catch(() => {})}
            >
              {t("accounts.skinBrowse")} ↗
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn-secondary" onClick={pickFile}>
            {t("accounts.skinUpload")}
          </button>
          <button className="btn-primary" disabled={!picked || busy} onClick={upload}>
            {busy ? <Spinner /> : <Shirt className="size-4" />}
            {t("accounts.skinApply")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
