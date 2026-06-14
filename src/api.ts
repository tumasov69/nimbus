import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AccountStore,
  Instance,
  InstanceOverrides,
  LoaderKind,
  McVersion,
  ModFile,
  ProjectType,
  SearchResult,
  Settings,
  SystemInfo,
  ModrinthVersion,
} from "./types";

// --- settings ---
export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) =>
  invoke<void>("save_settings", { settings });
export const getSystemInfo = () => invoke<SystemInfo>("get_system_info");
export const openDataFolder = () => invoke<void>("open_data_folder");

// --- versions ---
export const getMinecraftVersions = () =>
  invoke<McVersion[]>("get_minecraft_versions");
export const getLoaderVersions = (loader: LoaderKind, mcVersion: string) =>
  invoke<string[]>("get_loader_versions", { loader, mcVersion });

// --- instances ---
export const listInstances = () => invoke<Instance[]>("list_instances");
export const createInstance = (
  name: string,
  mcVersion: string,
  loader: LoaderKind,
  loaderVersion: string | null,
  quick = false,
) =>
  invoke<Instance>("create_instance", {
    name,
    mcVersion,
    loader,
    loaderVersion,
    quick,
  });
export const renameInstance = (id: string, name: string) =>
  invoke<void>("rename_instance", { id, name });
export const setInstanceOverrides = (
  id: string,
  overrides: InstanceOverrides | null,
) => invoke<void>("set_instance_overrides", { id, overrides });
export const setInstanceGroup = (id: string, group: string | null) =>
  invoke<void>("set_instance_group", { id, group });
export const cloneInstance = (id: string) =>
  invoke<Instance>("clone_instance", { id });
export const setInstanceIcon = (id: string, sourcePath: string) =>
  invoke<string>("set_instance_icon", { id, sourcePath });
export const repairInstance = (id: string) =>
  invoke<void>("repair_instance", { id });
export const deleteInstance = (id: string) =>
  invoke<void>("delete_instance", { id });
export const openInstanceFolder = (id: string) =>
  invoke<void>("open_instance_folder", { id });
export type ContentFolder =
  | "mods"
  | "resourcepacks"
  | "shaderpacks"
  | "datapacks";
export const listMods = (id: string, folder: ContentFolder = "mods") =>
  invoke<ModFile[]>("list_mods", { id, folder });
export const toggleMod = (
  id: string,
  fileName: string,
  enabled: boolean,
  folder: ContentFolder = "mods",
) => invoke<void>("toggle_mod", { id, fileName, enabled, folder });
export const deleteMod = (
  id: string,
  fileName: string,
  folder: ContentFolder = "mods",
) => invoke<void>("delete_mod", { id, fileName, folder });

// --- launch ---
export const launchInstance = (id: string, server?: string) =>
  invoke<void>("launch_instance", { id, server: server ?? null });

export interface ServerStatus {
  online: number;
  max: number;
  version: string;
  motd: string;
  favicon?: string | null;
  latencyMs: number;
}
export const pingServer = (addr: string) =>
  invoke<ServerStatus>("ping_server", { addr });
export const killInstance = (id: string) => invoke<void>("kill_instance", { id });
export const getRunningInstances = () =>
  invoke<string[]>("get_running_instances");

// --- accounts ---
export const getAccounts = () => invoke<AccountStore>("get_accounts");
export const addOfflineAccount = (username: string) =>
  invoke<Account>("add_offline_account", { username });
export const removeAccount = (id: string) =>
  invoke<void>("remove_account", { id });
export const setActiveAccount = (id: string) =>
  invoke<void>("set_active_account", { id });
export const loginMicrosoft = () => invoke<Account>("login_microsoft");
export const setSkin = (
  accountId: string,
  filePath: string,
  variant: "classic" | "slim",
) => invoke<void>("set_skin", { accountId, filePath, variant });
export const readImagePreview = (path: string) =>
  invoke<string>("read_image_preview", { path });

export interface PlayerSkin {
  uuid: string;
  name: string;
  skinUrl: string;
  slim: boolean;
}
export const getPlayerSkin = (username: string) =>
  invoke<PlayerSkin>("get_player_skin", { username });
export const setSkinFromUrl = (
  accountId: string,
  url: string,
  variant: "classic" | "slim",
) => invoke<void>("set_skin_from_url", { accountId, url, variant });

