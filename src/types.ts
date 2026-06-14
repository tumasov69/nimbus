export type LoaderKind = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";

export interface ModpackRef {
  projectId: string;
  versionId: string;
  versionNumber?: string | null;
  managedFiles?: string[];
}

export interface Instance {
  id: string;
  name: string;
  mcVersion: string;
  loader: LoaderKind;
  loaderVersion?: string | null;
  iconUrl?: string | null;
  iconPath?: string | null;
  createdAt: string;
  lastPlayed?: string | null;
  /** Cumulative in-game time across all sessions, in seconds. */
  totalPlaytimeSecs?: number;
  modpack?: ModpackRef | null;
  overrides?: InstanceOverrides | null;
  group?: string | null;
  quick?: boolean;
}

export interface Settings {
  memoryMb: number;
  javaArgs: string;
  gameWidth: number;
  gameHeight: number;
  fullscreen: boolean;
  hideLauncher: boolean;
  /** UI language code, "" = system */
  language: string;
  theme: "light" | "dark" | "oled" | "system";
  downloadConcurrency: number;
  discordRpc: boolean;
  notificationsEnabled: boolean;
}

export interface InstanceOverrides {
  memoryMb?: number | null;
  javaArgs?: string | null;
  gameWidth?: number | null;
  gameHeight?: number | null;
  fullscreen?: boolean | null;
}

export type AccountKind = "offline" | "microsoft";

export interface Account {
  id: string;
  kind: AccountKind;
  username: string;
  uuid: string;
}

export interface AccountStore {
  active?: string | null;
  accounts: Account[];
}

export interface ModFile {
  fileName: string;
  displayName: string;
  sizeBytes: number;
  enabled: boolean;
}

export interface McVersion {
  id: string;
  type: string;
}

export interface SystemInfo {
  totalMemoryMb: number;
  dataDir: string;
  /** True when a native Mica/Acrylic backdrop is active. */
  mica: boolean;
}

export type InstanceRunState =
  | "idle"
  | "preparing"
  | "installing"
  | "launching"
  | "running";

export interface InstallProgress {
  instanceId: string;
  kind: "single" | "multiple";
  path: string;
  current: number;
  total: number;
}

export interface ModpackProgress {
  instanceId: string;
  stage: "downloading" | "extracting" | "done" | "error";
  current: number;
  total: number;
}

// --- Modrinth ---

export type ProjectType =
  | "modpack"
  | "mod"
  | "resourcepack"
  | "shader"
  | "datapack";

export interface SearchHit {
  project_id: string;
  project_type: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string | null;
  downloads: number;
  follows: number;
  author: string;
  display_categories?: string[];
  categories?: string[];
}

export interface SearchResult {
  hits: SearchHit[];
  total_hits: number;
  offset: number;
  limit: number;
}

export interface ModrinthFile {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
}

export interface ModrinthDependency {
  project_id?: string | null;
  version_id?: string | null;
  dependency_type: string;
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  version_type: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  downloads: number;
  files: ModrinthFile[];
  dependencies?: ModrinthDependency[];
}
