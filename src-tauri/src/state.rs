use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use tokio::process::Child;
use tokio::sync::Mutex;

use crate::models::{AccountStore, Instance, Settings};
use crate::storage;

pub const USER_AGENT: &str = concat!(
    "NimbusLauncher/",
    env!("CARGO_PKG_VERSION"),
    " (tumasov1337@gmail.com)"
);

pub struct AppState {
    pub data_dir: PathBuf,
    /// Whether a native backdrop effect (Mica/Acrylic) was applied.
    pub mica: bool,
    pub http: reqwest::Client,
    pub settings: Mutex<Settings>,
    pub instances: Mutex<Vec<Instance>>,
    pub accounts: Mutex<AccountStore>,
    pub children: Mutex<HashMap<String, Child>>,
    /// Wall-clock start of each running session, used to accrue playtime.
    pub session_start: Mutex<HashMap<String, std::time::Instant>>,
    pub busy: Mutex<HashSet<String>>,
    pub mc_manifest_cache: Mutex<Option<serde_json::Value>>,
    pub modrinth_tags: Mutex<Option<serde_json::Value>>,
    pub translation_cache: Mutex<HashMap<String, String>>,
    pub discord: Mutex<Option<discord_rich_presence::DiscordIpcClient>>,
}

impl AppState {
    pub fn new(data_dir: PathBuf, mica: bool) -> Self {
        let settings: Settings = storage::read_json_or_default(&data_dir.join("settings.json"));
        let instances: Vec<Instance> =
            storage::read_json_or_default(&data_dir.join("instances.json"));
        let mut accounts: AccountStore =
            storage::read_json_or_default(&data_dir.join("accounts.json"));
        // Decrypt at-rest tokens into memory for use during launch.
        for acc in &mut accounts.accounts {
            if let Some(t) = acc.access_token.as_deref() {
                acc.access_token = Some(crate::secure::decrypt(t));
            }
            if let Some(t) = acc.refresh_token.as_deref() {
                acc.refresh_token = Some(crate::secure::decrypt(t));
            }
        }

        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .build()
            .expect("failed to build http client");

        Self {
            data_dir,
            mica,
            http,
            settings: Mutex::new(settings),
            instances: Mutex::new(instances),
            accounts: Mutex::new(accounts),
            children: Mutex::new(HashMap::new()),
            session_start: Mutex::new(HashMap::new()),
            busy: Mutex::new(HashSet::new()),
            mc_manifest_cache: Mutex::new(None),
            modrinth_tags: Mutex::new(None),
            translation_cache: Mutex::new(HashMap::new()),
            discord: Mutex::new(None),
        }
    }

    /// Shared Minecraft data (assets, libraries, versions, runtimes).
    pub fn game_dir(&self) -> PathBuf {
        self.data_dir.join("game")
    }

    /// Root that holds one folder per instance (worlds, mods, configs).
    pub fn instances_dir(&self) -> PathBuf {
        self.data_dir.join("instances")
    }

    /// Resolves the folder of an instance by id. The id is validated (our ids
    /// are always UUIDs) so a malicious value like `..` can never escape the
    /// instances root — several commands delete/write through this path.
    pub fn instance_dir(&self, id: &str) -> Result<PathBuf, String> {
        let valid = !id.is_empty()
            && id.len() <= 64
            && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if !valid {
            return Err("Некорректный идентификатор сборки".into());
        }
        Ok(self.instances_dir().join(id))
    }

    pub fn cache_dir(&self) -> PathBuf {
        self.data_dir.join("cache")
    }

    pub async fn save_settings(&self) -> anyhow::Result<()> {
        let settings = self.settings.lock().await;
        storage::write_json(&self.data_dir.join("settings.json"), &*settings)
    }

    pub async fn save_instances(&self) -> anyhow::Result<()> {
        let instances = self.instances.lock().await;
        storage::write_json(&self.data_dir.join("instances.json"), &*instances)
    }

    pub async fn save_accounts(&self) -> anyhow::Result<()> {
        let accounts = self.accounts.lock().await;
        // Encrypt sensitive tokens before they touch disk.
        let mut to_save = accounts.clone();
        for acc in &mut to_save.accounts {
            if let Some(t) = acc.access_token.as_deref() {
                acc.access_token = Some(crate::secure::encrypt(t));
            }
            if let Some(t) = acc.refresh_token.as_deref() {
                acc.refresh_token = Some(crate::secure::encrypt(t));
            }
        }
        storage::write_json(&self.data_dir.join("accounts.json"), &to_save)
    }
}