// --- modrinth ---
export const modrinthSearch = (params: {
  query: string;
  projectType: ProjectType;
  mcVersion?: string | null;
  loader?: LoaderKind | null;
  categories?: string[] | null;
  offset: number;
  limit: number;
  index: string;
}) => invoke<SearchResult>("modrinth_search", { ...params });

export interface ModrinthCategory {
  name: string;
  icon?: string;
  header?: string;
}

export const modrinthCategories = (projectType: ProjectType) =>
  invoke<ModrinthCategory[]>("modrinth_categories", { projectType });

export const modrinthGetVersions = (params: {
  projectId: string;
  mcVersion?: string | null;
  loader?: LoaderKind | null;
  filterLoader: boolean;
}) => invoke<ModrinthVersion[]>("modrinth_get_versions", { ...params });

export const modrinthInstallVersion = (
  instanceId: string,
  versionId: string,
  projectType: ProjectType,
) =>
  invoke<string[]>("modrinth_install_version", {
    instanceId,
    versionId,
    projectType,
  });

export const modrinthInstallModpack = (projectId: string, versionId: string) =>
  invoke<Instance>("modrinth_install_modpack", { projectId, versionId });

export const modrinthGetProject = (id: string) =>
  invoke<Record<string, unknown>>("modrinth_get_project", { id });

export const translateTexts = (texts: string[], target: string) =>
  invoke<string[]>("translate_texts", { texts, target });

export const importMrpack = (path: string) =>
  invoke<Instance>("import_mrpack", { path });

export const exportMrpack = (instanceId: string, outputPath: string) =>
  invoke<void>("export_mrpack", { instanceId, outputPath });

export interface ModpackUpdate {
  versionId: string;
  versionNumber: string;
}

export const checkModpackUpdate = (instanceId: string) =>
  invoke<ModpackUpdate | null>("modrinth_check_modpack_update", { instanceId });

export const updateModpack = (instanceId: string) =>
  invoke<Instance>("modrinth_update_modpack", { instanceId });

// --- worlds & servers ---
export interface WorldInfo {
  folder: string;
  name: string;
  sizeBytes: number;
  lastPlayed?: number | null;
}

export const listWorlds = (id: string) =>
  invoke<WorldInfo[]>("list_worlds", { id });
export const deleteWorld = (id: string, folder: string) =>
  invoke<void>("delete_world", { id, folder });
export const openWorldFolder = (id: string, folder: string) =>
  invoke<void>("open_world_folder", { id, folder });
export const backupWorld = (id: string, folder: string, outputPath: string) =>
  invoke<void>("backup_world", { id, folder, outputPath });

export interface ServerEntry {
  name: string;
  ip: string;
  icon?: string | null;
}

export const listServers = (id: string) =>
  invoke<ServerEntry[]>("list_servers", { id });
export const addServer = (id: string, name: string, ip: string) =>
  invoke<ServerEntry[]>("add_server", { id, name, ip });
export const removeServer = (id: string, index: number) =>
  invoke<ServerEntry[]>("remove_server", { id, index });

export interface ModInfo {
  fileName: string;
  projectId?: string;
  title?: string;
  iconUrl?: string;
  versionNumber?: string;
  updateVersionId?: string;
  updateVersionNumber?: string;
}

const enrichCache = new Map<string, { at: number; data: ModInfo[] }>();
const ENRICH_TTL = 60_000;

/**
 * Enriches installed mods with Modrinth metadata. Hashing every jar plus the
 * API round-trips is expensive, so results are cached per instance for a
 * minute. Pass `force` after changing the mod set to refresh immediately.
 */
export async function modrinthEnrichMods(
  instanceId: string,
  force = false,
): Promise<ModInfo[]> {
  const cached = enrichCache.get(instanceId);
  if (!force && cached && Date.now() - cached.at < ENRICH_TTL) {
    return cached.data;
  }
  const data = await invoke<ModInfo[]>("modrinth_enrich_mods", { instanceId });
  enrichCache.set(instanceId, { at: Date.now(), data });
  return data;
}

/** Invalidate the enrichment cache for an instance after a mod change. */
export function invalidateEnrich(instanceId: string) {
  enrichCache.delete(instanceId);
}

export const modrinthUpdateMod = (
  instanceId: string,
  fileName: string,
  versionId: string,
) =>
  invoke<string>("modrinth_update_mod", { instanceId, fileName, versionId });
