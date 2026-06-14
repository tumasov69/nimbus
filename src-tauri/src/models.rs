use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoaderKind {
    Vanilla,
    Fabric,
    Quilt,
    Forge,
    NeoForge,
}

impl LoaderKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            LoaderKind::Vanilla => "vanilla",
            LoaderKind::Fabric => "fabric",
            LoaderKind::Quilt => "quilt",
            LoaderKind::Forge => "forge",
            LoaderKind::NeoForge => "neoforge",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackRef {
    pub project_id: String,
    pub version_id: String,
    #[serde(default)]
    pub version_number: Option<String>,
    /// Relative paths installed by the modpack — tracked so an update can
    /// remove files dropped in newer versions without touching user mods.
    #[serde(default)]
    pub managed_files: Vec<String>,
}

/// Per-instance overrides of the global launch settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InstanceOverrides {
    pub memory_mb: Option<u64>,
    pub java_args: Option<String>,
    pub game_width: Option<u32>,
    pub game_height: Option<u32>,
    pub fullscreen: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: LoaderKind,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    /// Custom icon file stored inside the instance dir (icon.png).
    #[serde(default)]
    pub icon_path: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub last_played: Option<String>,
    /// Cumulative time spent in-game across all sessions, in seconds.
    #[serde(default)]
    pub total_playtime_secs: u64,
    #[serde(default)]
    pub modpack: Option<ModpackRef>,
    #[serde(default)]
    pub overrides: Option<InstanceOverrides>,
    /// Optional folder/group name for organizing instances.
    #[serde(default)]
    pub group: Option<String>,
    /// Created automatically by the quick-play card on the home screen.
    #[serde(default)]
    pub quick: bool,
}

impl Instance {
    /// Directory name of the installed version inside the shared game dir.
    pub fn version_name(&self) -> String {
        match (&self.loader, &self.loader_version) {
            (LoaderKind::Vanilla, _) | (_, None) => self.mc_version.clone(),
            (kind, Some(lv)) => format!("{}-{}-{}", self.mc_version, kind.as_str(), lv),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub memory_mb: u64,
    pub java_args: String,
    pub game_width: u32,
    pub game_height: u32,
    pub fullscreen: bool,
    pub hide_launcher: bool,
    /// UI language code ("" = auto-detect from the system).
    pub language: String,
    /// "light" | "dark" | "oled" | "system"
    pub theme: String,
    /// Parallel downloads for modpack installs.
    pub download_concurrency: usize,
    /// Show "playing Minecraft" in Discord.
    pub discord_rpc: bool,
    /// Native OS notifications when long operations finish in the background.
    pub notifications_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            memory_mb: 4096,
            java_args: String::new(),
            game_width: 1280,
            game_height: 720,
            fullscreen: false,
            hide_launcher: true,
            language: String::new(),
            theme: "system".into(),
            download_concurrency: 8,
            discord_rpc: true,
            notifications_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    Offline,
    Microsoft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub kind: AccountKind,
    pub username: String,
    pub uuid: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exp: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AccountStore {
    pub active: Option<String>,
    pub accounts: Vec<Account>,
}
