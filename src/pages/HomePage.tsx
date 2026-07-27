import {
  ArrowDownToLine,
  Box,
  Clock,
  Compass,
  Download,
  Package,
  Play,
  Rocket,
  Square,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import {
  InstanceIcon,
  LOADER_GRADIENTS,
  LoaderBadge,
  ProgressBar,
  SelectWrap,
  Skeleton,
  Spinner,
  formatDownloads,
  formatPlaytime,
  formatRelativeDate,
  instanceIconSrc,
} from "../components/ui";
import type { Route } from "../routes";
import { errorText, useStore, type InstanceStatus } from "../store";
import type { Instance, McVersion, SearchHit } from "../types";

// Cache popular modpacks for the session so Home loads instantly on revisits.
let popularCache: SearchHit[] | null = null;

interface UpdateEntry {
  inst: Instance;
  packVersion?: string;
  modCount: number;
}

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
  const [popular, setPopular] = useState<SearchHit[]>(popularCache ?? []);
  const [popularLoading, setPopularLoading] = useState(!popularCache);
  const [updates, setUpdates] = useState<UpdateEntry[]>([]);

  const activeAccount = accounts.accounts.find((a) => a.id === accounts.active);

  // "What's new": instances with an available modpack and/or mod updates.
  // Runs in the background (enrichment is cached), re-checks when the set of
  // instances changes — not on every refresh.
  const instanceIds = instances.map((i) => i.id).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const check = async (inst: Instance): Promise<UpdateEntry | null> => {
        let packVersion: string | undefined;
        if (inst.modpack) {
          try {
            const u = await api.checkModpackUpdate(inst.id);
            if (u) packVersion = u.versionNumber;
          } catch {
            /* ignore */
          }
        }
        let modCount = 0;
        try {
          const mods = await api.modrinthEnrichMods(inst.id);
          modCount = mods.filter((m) => m.updateVersionId).length;
        } catch {
          /* ignore */
        }
        return packVersion || modCount > 0 ? { inst, packVersion, modCount } : null;
      };

      // Enrichment hashes every jar of an instance — running all of them at
      // once would spike CPU and disk right when Home opens. Two at a time.
      const queue = [...instances];
      const found: UpdateEntry[] = [];
      const worker = async () => {
        for (;;) {
          const inst = queue.shift();
          if (!inst || cancelled) return;
          const entry = await check(inst);
          if (entry) found.push(entry);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(2, instances.length) }, worker),
      );
      if (!cancelled) {
        // Keep the original instance order regardless of completion order.
        const order = new Map(instances.map((i, idx) => [i.id, idx]));
        found.sort((a, b) => (order.get(a.inst.id) ?? 0) - (order.get(b.inst.id) ?? 0));
        setUpdates(found);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceIds]);

  // Discovery: most-downloaded modpacks from Modrinth (cached for the session).
  useEffect(() => {
    if (popularCache) return;
    api
      .modrinthSearch({
        query: "",
        projectType: "modpack",
        offset: 0,
        limit: 10,
        index: "downloads",
      })
      .then((r) => {
        popularCache = r.hits;
        setPopular(r.hits);
      })
      .catch(() => {})
      .finally(() => setPopularLoading(false));
  }, []);

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

  // Who is looking at this screen decides what dominates it. A returning
  // player wants the instance they were in — quick play is then a compact
  // strip. A first-run user has nothing to continue, so quick play keeps the
  // full hero treatment.
  const showQuickHero = !lastPlayed || !activeAccount;

  return (
    <div className="animate-fade-up flex flex-col gap-5">
      {/* Continue playing — the dominant block for a returning player. */}
      {lastPlayed && (
        <ContinueCard
          instance={lastPlayed}
          status={statuses[lastPlayed.id]}
          onOpen={() => navigate({ page: "instance", id: lastPlayed.id })}
          onPlay={() => playInstance(lastPlayed)}
          onStop={() => api.killInstance(lastPlayed.id).catch(() => {})}
        />
      )}

      {/* Quick play — compact once there is something to continue. */}
      {!showQuickHero && (
        <div className="card flex flex-wrap items-center gap-3 p-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
            <Rocket className="size-4.5" />
          </span>
          <div className="mr-auto min-w-0">
            <div className="text-sm font-medium text-t1">{t("home.quickPlay")}</div>
            <div className="truncate text-xs text-t3">{t("home.quickPlayDesc")}</div>
          </div>
          <div className="w-32">
            <SelectWrap>
              <select
                className="select-base !py-2 !text-[13px]"
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
          <button
            className="btn-secondary !py-2"
            disabled={quickBusy || quickRunning || !mcVersion}
            onClick={quickPlay}
          >
            {quickBusy ? <Spinner /> : <Play className="size-4 fill-current" />}
            {quickRunning ? t("status.running") : t("home.playNow")}
          </button>
          {quickBusy && progress && (
            <div className="w-full">
              <ProgressBar value={progress.current / Math.max(1, progress.total)} />
            </div>
          )}
        </div>
      )}

      {/* Hero / quick play */}
      {showQuickHero && (
      <div
        className="relative overflow-hidden rounded-xl border border-stroke px-5 py-4"
        style={{
          background:
            "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 135%)",
        }}
      >
        {/* Brand clouds — subtle, top-right only */}
        <span className="cloud animate-drift" style={{ width: 120, height: 30, right: "5%", top: "16%" }} />
        <span className="cloud" style={{ width: 60, height: 18, right: "20%", bottom: "18%" }} />

        <div className="relative flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
              <Rocket className="size-3.5" />
              {t("home.quickPlay")}
            </div>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-white">
              {t("home.quickPlayDesc")}
            </h1>
          </div>
          <div className="w-44">
            <span className="mb-1.5 block text-xs font-medium text-white/70">
              {t("home.version")}
            </span>
            <SelectWrap>
              <select
                className="select-base !border-white/25 !bg-white/15 !text-white backdrop-blur"
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
              <span className="mb-1.5 block text-xs font-medium text-white/70">
                {t("home.nickname")}
              </span>
              <input
                className="input-base !border-white/25 !bg-white/15 !text-white placeholder-white/50 backdrop-blur"
                placeholder="Steve"
                value={nick}
                onChange={(e) => setNick(e.target.value)}
              />
            </div>
          )}

          <button
            className="inline-flex h-[42px] items-center gap-2 rounded-lg bg-white px-6 text-sm font-bold text-indigo-600 shadow-lg transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-60 disabled:pointer-events-none cursor-pointer"
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
          <div className="relative mt-3 text-xs text-white/70">
            {t("home.noAccountHint")}
          </div>
        )}

        {quickBusy && progress && (
          <div className="relative mt-4 max-w-md">
            <ProgressBar value={progress.current / Math.max(1, progress.total)} />
          </div>
        )}
      </div>
      )}

      {/* What's new: available modpack & mod updates */}
      {updates.length > 0 && (
        <div>
          <h2 className="section-title mb-2">{t("home.updates")}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
            {updates.map(({ inst, packVersion, modCount }) => {
              return (
                <button
                  key={inst.id}
                  onClick={() => navigate({ page: "instance", id: inst.id })}
                  className="card card-action flex items-center gap-3 py-3.5 pl-4 pr-3.5 text-left transition-all hover:bg-card-hover hover:-translate-y-0.5 cursor-pointer"
                >
                  <InstanceIcon instance={inst} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-t1">{inst.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {packVersion && (
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent-text">
                          {t("home.modpackUpdateTo", { v: packVersion })}
                        </span>
                      )}
                      {modCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded bg-bg-soft px-1.5 py-0.5 text-[11px] text-t2">
                          <Package className="size-3" />
                          {t("home.modUpdates", { n: modCount })}
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowDownToLine className="size-4 shrink-0 text-accent-text" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent instances */}
      {recent.length > 0 && (
        <div>
          <h2 className="section-title mb-2">{t("home.recent")}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
            {recent.map((inst) => (
              <button
                key={inst.id}
                onClick={() => navigate({ page: "instance", id: inst.id })}
                className="card flex items-center gap-3 p-3.5 text-left transition-all hover:bg-card-hover hover:-translate-y-0.5 cursor-pointer"
              >
                <InstanceIcon instance={inst} size={40} />
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

      {/* Discovery: popular modpacks from Modrinth */}
      {popularLoading && (
        <div>
          <h2 className="section-title mb-2">{t("home.popular")}</h2>
          {/* Skeletons keep the layout from jumping when the grid arrives. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2.5">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="card flex items-center gap-3 p-3">
                <Skeleton className="size-11 shrink-0" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {popular.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title">{t("home.popular")}</h2>
            <button
              className="flex items-center gap-1 text-xs font-medium text-accent-text hover:underline cursor-pointer"
              onClick={() => navigate({ page: "browse", projectType: "modpack" })}
            >
              <Compass className="size-3.5" />
              {t("home.allModpacks")}
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2.5">
            {popular.slice(0, 8).map((hit) => (
              <button
                key={hit.project_id}
                onClick={() =>
                  navigate({
                    page: "project",
                    projectId: hit.project_id,
                    projectType: "modpack",
                  })
                }
                className="card flex items-center gap-3 p-3 text-left transition-all hover:bg-card-hover hover:-translate-y-0.5 cursor-pointer"
              >
                {hit.icon_url ? (
                  <img
                    src={hit.icon_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-11 shrink-0 rounded-lg object-cover bg-bg-soft"
                  />
                ) : (
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-bg-soft text-t3">
                    <Box className="size-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-t1">{hit.title}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-t3">
                    <Download className="size-3" />
                    {formatDownloads(hit.downloads)}
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

/**
 * The main entry point of the screen for a returning player: the instance
 * they last played, given real presence — its own artwork as the backdrop
 * (or its loader colour), a large title and one obvious action.
 */
function ContinueCard({
  instance,
  status,
  onOpen,
  onPlay,
  onStop,
}: {
  instance: Instance;
  status?: InstanceStatus;
  onOpen: () => void;
  onPlay: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const icon = instanceIconSrc(instance);
  const running = status?.state === "running";
  const busy = ["preparing", "installing", "launching"].includes(
    status?.state ?? "",
  );
  const progress = status?.packProgress
    ? status.packProgress.current / Math.max(1, status.packProgress.total)
    : status?.progress
      ? status.progress.current / Math.max(1, status.progress.total)
      : null;
  const playtime = instance.totalPlaytimeSecs ?? 0;

  return (
    <div
      onClick={onOpen}
      className="card group relative cursor-pointer overflow-hidden !p-0 transition-all hover:-translate-y-0.5"
    >
      {/* Backdrop: the instance's own art, or its loader gradient. */}
      <div className="absolute inset-0" aria-hidden>
        {icon ? (
          <img src={icon} alt="" className="banner-img !opacity-30 dark:!opacity-25" />
        ) : (
          <div
            className="size-full opacity-[0.18] dark:opacity-25"
            style={{ background: LOADER_GRADIENTS[instance.loader] }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(100deg, var(--card) 32%, transparent 130%)",
          }}
        />
      </div>

      <div className="relative flex flex-wrap items-center gap-4 p-5">
        <InstanceIcon instance={instance} size={64} rounded="rounded-2xl" className="shadow-lg" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-text">
            {t("home.continueTitle")}
          </div>
          <div className="mt-0.5 truncate text-xl font-bold tracking-tight text-t1">
            {instance.name}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-t3">
            <LoaderBadge loader={instance.loader} />
            <span>{instance.mcVersion}</span>
            <span>· {formatRelativeDate(instance.lastPlayed)}</span>
            {playtime > 0 && (
              <span className="inline-flex items-center gap-1">
                · <Clock className="size-3" /> {formatPlaytime(playtime)}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            running ? onStop() : onPlay();
          }}
          disabled={busy}
          className={`${running ? "btn-danger" : "btn-primary"} !px-7 !py-3 !text-base`}
          style={running ? undefined : { boxShadow: "var(--glow)" }}
        >
          {busy ? (
            <Spinner className="size-5" />
          ) : running ? (
            <>
              <Square className="size-4.5 fill-current" /> {t("common.stop")}
            </>
          ) : (
            <>
              <Play className="size-4.5 fill-current" /> {t("common.play")}
            </>
          )}
        </button>
        {busy && progress !== null && (
          <div className="w-full">
            <ProgressBar value={progress} />
          </div>
        )}
      </div>
    </div>
  );
}
