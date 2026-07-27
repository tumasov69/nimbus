import { getVersion } from "@tauri-apps/api/app";
import {
  ArrowDownToLine,
  Check,
  ChevronsUpDown,
  Compass,
  Home,
  LayoutGrid,
  Search,
  Settings,
  Users,
} from "lucide-react";
import logo from "../assets/logo.png";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import { errorText, useStore } from "../store";
import type { Route } from "../routes";
import { ProgressBar, Spinner } from "./ui";

const NAV = [
  { page: "home", key: "nav.home", icon: Home },
  { page: "instances", key: "nav.instances", icon: LayoutGrid },
  { page: "browse", key: "nav.browse", icon: Compass },
  { page: "accounts", key: "nav.accounts", icon: Users },
  { page: "settings", key: "nav.settings", icon: Settings },
] as const;

export function Sidebar({
  route,
  navigate,
  onOpenPalette,
}: {
  route: Route;
  navigate: (r: Route) => void;
  onOpenPalette: () => void;
}) {
  const { t } = useTranslation();
  const {
    accounts,
    refreshAccounts,
    toast,
    instances,
    statuses,
    appUpdate,
    updateInstalling,
    forcedUpdate,
    installAppUpdate,
  } = useStore();
  const active = accounts.accounts.find((a) => a.id === accounts.active);

  // Work in progress belongs in the chrome, not only on the page that started
  // it: the sidebar is visible everywhere, and its lower half was empty.
  const activeJob = (() => {
    for (const [id, status] of Object.entries(statuses)) {
      if (!["preparing", "installing", "launching"].includes(status.state)) continue;
      const instance = instances.find((i) => i.id === id);
      if (!instance) continue;
      const value = status.packProgress
        ? status.packProgress.current / Math.max(1, status.packProgress.total)
        : status.progress
          ? status.progress.current / Math.max(1, status.progress.total)
          : null;
      return { id, name: instance.name, state: status.state, value };
    }
    return null;
  })();
  const [version, setVersion] = useState("");
  const [accOpen, setAccOpen] = useState(false);
  const accRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // Close the account switcher on outside click.
  useEffect(() => {
    if (!accOpen) return;
    const close = (e: MouseEvent) => {
      if (!accRef.current?.contains(e.target as Node)) setAccOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [accOpen]);

  // The switcher only renders with >1 account — don't leave it stuck "open".
  useEffect(() => {
    if (accounts.accounts.length <= 1) setAccOpen(false);
  }, [accounts.accounts.length]);

  const switchTo = async (id: string) => {
    setAccOpen(false);
    if (id === accounts.active) return;
    try {
      await api.setActiveAccount(id);
      await refreshAccounts();
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  const headUrl = (a: { kind: string; uuid: string; username: string }, size: number) =>
    `https://mc-heads.net/avatar/${encodeURIComponent(a.kind === "microsoft" ? a.uuid : a.username)}/${size}`;

  const currentPage =
    route.page === "instance"
      ? "instances"
      : route.page === "project"
        ? "browse"
        : route.page;

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-0.5 p-3">
      <div className="mb-3 flex items-center gap-2.5 px-2 pt-1">
        <img src={logo} alt="Nimbus" className="size-9 rounded-lg shadow-sm" />
        <div>
          <div className="text-base font-bold tracking-tight leading-none text-hero">
            Nimbus
          </div>
          <div className="mt-1 text-[11px] text-t3 leading-none">
            Minecraft Launcher
          </div>
        </div>
      </div>

      <button
        onClick={onOpenPalette}
        title="Ctrl K"
        className="mb-2 flex items-center gap-2 rounded-lg border border-stroke-strong bg-card px-3 py-2 text-sm text-t3 transition-colors hover:text-t1 cursor-pointer"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">{t("palette.search")}</span>
        <kbd className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px] font-medium text-t3">
          Ctrl K
        </kbd>
      </button>

      <nav className="flex flex-col gap-1">
        {NAV.map(({ page, key, icon: Icon }) => (
          <button
            key={page}
            onClick={() => navigate({ page } as Route)}
            className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all cursor-pointer ${
              currentPage === page
                ? "tab-active"
                : "text-t3 hover:bg-accent-soft hover:text-t1"
            }`}
          >
            {/* Fluent-style active indicator */}
            {currentPage === page && (
              <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
            )}
            <Icon className="size-[18px]" />
            {t(key)}
          </button>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        {/* Live install/launch progress, visible from any page. */}
        {activeJob && (
          <button
            onClick={() => navigate({ page: "instance", id: activeJob.id })}
            className="card w-full p-3 text-left transition-all hover:bg-card-hover cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Spinner className="size-3.5 shrink-0 text-accent-text" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-t1">
                {activeJob.name}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-t3">
              {t(`status.${activeJob.state}`)}
            </div>
            {activeJob.value !== null && (
              <ProgressBar value={activeJob.value} className="mt-2 !h-1" />
            )}
          </button>
        )}

        {/* Update prompt lives in the chrome instead of floating over content. */}
        {appUpdate && !forcedUpdate && (
          <button
            onClick={installAppUpdate}
            disabled={updateInstalling}
            className="card card-action w-full py-2.5 pl-4 pr-3 text-left transition-all hover:bg-card-hover cursor-pointer disabled:opacity-60"
          >
            <div className="flex items-center gap-2">
              {updateInstalling ? (
                <Spinner className="size-3.5 shrink-0 text-accent-text" />
              ) : (
                <ArrowDownToLine className="size-3.5 shrink-0 text-accent-text" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-t1">
                {t("settings.updateAvailable", { v: appUpdate.version })}
              </span>
            </div>
            <div className="mt-0.5 pl-5.5 text-[11px] text-t3">
              {updateInstalling
                ? t("settings.updateDownloading")
                : t("settings.updateInstall")}
            </div>
          </button>
        )}

        {active ? (
          <div ref={accRef} className="relative">
            {/* Upward-opening switcher menu (only with >1 account) */}
            {accOpen && accounts.accounts.length > 1 && (
              <div
                className="card popover absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto !rounded-xl p-1 animate-modal-in"
                style={{ boxShadow: "var(--shadow-lg)" }}
              >
                {accounts.accounts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => switchTo(a.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent-soft cursor-pointer"
                  >
                    <img src={headUrl(a, 28)} alt="" loading="lazy" decoding="async" className="size-7 rounded" />
                    <span className="min-w-0 flex-1 truncate text-t2">
                      {a.username}
                    </span>
                    {a.id === accounts.active && (
                      <Check className="size-4 shrink-0 text-accent-text" />
                    )}
                  </button>
                ))}
                <div className="my-1 h-px bg-stroke" />
                <button
                  onClick={() => {
                    setAccOpen(false);
                    navigate({ page: "accounts" });
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-t2 transition-colors hover:bg-accent-soft cursor-pointer"
                >
                  <Users className="size-4" /> {t("nav.accounts")}
                </button>
              </div>
            )}
            <button
              onClick={() =>
                accounts.accounts.length > 1
                  ? setAccOpen((o) => !o)
                  : navigate({ page: "accounts" })
              }
              className="card flex w-full items-center gap-3 p-3 text-left transition-all hover:bg-card-hover cursor-pointer"
            >
              <img src={headUrl(active, 40)} alt="" className="size-9 rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-t1">
                  {active.username}
                </div>
                <div className="text-[11px] text-t3">
                  {active.kind === "microsoft"
                    ? t("accounts.licensed")
                    : t("accounts.offline")}
                </div>
              </div>
              {accounts.accounts.length > 1 && (
                <ChevronsUpDown className="size-4 shrink-0 text-t3" />
              )}
            </button>
          </div>
        ) : (
          <button
            onClick={() => navigate({ page: "accounts" })}
            className="btn-secondary w-full"
          >
            {t("nav.signIn")}
          </button>
        )}
        {version && (
          <div className="mt-2 px-2 text-center text-[10px] text-t3">
            Nimbus v{version}
          </div>
        )}
      </div>
    </aside>
  );
}
