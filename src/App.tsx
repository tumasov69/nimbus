import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { Download, WifiOff } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import logo from "./assets/logo.png";
import { CommandPalette } from "./components/CommandPalette";
import { Onboarding } from "./components/Onboarding";
import { Sidebar } from "./components/Sidebar";
import { Spinner, Toasts } from "./components/ui";
import * as api from "./api";
import { errorText, useStore } from "./store";
import { AccountsPage } from "./pages/AccountsPage";
import { BrowsePage } from "./pages/BrowsePage";
import { HomePage } from "./pages/HomePage";
import { InstancePage } from "./pages/InstancePage";
import { InstancesPage } from "./pages/InstancesPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { Route } from "./routes";
import { StoreProvider } from "./store";
import "./i18n";

// Markdown renderer is heavy — load the project page on demand.
const ProjectPage = lazy(() =>
  import("./pages/ProjectPage").then((m) => ({ default: m.ProjectPage })),
);

function ForcedUpdateOverlay() {
  const { t } = useTranslation();
  const { forcedUpdate, appUpdate } = useStore();
  if (!forcedUpdate) return null;
  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-bg/95 backdrop-blur">
      <img src={logo} alt="" className="size-16 rounded-2xl shadow-lg" />
      <Spinner className="size-6" />
      <div className="text-center">
        <div className="text-base font-semibold text-t1">
          {t("settings.updateDownloading")}
        </div>
        {appUpdate && (
          <div className="mt-1 text-sm text-t3">
            {t("settings.updateAvailable", { v: appUpdate.version })}
          </div>
        )}
      </div>
    </div>
  );
}

// The update prompt now lives in the sidebar (see Sidebar.tsx) so nothing
// floats over page content.

function Shell() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<Route>({ page: "home" });
  const { instances, accounts, settings, refreshInstances, toast } = useStore();
  const [onboarded, setOnboarded] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const onboardingSeen = useRef(false);

  // First run: no accounts and no instances → show the wizard once ever
  // (persisted, so skipping it doesn't bring it back next launch).
  const showOnboarding =
    !onboarded &&
    !onboardingSeen.current &&
    !localStorage.getItem("nimbus.onboarded") &&
    !!settings &&
    accounts.accounts.length === 0 &&
    instances.length === 0;
  if (showOnboarding) onboardingSeen.current = true;

  const completeOnboarding = () => {
    localStorage.setItem("nimbus.onboarded", "1");
    setOnboarded(true);
  };

  // Drag & drop: a .mrpack imports as a new instance, .jar/.zip files install
  // into the instance that is currently open.
  const openInstanceId = route.page === "instance" ? route.id : null;
  const openInstance = instances.find((i) => i.id === openInstanceId);
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDragging(true);
        return;
      }
      if (event.payload.type !== "drop") {
        setDragging(false);
        return;
      }
      setDragging(false);
      const paths = event.payload.paths;
      const pack = paths.find((p) => p.toLowerCase().endsWith(".mrpack"));
      if (pack) {
        toast("info", t("settings.importTitle"));
        api
          .importMrpack(pack)
          .then(() => {
            refreshInstances();
            toast("success", t("settings.importDone"));
            setRoute({ page: "instances" });
          })
          .catch((e) => toast("error", errorText(e)));
        return;
      }
      const content = paths.filter(
        (p) => p.toLowerCase().endsWith(".jar") || p.toLowerCase().endsWith(".zip"),
      );
      if (content.length === 0 || !openInstanceId) return;
      // Vanilla instances can't load mods — their content folder is resourcepacks.
      const folder = openInstance?.loader === "vanilla" ? "resourcepacks" : "mods";
      api
        .installLocalMods(openInstanceId, content, folder)
        .then((installed) => {
          toast("success", t("tools.filesInstalled", { n: installed.length }));
          api.invalidateEnrich(openInstanceId);
          // The instance page reloads its list on this event.
          window.dispatchEvent(new CustomEvent("nimbus:mods-changed"));
        })
        .catch((e) => toast("error", errorText(e)));
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [refreshInstances, toast, t, openInstanceId, openInstance?.loader]);

  // Desktop shortcuts start the app with `--launch <id>`; a second launch
  // forwards the same request as an event to the running window.
  useEffect(() => {
    const play = (id: string) => {
      setRoute({ page: "instance", id });
      api.launchInstance(id).catch((e) => toast("error", errorText(e)));
    };
    api
      .takePendingLaunch()
      .then((id) => id && play(id))
      .catch(() => {});
    const unlisten = listen<string>("launch-request", (e) => play(e.payload));
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [toast]);

  // Offline is a state worth naming: without it the catalog just throws.
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Ctrl/⌘+K toggles the command palette. Match on e.code (physical key) so it
  // works regardless of keyboard layout — e.key would be "л" on a Cyrillic layout.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyK") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full">
      {showOnboarding && <Onboarding onDone={completeOnboarding} />}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          navigate={setRoute}
        />
      )}
      <ForcedUpdateOverlay />
      <Sidebar
        route={route}
        navigate={setRoute}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      {/* Drop target hint — only meaningful where a drop does something. */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[65] flex items-center justify-center bg-accent-soft/60 backdrop-blur-[2px]">
          <div className="card popover flex items-center gap-3 px-6 py-4 text-sm font-medium text-t1">
            <Download className="size-5 text-accent-text" />
            {route.page === "instance"
              ? t("tools.dropHere")
              : t("settings.importDesc")}
          </div>
        </div>
      )}
      <main className="min-w-0 flex-1 overflow-y-auto px-5 py-4 pl-1">
        <div className="h-full">
          {offline && (
            <div className="card card-action mb-3 flex items-center gap-3 py-3 pl-4 pr-4">
              <WifiOff className="size-4 shrink-0 text-accent-text" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-t1">
                  {t("tools.offlineTitle")}
                </div>
                <div className="text-xs text-t3">{t("tools.offlineDesc")}</div>
              </div>
            </div>
          )}
          {route.page === "home" && <HomePage navigate={setRoute} />}
          {route.page === "instances" && <InstancesPage navigate={setRoute} />}
          {route.page === "instance" && (
            <InstancePage key={route.id} id={route.id} navigate={setRoute} />
          )}
          {route.page === "browse" && (
            <BrowsePage
              key={`${route.projectType ?? "modpack"}-${route.instanceId ?? ""}`}
              navigate={setRoute}
              initialType={route.projectType}
              instanceId={route.instanceId}
            />
          )}
          {route.page === "project" && (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-t3">
                  <Spinner />
                </div>
              }
            >
              <ProjectPage
                key={route.projectId}
                projectId={route.projectId}
                projectType={route.projectType}
                instanceId={route.instanceId}
                navigate={setRoute}
              />
            </Suspense>
          )}
          {route.page === "accounts" && <AccountsPage />}
          {route.page === "settings" && <SettingsPage />}
        </div>
      </main>
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
