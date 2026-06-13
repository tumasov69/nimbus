import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ArrowDownToLine } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import logo from "./assets/logo.png";
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

function UpdatePill() {
  const { t } = useTranslation();
  const { appUpdate, updateInstalling, forcedUpdate, installAppUpdate } = useStore();
  if (!appUpdate || forcedUpdate) return null;
  return (
    <button
      className="btn-primary fixed right-5 top-4 z-40 !rounded-full !px-4 !py-2 text-xs shadow-lg animate-fade-up"
      disabled={updateInstalling}
      onClick={installAppUpdate}
      title={t("settings.updateInstall")}
    >
      {updateInstalling ? (
        <Spinner className="size-3.5" />
      ) : (
        <ArrowDownToLine className="size-3.5" />
      )}
      {t("settings.updateAvailable", { v: appUpdate.version })}
    </button>
  );
}

function Shell() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<Route>({ page: "home" });
  const { instances, accounts, settings, refreshInstances, toast } = useStore();
  const [onboarded, setOnboarded] = useState(false);
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

  // Drag & drop a .mrpack onto the window to import it.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const file = event.payload.paths.find((p) =>
        p.toLowerCase().endsWith(".mrpack"),
      );
      if (!file) return;
      toast("info", t("settings.importTitle"));
      api
        .importMrpack(file)
        .then(() => {
          refreshInstances();
          toast("success", t("settings.importDone"));
          setRoute({ page: "instances" });
        })
        .catch((e) => toast("error", errorText(e)));
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [refreshInstances, toast]);

  return (
    <div className="flex h-full">
      {showOnboarding && <Onboarding onDone={completeOnboarding} />}
      <ForcedUpdateOverlay />
      <Sidebar route={route} navigate={setRoute} />
      <UpdatePill />
      <main className="min-w-0 flex-1 overflow-y-auto px-5 py-4 pl-1">
        <div className="h-full">
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
