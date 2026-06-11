import { Check, Download, Package, Search } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import type { ModrinthCategory } from "../api";
import {
  eligibleInstances,
  InstancePickerModal,
} from "../components/InstancePicker";
import {
  Field,
  Modal,
  SelectWrap,
  Skeleton,
  Spinner,
  formatDownloads,
} from "../components/ui";
import type { Route } from "../routes";
import { errorText, useStore } from "../store";
import type {
  Instance,
  McVersion,
  ModrinthVersion,
  ProjectType,
  SearchHit,
  SearchResult,
} from "../types";

const PAGE_SIZE = 20;

/** Russian labels for Modrinth category slugs (other languages fall back to
 *  the prettified English slug). */
const CATEGORY_RU: Record<string, string> = {
  adventure: "Приключения",
  cursed: "Проклятые",
  decoration: "Декор",
  economy: "Экономика",
  equipment: "Снаряжение",
  food: "Еда",
  "game-mechanics": "Механики",
  library: "Библиотеки",
  magic: "Магия",
  management: "Менеджмент",
  minigame: "Мини-игры",
  mobs: "Мобы",
  optimization: "Оптимизация",
  social: "Социальное",
  storage: "Хранение",
  technology: "Технологии",
  transportation: "Транспорт",
  utility: "Утилиты",
  worldgen: "Генерация мира",
  challenging: "Хардкор",
  combat: "Сражения",
  "kitchen-sink": "Всё сразу",
  lightweight: "Лёгкие",
  multiplayer: "Мультиплеер",
  quests: "Квесты",
  audio: "Звуки",
  blocks: "Блоки",
  "core-shaders": "Core-шейдеры",
  entities: "Сущности",
  environment: "Окружение",
  fonts: "Шрифты",
  gui: "Интерфейс",
  items: "Предметы",
  locale: "Локализация",
  models: "Модели",
  modded: "Для модов",
  realistic: "Реализм",
  simplistic: "Минимализм",
  themed: "Тематические",
  tweaks: "Твики",
  "vanilla-like": "Ванильные",
  atmosphere: "Атмосфера",
  bloom: "Свечение",
  "colored-lighting": "Цветной свет",
  foliage: "Листва",
  "path-tracing": "Трассировка пути",
  pbr: "PBR",
  reflections: "Отражения",
  shadows: "Тени",
  cartoon: "Мультяшные",
  fantasy: "Фэнтези",
  "semi-realistic": "Полуреализм",
  potato: "Слабые ПК",
  low: "Низкие требования",
  medium: "Средние требования",
  high: "Высокие требования",
  screenshot: "Для скриншотов",
};

function categoryLabel(slug: string, lang: string): string {
  if (lang.startsWith("ru") || lang.startsWith("uk")) {
    const ru = CATEGORY_RU[slug];
    if (ru) return ru;
  }
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const HEADER_RU: Record<string, string> = {
  categories: "Категории",
  features: "Возможности",
  resolutions: "Разрешение",
  "performance impact": "Влияние на FPS",
};

function headerLabel(header: string, lang: string): string {
  if (lang.startsWith("ru") || lang.startsWith("uk")) {
    return HEADER_RU[header] ?? header;
  }
  return header;
}

const LOADER_FILTERS = ["fabric", "forge", "quilt", "neoforge"] as const;

// In-memory cache of first-page search results with TTL and LRU-ish eviction.
const searchCache = new Map<string, { at: number; data: SearchResult }>();
const SEARCH_CACHE_TTL = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 200;

function cacheGet(key: string): SearchResult | undefined {
  const entry = searchCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > SEARCH_CACHE_TTL) {
    searchCache.delete(key);
    return undefined;
  }
  return entry.data;
}
function cacheSet(key: string, data: SearchResult) {
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, { at: Date.now(), data });
}

/** Allows only a bare <svg> with paths — strips scripts, events and external
 *  refs so a compromised API response can't inject active content. */
