import { Box, Play, Rocket, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import {
  LoaderBadge,
  ProgressBar,
  SelectWrap,
  Spinner,
  formatRelativeDate,
} from "../components/ui";
import type { Route } from "../routes";
import { errorText, useStore } from "../store";
import type { Instance, McVersion } from "../types";

export function HomePage({ navigate }: { navigate: (r: Route) => void }) {
  const { t } = useTranslation();
  const {
    instances,
    accounts,
    statuses,
    refreshInstances,
    refreshAccounts,
    toast,
  } = useStore();

  const [versions, setVersions] = useState<McVersion[]>([]);
  const [mcVersion, setMcVersion] = useState("");
  const [nick, setNick] = useState("");
  const [launching, setLaunching] = useState(false);

  const activeAccount = accounts.accounts.find((a) => a.id === accounts.active);

  useEffect(() => {
    api
      .getMinecraftVersions()
      .then((v) => {
        setVersions(v.filter((x) => x.type === "release"));
        const first = v.find((x) => x.type === "release");
        if (first) setMcVersion(first.id);
      })
      .catch(() => {});
  }, []);

  const quickInstance = useMemo(
    () =>
      instances.find(
        (i) => i.quick && i.loader === "vanilla" && i.mcVersion === mcVersion,
      ),
    [instances, mcVersion],
  );
  const quickStatus = quickInstance ? statuses[quickInstance.id] : undefined;
  const quickBusy =
    launching ||
    (quickStatus &&
      ["preparing", "installing", "launching"].includes(quickStatus.state));
  const quickRunning = quickStatus?.state === "running";

  const lastPlayed = useMemo(() => {
    const played = instances.filter((i) => i.lastPlayed);
    played.sort(
      (a, b) =>
        new Date(b.lastPlayed!).getTime() - new Date(a.lastPlayed!).getTime(),
    );
    return played[0] ?? null;
  }, [instances]);

  const recent = useMemo(() => {
    const list = [...instances];
    list.sort((a, b) => {
      const ta = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
      const tb = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
      return tb - ta;
    });
    return list.slice(0, 4);
  }, [instances]);

  const quickPlay = async () => {
    setLaunching(true);
    try {
      if (!activeAccount) {
        if (!nick.trim()) {
          toast("info", t("accounts.accountFirst"));
          return;
        }
        await api.addOfflineAccount(nick);
        await refreshAccounts();
      }
      let instance = quickInstance;
      if (!instance) {
        instance = await api.createInstance(
          `Minecraft ${mcVersion}`,
          mcVersion,
          "vanilla",
          null,
          true,
        );
        await refreshInstances();
      }
      await api.launchInstance(instance.id);
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setLaunching(false);
    }
  };

  const playInstance = async (instance: Instance) => {
    if (!accounts.active) {
      toast("info", t("accounts.accountFirst"));
      navigate({ page: "accounts" });
      return;
    }
    try {
      await api.launchInstance(instance.id);
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  const progress = quickStatus?.progress;

  return (
    <div className="animate-fade-up flex flex-col gap-5">
      {/* Hero / quick play */}
      <div className="card relative overflow-hidden p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-accent-soft" />

        <div className="flex items-center gap-2 text-sm font-medium text-accent-text">
          <Rocket className="size-4" />
          {t("home.quickPlay")}
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
          {t("home.quickPlayDesc")}
        </h1>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div className="w-44">
            <span className="mb-1.5 block text-xs font-medium text-t3">
              {t("home.version")}
            </span>
            <SelectWrap>
              <select
                className="select-base"
                value={mcVersion}
                onChange={(e) => setMcVersion(e.target.value)}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>

          {!activeAccount && (
            <div className="w-52">
              <span className="mb-1.5 block text-xs font-medium text-t3">
                {t("home.nickname")}
              </span>
              <input
                className="input-base"
                placeholder="Steve"
                value={nick}
                onChange={(e) => setNick(e.target.value)}
              />
            </div>
          )}

          <button
            className="btn-primary h-[42px] !px-7"
            disabled={quickBusy || quickRunning || !mcVersion}
            onClick={quickPlay}
          >
            {quickBusy ? <Spinner /> : <Play className="size-4 fill-current" />}
            {quickRunning
              ? t("status.running")
              : quickStatus?.state === "installing"
                ? t("status.installing")
                : quickStatus?.state === "launching"
                  ? t("status.launching")
                  : t("home.playNow")}
          </button>
        </div>

        {!activeAccount && (
          <div className="mt-3 text-xs text-t3">{t("home.noAccountHint")}</div>
        )}

        {quickBusy && progress && (
          <div className="mt-4 max-w-md">
            <ProgressBar value={progress.current / Math.max(1, progress.total)} />
          </div>
        )}
      </div>

      {/* Continue playing */}
      {lastPlayed && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-t3">
            {t("home.continueTitle")}
          </h2>
          <ContinueCard
            instance={lastPlayed}
            running={statuses[lastPlayed.id]?.state === "running"}
            busy={["preparing", "installing", "launching"].includes(
              statuses[lastPlayed.id]?.state ?? "",
            )}
            onOpen={() => navigate({ page: "instance", id: lastPlayed.id })}
            onPlay={() => playInstance(lastPlayed)}
            onStop={() => api.killInstance(lastPlayed.id).catch(() => {})}
          />
        </div>
      )}

      {/* Recent instances */}
      {recent.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-t3">
            {t("home.recent")}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {recent.map((inst) => (
              <button
                key={inst.id}
                onClick={() => navigate({ page: "instance", id: inst.id })}
                className="card flex items-center gap-3 p-3.5 text-left transition-all hover:bg-card-hover hover:-translate-y-0.5 cursor-pointer"
              >
                {inst.iconUrl ? (
                  <img src={inst.iconUrl} alt="" className="size-10 rounded-lg object-cover" />
                ) : (
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                    <Box className="size-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-t1">
                    {inst.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-t3">
                    <LoaderBadge loader={inst.loader} />
                    {inst.mcVersion}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ContinueCard({
  instance,
  running,
  busy,
  onOpen,
  onPlay,
  onStop,
}: {
  instance: Instance;
  running: boolean;
  busy: boolean;
  onOpen: () => void;
  onPlay: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onOpen}
      className="card group flex cursor-pointer items-center gap-4 p-4 transition-all hover:bg-card-hover"
    >
      {instance.iconUrl ? (
        <img src={instance.iconUrl} alt="" className="size-14 rounded-xl object-cover" />
      ) : (
        <div className="flex size-14 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
          <Box className="size-7" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium tracking-tight text-t1">
          {instance.name}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-t3">
          <LoaderBadge loader={instance.loader} />
          <span>{instance.mcVersion}</span>
          <span>
            · {t("instances.lastPlayed")}: {formatRelativeDate(instance.lastPlayed)}
          </span>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          running ? onStop() : onPlay();
        }}
        disabled={busy}
        className={running ? "btn-danger" : "btn-primary"}
      >
        {busy ? (
          <Spinner />
        ) : running ? (
          <>
            <Square className="size-4 fill-current" /> {t("common.stop")}
          </>
        ) : (
          <>
            <Play className="size-4 fill-current" /> {t("common.play")}
          </>
        )}
      </button>
    </div>
  );
}
