import {
  ArrowLeft,
  Download,
  ExternalLink,
  Heart,
  Languages,
  Package,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// Modrinth descriptions mix markdown with raw HTML (<details>, <summary>,
// <center>, <img align=…>). Render it, but sanitized.
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "details",
    "summary",
    "center",
    "video",
    "source",
  ],
  attributes: {
    ...defaultSchema.attributes,
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      "width",
      "height",
      "align",
    ],
    details: ["open"],
    video: ["src", "controls", "loop", "muted", "width", "height", "poster"],
    source: ["src", "type"],
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
  },
};
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Components } from "react-markdown";

// Links inside project descriptions come from remote data. A plain <a> would
// navigate the app webview itself to the target page — so every link opens in
// the system browser instead, and only http(s) targets are allowed.
const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:\/\//i.test(href)) openUrl(href).catch(() => {});
      }}
    >
      {children}
    </a>
  ),
};
import * as api from "../api";
import {
  eligibleInstances,
  InstancePickerModal,
} from "../components/InstancePicker";
import { Spinner, formatDownloads } from "../components/ui";
import type { Route } from "../routes";
import { errorText, useStore } from "../store";
import type { Instance, ModrinthVersion, ProjectType } from "../types";

interface GalleryImage {
  url: string;
  raw_url?: string | null;
  title?: string | null;
}

interface Project {
  title?: string;
  description?: string;
  body?: string;
  icon_url?: string | null;
  downloads?: number;
  followers?: number;
  categories?: string[];
  gallery?: GalleryImage[];
  slug?: string;
}

type Tab = "about" | "gallery" | "versions" | "dependencies";

interface DepProject {
  id: string;
  title: string;
  iconUrl?: string | null;
  required: boolean;
}

// Page-level cache: project bodies and version lists are heavy (popular mods
// ship megabytes of version JSON), so keep them for the session (10 min TTL).
const projectCache = new Map<string, { at: number; data: Project }>();
const versionsCache = new Map<string, { at: number; data: ModrinthVersion[] }>();
const PROJECT_TTL = 10 * 60 * 1000;

function fromCache<T>(map: Map<string, { at: number; data: T }>, key: string): T | undefined {
  const e = map.get(key);
  if (!e || Date.now() - e.at > PROJECT_TTL) return undefined;
  return e.data;
}