function sanitizeSvgIcon(svg: string): string | null {
  if (!svg || !svg.includes("<svg")) return null;
  if (/<script|on\w+\s*=|javascript:|<foreignObject|xlink:href\s*=\s*["']?\s*http/i.test(svg)) {
    return null;
  }
  return svg;
}

const FilterItem = memo(function FilterItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon?: string;
  active: boolean;
  onClick: () => void;
}) {
  const safeIcon = icon ? sanitizeSvgIcon(icon) : null;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[13px] font-medium transition-all cursor-pointer ${
        active
          ? "border-accent bg-accent text-accent-fg shadow-sm"
          : "border-transparent text-t2 hover:bg-bg-soft hover:text-t1"
      }`}
    >
      {safeIcon ? (
        <span
          className="size-3.5 shrink-0 [&>svg]:size-3.5"
          dangerouslySetInnerHTML={{ __html: safeIcon }}
        />
      ) : (
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          {active && <Check className="size-3" />}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <Check className="size-3 shrink-0" />}
    </button>
  );
});

export function BrowsePage({
  navigate,
  initialType,
  instanceId,
}: {
  navigate: (r: Route) => void;
  initialType?: ProjectType;
  instanceId?: string;
}) {
  const { t, i18n } = useTranslation();
  const i18nLang = i18n.language;
  const { instances, toast, refreshInstances } = useStore();
  // Memoized: object identity matters for doSearch/effect dependencies.
  const contextInstance = useMemo(
    () => instances.find((i) => i.id === instanceId),
    [instances, instanceId],
  );

  const TYPE_TABS: { type: ProjectType; label: string }[] = [
    { type: "modpack", label: t("browse.modpacks") },
    { type: "mod", label: t("browse.mods") },
    { type: "resourcepack", label: t("browse.resourcepacks") },
    { type: "shader", label: t("browse.shaders") },
  ];

  const SORTS: [string, string][] = [
    ["relevance", t("browse.sortRelevance")],
    ["downloads", t("browse.sortDownloads")],
    ["newest", t("browse.sortNewest")],
    ["updated", t("browse.sortUpdated")],
  ];

  const [type, setType] = useState<ProjectType>(initialType ?? "modpack");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<string>("relevance");
  const [mcVersions, setMcVersions] = useState<McVersion[]>([]);
  const [mcFilter, setMcFilter] = useState<string>(contextInstance?.mcVersion ?? "");
  const [allCategories, setAllCategories] = useState<ModrinthCategory[]>([]);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [loaderFilter, setLoaderFilter] = useState<"" | (typeof LOADER_FILTERS)[number]>("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [installedProjects, setInstalledProjects] = useState<Set<string>>(new Set());
  const [pickFor, setPickFor] = useState<SearchHit | null>(null);
  const [packPick, setPackPick] = useState<{
    hit: SearchHit;
    versions: ModrinthVersion[];
    selected: string;
  } | null>(null);

  const searchSeq = useRef(0);

  useEffect(() => {
    api.getMinecraftVersions().then(setMcVersions).catch(() => {});
  }, []);

  // Categories depend on the selected project type.
  useEffect(() => {
    setSelectedCats([]);
    setLoaderFilter("");
    api
      .modrinthCategories(type)
      .then(setAllCategories)
      .catch(() => setAllCategories([]));
  }, [type]);

  // Track which projects are already installed, to show an "Installed" badge.
  useEffect(() => {
    if (type === "modpack") {
      setInstalledProjects(
        new Set(
          instances
            .map((i) => i.modpack?.projectId)
            .filter((x): x is string => !!x),
        ),
      );
      return;
    }
    if (contextInstance) {
      let cancelled = false;
      api
        .modrinthEnrichMods(contextInstance.id)
        .then((mods) => {
          if (cancelled) return;
          setInstalledProjects(
            new Set(mods.map((m) => m.projectId).filter((x): x is string => !!x)),
          );
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    setInstalledProjects(new Set());
  }, [type, contextInstance, instances]);

  const doSearch = useCallback(
    async (offset: number, append: boolean) => {
      const seq = ++searchSeq.current;
      const params = {
        query,
        projectType: type,
        mcVersion: mcFilter || null,
        loader:
          type === "mod" && contextInstance && contextInstance.loader !== "vanilla"
            ? contextInstance.loader
            : !contextInstance && loaderFilter
              ? loaderFilter
              : null,
        categories: selectedCats.length > 0 ? selectedCats : null,
        offset,
        limit: PAGE_SIZE,
        index: sort,
      };

      // Serve first page from cache instantly when available.
      const cacheKey = JSON.stringify(params);
      if (!append) {
        const cached = cacheGet(cacheKey);
        if (cached) {
          setTotalHits(cached.total_hits);
          setHits(cached.hits);
          setLoading(false);
          return;
        }
      }

      append ? setLoadingMore(true) : setLoading(true);
      setSearchFailed(false);
      try {
        const result = await api.modrinthSearch(params);
        if (seq !== searchSeq.current) return;
        if (!append) cacheSet(cacheKey, result);
        setTotalHits(result.total_hits);
        setHits((prev) => (append ? [...prev, ...result.hits] : result.hits));
      } catch (e) {
        if (seq === searchSeq.current) {
          setSearchFailed(true);
          toast("error", errorText(e));
        }
      } finally {
        if (seq === searchSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [query, type, mcFilter, sort, contextInstance, selectedCats, loaderFilter, toast],
  );

  useEffect(() => {
    const timer = setTimeout(() => doSearch(0, false), 300);
    return () => clearTimeout(timer);
  }, [doSearch]);

  const releases = useMemo(
    () => mcVersions.filter((v) => v.type === "release"),
    [mcVersions],
  );

  // Group categories by their Modrinth "header" (Categories, Features, …).
  const categoryGroups = useMemo(() => {
    const groups = new Map<string, typeof allCategories>();
    for (const cat of allCategories) {
      const header = cat.header ?? "categories";
      if (!groups.has(header)) groups.set(header, []);
      groups.get(header)!.push(cat);
    }
    return [...groups.entries()];
  }, [allCategories]);

  const markInstalling = (id: string, on: boolean) =>
    setInstalling((prev) => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });

  const installIntoInstance = async (hit: SearchHit, instance: Instance) => {
    markInstalling(hit.project_id, true);
    try {
      const versions = await api.modrinthGetVersions({
        projectId: hit.project_id,
        mcVersion: instance.mcVersion,
        loader: instance.loader,
        filterLoader: type === "mod",
      });
      if (versions.length === 0) {
        toast(
          "error",
          t("browse.noCompatible", {
            name: hit.title,
            mc: instance.mcVersion,
            loader: instance.loader,
          }),
        );
        return;
      }
      await api.modrinthInstallVersion(instance.id, versions[0].id, type);
      api.invalidateEnrich(instance.id);
      setInstalledProjects((prev) => new Set(prev).add(hit.project_id));
      toast("success", t("browse.installedTo", { name: hit.title, instance: instance.name }));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      markInstalling(hit.project_id, false);
    }
  };

  const openPackPicker = async (hit: SearchHit) => {
    markInstalling(hit.project_id, true);
    try {
      const versions = await api.modrinthGetVersions({
        projectId: hit.project_id,
        mcVersion: mcFilter || null,
        filterLoader: false,
      });
      if (versions.length === 0) {
        toast("error", t("browse.noPackVersions"));
        return;
      }
      setPackPick({ hit, versions, selected: versions[0].id });
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      markInstalling(hit.project_id, false);
    }
  };

  const installPack = async () => {
    if (!packPick) return;
    const { hit, selected } = packPick;
    setPackPick(null);
    markInstalling(hit.project_id, true);
    toast("info", t("browse.packInstalling", { name: hit.title }));
    navigate({ page: "instances" });
    try {
      await api.modrinthInstallModpack(hit.project_id, selected);
      await refreshInstances();
      toast("success", t("browse.packInstalled", { name: hit.title }));
    } catch (e) {
      await refreshInstances();
      toast("error", errorText(e));
    } finally {
      markInstalling(hit.project_id, false);
    }
  };

  const onInstallClick = (hit: SearchHit) => {
    if (type === "modpack") {
      openPackPicker(hit);
      return;
    }
    if (contextInstance) {
      installIntoInstance(hit, contextInstance);
      return;
    }
    const candidates = eligibleInstances(instances, type);
    if (candidates.length === 0) {
      toast(
        "info",
        type === "mod" ? t("browse.needModInstance") : t("browse.needInstance"),
      );
      return;
    }
    if (candidates.length === 1) {
      installIntoInstance(hit, candidates[0]);
      return;
    }
    setPickFor(hit);
  };

  return (
    <div className="animate-fade-up flex h-full flex-col">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("browse.title")}</h1>
          <p className="mt-1 text-sm text-t3">
            {contextInstance
              ? t("browse.installTo", {
                  name: contextInstance.name,
                  mc: contextInstance.mcVersion,
                })
              : t("browse.subtitle")}
          </p>
        </div>
        {contextInstance && (
          <button
            className="btn-secondary"
            onClick={() => navigate({ page: "instance", id: contextInstance.id })}
          >
            {t("browse.toInstance")}
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {TYPE_TABS.map((tabItem) => (
            <button
              key={tabItem.type}
              onClick={() => setType(tabItem.type)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all cursor-pointer ${
                type === tabItem.type
                  ? "tab-active"
                  : "text-t3 hover:bg-accent-soft hover:text-t1"
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-t3" />
          <input
            className="input-base !pl-10"
            placeholder={t("browse.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <SelectWrap>
          <select
            className="select-base !w-44"
            value={mcFilter}
            disabled={!!contextInstance}
            onChange={(e) => setMcFilter(e.target.value)}
          >
            <option value="">{t("browse.anyVersion")}</option>
            {releases.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
              </option>
            ))}
          </select>
        </SelectWrap>
        <SelectWrap>
          <select
            className="select-base !w-48"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </SelectWrap>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Filters: loader + categories */}
        <aside className="w-44 shrink-0 overflow-y-auto pb-4 pr-1">
          {!contextInstance && (type === "mod" || type === "modpack") && (
            <div className="mb-4">
              <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-t3">
                {t("instances.loader")}
              </div>
              <div className="flex flex-col gap-1">
                <FilterItem
                  label={t("browse.anyLoader")}
                  active={loaderFilter === ""}
                  onClick={() => setLoaderFilter("")}
                />
                {LOADER_FILTERS.map((l) => (
                  <FilterItem
                    key={l}
                    label={l.charAt(0).toUpperCase() + l.slice(1)}
                    active={loaderFilter === l}
                    onClick={() => setLoaderFilter(loaderFilter === l ? "" : l)}
                  />
                ))}
              </div>
            </div>
          )}

          {allCategories.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-t3">
                  {t("browse.categories")}
                </span>
                {selectedCats.length > 0 && (
                  <button
                    className="text-xs font-medium text-accent-text hover:underline cursor-pointer"
                    onClick={() => setSelectedCats([])}
                  >
                    {t("browse.clearFilters")}
                  </button>
                )}
              </div>
              {categoryGroups.map(([header, cats]) => (
                <div key={header} className="mb-3">
                  {categoryGroups.length > 1 && (
                    <div className="mb-1 px-1 text-[11px] font-medium capitalize text-t3/70">
                      {headerLabel(header, i18nLang)}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    {cats.map((cat) => {
                      const active = selectedCats.includes(cat.name);
                      return (
                        <FilterItem
                          key={cat.name}
                          label={categoryLabel(cat.name, i18nLang)}
                          icon={cat.icon}
                          active={active}
                          onClick={() =>
                            setSelectedCats((prev) =>
                              active
                                ? prev.filter((c) => c !== cat.name)
                                : [...prev, cat.name],
                            )
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex flex-col gap-2.5 pb-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card flex items-center gap-4 p-4">
                <Skeleton className="size-12 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-2 h-3 w-full max-w-md" />
                  <Skeleton className="mt-2 h-3 w-24" />
                </div>
                <Skeleton className="h-9 w-28 rounded-lg" />
              </div>
            ))}
          </div>
        ) : hits.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 py-16 text-center text-t3">
            {searchFailed ? t("browse.searchFailed") : t("browse.nothingFound")}
            {searchFailed && (
              <button className="btn-secondary" onClick={() => doSearch(0, false)}>
                {t("browse.retry")}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 pb-4">
            {hits.map((hit) => (
              <div
                key={hit.project_id}
                onClick={() =>
                  navigate({
                    page: "project",
                    projectId: hit.project_id,
                    projectType: type,
                    instanceId,
                  })
                }
                className="card flex cursor-pointer items-center gap-4 p-4 transition-all hover:bg-card-hover"
              >
                {hit.icon_url ? (
                  <img
                    src={hit.icon_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={48}
                    height={48}
                    className="size-12 shrink-0 rounded-xl object-cover bg-bg-soft"
                  />
                ) : (
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-bg-soft text-t3">
                    <Package className="size-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-medium tracking-tight text-t1">
                      {hit.title}
                    </span>
                    <span className="shrink-0 text-xs text-t3">{hit.author}</span>
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-sm text-t2">
                    {hit.description}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-t3">
                    <span className="inline-flex items-center gap-1">
                      <Download className="size-3" />
                      {formatDownloads(hit.downloads)}
                    </span>
                    {(hit.display_categories ?? hit.categories ?? [])
                      .slice(0, 4)
                      .map((c) => (
                        <span key={c} className="rounded bg-bg-soft px-1.5 py-0.5">
                          {c}
                        </span>
                      ))}
                  </div>
                </div>
                {installedProjects.has(hit.project_id) ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-success-soft px-3 py-2.5 text-sm font-medium text-success">
                    <Check className="size-4" />
                    {t("browse.installed")}
                  </span>
                ) : (
                  <button
                    className="btn-primary shrink-0"
                    disabled={installing.has(hit.project_id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onInstallClick(hit);
                    }}
                  >
                    {installing.has(hit.project_id) ? (
                      <Spinner />
                    ) : (
                      <Download className="size-4" />
                    )}
                    {t("common.install")}
                  </button>
                )}
              </div>
            ))}

            {hits.length < totalHits && (
              <button
                className="btn-secondary self-center"
                disabled={loadingMore}
                onClick={() => doSearch(hits.length, true)}
              >
                {loadingMore && <Spinner />}
                {t("common.showMore")}
              </button>
            )}
          </div>
        )}
        </div>
      </div>

      {pickFor && (
        <InstancePickerModal
          type={type}
          onClose={() => setPickFor(null)}
          onPick={(inst) => installIntoInstance(pickFor, inst)}
        />
      )}

      {packPick && (
        <Modal
          title={`${t("common.install")}: ${packPick.hit.title}`}
          onClose={() => setPackPick(null)}
        >
          <div className="flex flex-col gap-4">
            <Field label={t("browse.packVersion")}>
              <SelectWrap>
                <select
                  className="select-base"
                  value={packPick.selected}
                  onChange={(e) => setPackPick({ ...packPick, selected: e.target.value })}
                >
                  {packPick.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name || v.version_number} ·{" "}
                      {v.game_versions[v.game_versions.length - 1]} ·{" "}
                      {v.loaders.join(", ")}
                    </option>
                  ))}
                </select>
              </SelectWrap>
            </Field>
            <p className="text-xs text-t3">{t("browse.packCreates")}</p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setPackPick(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn-primary" onClick={installPack}>
                <Download className="size-4" /> {t("common.install")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
