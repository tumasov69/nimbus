import { getVersion } from "@tauri-apps/api/app";
import { Compass, Home, LayoutGrid, Settings, Users } from "lucide-react";
import logo from "../assets/logo.png";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../store";
import type { Route } from "../routes";

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
}: {
  route: Route;
  navigate: (r: Route) => void;
}) {
  const { t } = useTranslation();
  const { accounts } = useStore();
  const active = accounts.accounts.find((a) => a.id === accounts.active);
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const currentPage =
    route.page === "instance"
      ? "instances"
      : route.page === "project"
        ? "browse"
        : route.page;

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 p-4">
      <div className="mb-5 flex items-center gap-2.5 px-2 pt-1">
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

      <nav className="flex flex-col gap-1">
        {NAV.map(({ page, key, icon: Icon }) => (
          <button
            key={page}
            onClick={() => navigate({ page } as Route)}
            className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all cursor-pointer ${
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

      <div className="mt-auto">
        {active ? (
          <button
            onClick={() => navigate({ page: "accounts" })}
            className="card flex w-full items-center gap-3 p-3 text-left transition-all hover:bg-card-hover cursor-pointer"
          >
            <img
              src={`https://mc-heads.net/avatar/${
                active.kind === "microsoft" ? active.uuid : active.username
              }/40`}
              alt=""
              className="size-9 rounded-lg"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-t1">
                {active.username}
              </div>
              <div className="text-[11px] text-t3">
                {active.kind === "microsoft"
                  ? t("accounts.licensed")
                  : t("accounts.offline")}
              </div>
            </div>
          </button>
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