export function ProjectPage({
  projectId,
  projectType,
  instanceId,
  navigate,
}: {
  projectId: string;
  projectType: ProjectType;
  instanceId?: string;
  navigate: (r: Route) => void;
}) {
  const { t, i18n } = useTranslation();
  const { instances, toast, refreshInstances } = useStore();
  const contextInstance = instances.find((i) => i.id === instanceId);

  const [project, setProject] = useState<Project | null>(
    () => fromCache(projectCache, projectId) ?? null,
  );
  const [versions, setVersions] = useState<ModrinthVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("about");
  const [loading, setLoading] = useState(!project);
  const [installingVersion, setInstallingVersion] = useState<string | null>(null);
  const [pickForVersion, setPickForVersion] = useState<ModrinthVersion | null>(null);
  const [deps, setDeps] = useState<DepProject[] | null>(null);
  const [depsLoaded, setDepsLoaded] = useState(false);
  const [lightbox, setLightbox] = useState<GalleryImage | null>(null);
  const [descTr, setDescTr] = useState<string | null>(null);
  const [bodyTr, setBodyTr] = useState<string | null>(null);
  const [showTr, setShowTr] = useState(false);
  const [translating, setTranslating] = useState(false);
  const lang = i18n.language.split("-")[0];

  // Auto-translate the short description into the UI language (cheap, cached).
  useEffect(() => {
    setDescTr(null);
    setBodyTr(null);
    setShowTr(false);
    if (lang === "en" || !project?.description) return;
    let cancelled = false;
    api
      .translateTexts([project.description], lang)
      .then((r) => !cancelled && setDescTr(r[0] ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project?.description, lang]);

  const toggleBodyTranslation = async () => {
    if (showTr) {
      setShowTr(false);
      return;
    }
    if (bodyTr) {
      setShowTr(true);
      return;
    }
    if (!project?.body) return;
    setTranslating(true);
    try {
      // Translate paragraph by paragraph to stay within the API's size limit.
      const blocks = project.body.split(/\n\n+/);
      const translated = await api.translateTexts(blocks, lang);
      setBodyTr(translated.join("\n\n"));
      setShowTr(true);
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setTranslating(false);
    }
  };

  // The project body renders the page; versions can be megabytes of JSON for
  // popular mods, so they load independently and never block first paint.
  useEffect(() => {
    let cancelled = false;

    const cachedProject = fromCache(projectCache, projectId);
    if (cachedProject) {
      setProject(cachedProject);
      setLoading(false);
    } else {
      setLoading(true);
      (api.modrinthGetProject(projectId) as Promise<Project>)
        .then((p) => {
          if (cancelled) return;
          projectCache.set(projectId, { at: Date.now(), data: p });
          setProject(p);
        })
        .catch((e) => !cancelled && toast("error", errorText(e)))
        .finally(() => !cancelled && setLoading(false));
    }

    const versionsKey = `${projectId}:${contextInstance?.id ?? ""}`;
    const cachedVersions = fromCache(versionsCache, versionsKey);
    if (cachedVersions) {
      setVersions(cachedVersions);
      setVersionsLoading(false);
    } else {
      setVersionsLoading(true);
      api
        .modrinthGetVersions({
          projectId,
          mcVersion: contextInstance?.mcVersion ?? null,
          loader: contextInstance?.loader ?? null,
          filterLoader: projectType === "mod" && !!contextInstance,
        })
        .then((v) => {
          if (cancelled) return;
          const trimmed = v.slice(0, 50);
          versionsCache.set(versionsKey, { at: Date.now(), data: trimmed });
          setVersions(trimmed);
        })
        .catch(() => {})
        .finally(() => !cancelled && setVersionsLoading(false));
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Dependencies resolve lazily — N extra API calls only when the tab opens.
  useEffect(() => {
    if (tab !== "dependencies" || depsLoaded || versions.length === 0) return;
    setDepsLoaded(true);
    // A shared mutable flag: a copied boolean would never see the cleanup.
    const flag = { cancelled: false };
    void resolveDeps(versions, flag);
    return () => {
      flag.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, versions, depsLoaded]);

  // Resolve project-level dependencies from the latest version.
  const resolveDeps = async (vlist: ModrinthVersion[], flag: { cancelled: boolean }) => {
    const raw = vlist[0]?.dependencies ?? [];
    const byProject = new Map<string, boolean>();
    for (const d of raw) {
      if (d.project_id && (d.dependency_type === "required" || d.dependency_type === "optional")) {
        byProject.set(d.project_id, byProject.get(d.project_id) || d.dependency_type === "required");
      }
    }
    if (byProject.size === 0) {
      if (!flag.cancelled) setDeps([]);
      return;
    }
    try {
      const projects = await Promise.all(
        [...byProject.keys()].map((pid) =>
          api.modrinthGetProject(pid).catch(() => null),
        ),
      );
      if (flag.cancelled) return;
      setDeps(
        projects
          .filter((p): p is Record<string, unknown> => !!p)
          .map((p) => ({
            id: String(p.id),
            title: String(p.title ?? p.slug ?? p.id),
            iconUrl: (p.icon_url as string | null) ?? null,
            required: byProject.get(String(p.id)) ?? false,
          })),
      );
    } catch {
      if (!flag.cancelled) setDeps([]);
    }
  };

  const installVersion = async (version: ModrinthVersion, instance?: Instance) => {
    setInstallingVersion(version.id);
    try {
      if (projectType === "modpack") {
        toast("info", t("browse.packInstalling", { name: project?.title ?? "" }));
        navigate({ page: "instances" });
        await api.modrinthInstallModpack(projectId, version.id);
        await refreshInstances();
        toast("success", t("browse.packInstalled", { name: project?.title ?? "" }));
        return;
      }
      const target = instance ?? contextInstance;
      if (!target) {
        const candidates = eligibleInstances(instances, projectType);
        if (candidates.length === 0) {
          toast(
            "info",
            projectType === "mod"
              ? t("browse.needModInstance")
              : t("browse.needInstance"),
          );
          return;
        }
        if (candidates.length === 1) {
          await installVersion(version, candidates[0]);
          return;
        }
        setPickForVersion(version);
        return;
      }
      await api.modrinthInstallVersion(target.id, version.id, projectType);
      toast(
        "success",
        t("browse.installedTo", {
          name: project?.title ?? version.name,
          instance: target.name,
        }),
      );
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setInstallingVersion(null);
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-up flex h-full items-center justify-center gap-2 text-t3">
        <Spinner /> {t("common.loading")}
      </div>
    );
  }

  if (!project) return null;

  const gallery = project.gallery ?? [];

  return (
    <div className="animate-fade-up flex h-full flex-col">
      <button
        className="btn-ghost -ml-2 mb-3 self-start"
        onClick={() =>
          navigate({ page: "browse", projectType, instanceId })
        }
      >
        <ArrowLeft className="size-4" /> {t("common.back")}
      </button>

      <div className="card relative mb-4 overflow-hidden p-5">
        {/* Blurred banner from the first gallery shot — store-page feel. */}
        {gallery[0] && (
          <>
            <img src={gallery[0].url} alt="" className="banner-img !opacity-25 dark:!opacity-20" />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, transparent 0%, var(--card) 92%)",
              }}
            />
          </>
        )}
        <div className="relative flex items-start gap-4">
          {project.icon_url ? (
            <img
              src={project.icon_url}
              alt=""
              className="size-20 rounded-2xl object-cover bg-bg-soft shadow-lg"
            />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-2xl bg-bg-soft text-t3">
              <Package className="size-9" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">{project.title}</h1>
            <p className="mt-1 text-sm text-t2">{descTr ?? project.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-t3">
              <span className="inline-flex items-center gap-1">
                <Download className="size-3" />
                {formatDownloads(project.downloads ?? 0)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Heart className="size-3" />
                {t("project.followers", { n: formatDownloads(project.followers ?? 0) })}
              </span>
              {(project.categories ?? []).slice(0, 5).map((c) => (
                <span key={c} className="rounded bg-bg-soft px-1.5 py-0.5">
                  {c}
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="btn-secondary !p-2.5"
              title={t("project.openModrinth")}
              onClick={() =>
                openUrl(
                  `https://modrinth.com/${projectType}/${encodeURIComponent(project.slug ?? projectId)}`,
                ).catch(() => {})
              }
            >
              <ExternalLink className="size-4" />
            </button>
            {versionsLoading ? (
              <button className="btn-primary" disabled>
                <Spinner />
                {t("common.install")}
              </button>
            ) : (
              versions[0] && (
                <button
                  className="btn-primary"
                  disabled={installingVersion !== null}
                  onClick={() => installVersion(versions[0])}
                >
                  {installingVersion === versions[0].id ? (
                    <Spinner />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {t("common.install")}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      <div className="mb-4 flex gap-1">
        {(
          [
            ["about", t("project.about")],
            ...(gallery.length > 0 ? [["gallery", t("project.gallery")]] : []),
            ...((versions[0]?.dependencies?.filter(
              (d) => d.dependency_type === "required" || d.dependency_type === "optional",
            ).length ?? 0) > 0
              ? [["dependencies", t("project.dependencies")]]
              : []),
            ["versions", t("project.versions")],
          ] as [Tab, string][]
        ).map(([tabKey, label]) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-all cursor-pointer ${
              tab === tabKey ? "tab-active" : "text-t3 hover:bg-accent-soft hover:text-t1"
            }`}
          >
            {label}
            {tabKey === "versions" && (
              <span className="ml-1.5 text-xs text-t3">{versions.length}</span>
            )}
            {tabKey === "dependencies" && deps && (
              <span className="ml-1.5 text-xs text-t3">{deps.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-4">
        {tab === "about" && (
          <div className="card p-6">
            {lang !== "en" && project.body && (
              <button
                className="mb-3 inline-flex items-center gap-1.5 rounded-lg bg-bg-soft px-2.5 py-1.5 text-xs font-medium text-t2 transition-colors hover:text-t1 cursor-pointer"
                disabled={translating}
                onClick={toggleBodyTranslation}
              >
                {translating ? <Spinner className="size-3.5" /> : <Languages className="size-3.5" />}
                {showTr ? t("project.original") : t("project.translate")}
              </button>
            )}
            <div className="md-body">
              <Markdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
                components={markdownComponents}
              >
                {(showTr ? bodyTr : project.body) ?? ""}
              </Markdown>
            </div>
          </div>
        )}

        {tab === "dependencies" && !deps && (
          <div className="card flex items-center justify-center gap-2 py-12 text-t3">
            <Spinner /> {t("common.loading")}
          </div>
        )}
        {tab === "dependencies" && deps && (
          <div className="card divide-y divide-stroke">
            {deps.map((dep) => (
              <button
                key={dep.id}
                onClick={() =>
                  navigate({
                    page: "project",
                    projectId: dep.id,
                    projectType,
                    instanceId,
                  })
                }
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-soft cursor-pointer"
              >
                {dep.iconUrl ? (
                  <img src={dep.iconUrl} alt="" className="size-9 rounded-lg object-cover bg-bg-soft" />
                ) : (
                  <div className="flex size-9 items-center justify-center rounded-lg bg-bg-soft text-t3">
                    <Package className="size-4.5" />
                  </div>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-t1">
                  {dep.title}
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    dep.required
                      ? "bg-accent-soft text-accent-text"
                      : "bg-bg-soft text-t3"
                  }`}
                >
                  {dep.required ? t("project.required") : t("project.optional")}
                </span>
              </button>
            ))}
          </div>
        )}

        {tab === "gallery" && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3">
            {gallery.map((img, i) => (
              <figure
                key={i}
                className="card group cursor-zoom-in overflow-hidden !p-0"
                onClick={() => setLightbox(img)}
              >
                <div className="aspect-video w-full overflow-hidden bg-black/20">
                  <img
                    src={img.url}
                    alt={img.title ?? ""}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                </div>
                {img.title && (
                  <figcaption className="truncate px-3 py-2 text-xs text-t3">
                    {img.title}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        )}

        {tab === "versions" && versionsLoading && (
          <div className="card flex items-center justify-center gap-2 py-12 text-t3">
            <Spinner /> {t("common.loading")}
          </div>
        )}
        {tab === "versions" && !versionsLoading && (
          <div className="card divide-y divide-stroke">
            {versions.length === 0 ? (
              <div className="py-12 text-center text-t3">{t("project.noVersions")}</div>
            ) : (
              versions.map((v) => (
                <div key={v.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      v.version_type === "release"
                        ? "bg-success"
                        : v.version_type === "beta"
                          ? "bg-amber-400"
                          : "bg-danger"
                    }`}
                    title={v.version_type}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-t1">
                      {v.name || v.version_number}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-t3">
                      <span>{v.version_number}</span>
                      <span>· {v.game_versions.slice(-3).join(", ")}</span>
                      <span>· {v.loaders.join(", ")}</span>
                      <span>
                        · {new Date(v.date_published).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <span className="hidden items-center gap-1 text-xs text-t3 sm:inline-flex">
                    <Download className="size-3" />
                    {formatDownloads(v.downloads)}
                  </span>
                  <button
                    className="btn-secondary !px-3 !py-2"
                    disabled={installingVersion !== null}
                    onClick={() => installVersion(v)}
                  >
                    {installingVersion === v.id ? (
                      <Spinner />
                    ) : (
                      <Download className="size-4" />
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {pickForVersion && (
        <InstancePickerModal
          type={projectType}
          onClose={() => setPickForVersion(null)}
          onPick={(inst) => installVersion(pickForVersion, inst)}
        />
      )}

      {lightbox &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex cursor-zoom-out items-center justify-center bg-black/85 p-8 animate-fade-up"
            onClick={() => setLightbox(null)}
          >
            <img
              src={lightbox.raw_url ?? lightbox.url}
              alt={lightbox.title ?? ""}
              className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
            />
            {lightbox.title && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-black/60 px-3 py-1.5 text-sm text-white">
                {lightbox.title}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
