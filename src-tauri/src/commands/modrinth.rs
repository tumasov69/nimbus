use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Emitter as TauriEmitter, State};
use tokio::sync::Semaphore;

use super::{err_to_string, CmdResult};
use crate::models::{Instance, LoaderKind, ModpackRef};
use crate::state::AppState;

const API: &str = "https://api.modrinth.com/v2";

/// Guards against decompression bombs in .mrpack archives.
const MAX_ENTRY_SIZE: u64 = 512 * 1024 * 1024; // 512 MB per file
const MAX_TOTAL_EXTRACTED: u64 = 4 * 1024 * 1024 * 1024; // 4 GB per pack

async fn api_get(state: &AppState, url: &str) -> Result<Value, String> {
    let resp = state.http.get(url).send().await.map_err(err_to_string)?;
    if !resp.status().is_success() {
        return Err(format!("Modrinth API: HTTP {}", resp.status()));
    }
    resp.json().await.map_err(err_to_string)
}

async fn api_post(state: &AppState, url: &str, body: Value) -> Result<Value, String> {
    let resp = state
        .http
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(err_to_string)?;
    if !resp.status().is_success() {
        return Err(format!("Modrinth API: HTTP {}", resp.status()));
    }
    resp.json().await.map_err(err_to_string)
}

/// Loaders accepted by an instance (Quilt also runs Fabric mods).
fn compatible_loaders(loader: LoaderKind) -> Vec<&'static str> {
    match loader {
        LoaderKind::Vanilla => vec![],
        LoaderKind::Fabric => vec!["fabric"],
        LoaderKind::Quilt => vec!["quilt", "fabric"],
        LoaderKind::Forge => vec!["forge"],
        LoaderKind::NeoForge => vec!["neoforge"],
    }
}

/// Returns Modrinth category tags for a project type: [{ name, icon }].
#[tauri::command]
pub async fn modrinth_categories(
    state: State<'_, AppState>,
    project_type: String,
) -> CmdResult<Value> {
    let mut cache = state.modrinth_tags.lock().await;
    if cache.is_none() {
        *cache = Some(api_get(&state, &format!("{API}/tag/category")).await?);
    }
    let all = cache.as_ref().unwrap();
    let filtered: Vec<Value> = all
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter(|c| c["project_type"].as_str() == Some(project_type.as_str()))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    Ok(Value::Array(filtered))
}

#[tauri::command]
pub async fn modrinth_search(
    state: State<'_, AppState>,
    query: String,
    project_type: String,
    mc_version: Option<String>,
    loader: Option<LoaderKind>,
    categories: Option<Vec<String>>,
    offset: u32,
    limit: u32,
    index: String,
) -> CmdResult<Value> {
    let mut facets: Vec<Vec<String>> = vec![vec![format!("project_type:{project_type}")]];
    if let Some(v) = mc_version.filter(|v| !v.is_empty()) {
        facets.push(vec![format!("versions:{v}")]);
    }
    // Loader facet only makes sense for mods and modpacks.
    if matches!(project_type.as_str(), "mod" | "modpack") {
        if let Some(l) = loader {
            let names = compatible_loaders(l);
            if !names.is_empty() {
                facets.push(names.iter().map(|n| format!("categories:{n}")).collect());
            }
        }
    }
    // Each selected category is its own facet group (AND semantics).
    for category in categories.unwrap_or_default() {
        if !category.is_empty() {
            facets.push(vec![format!("categories:{category}")]);
        }
    }

    let url = format!(
        "{API}/search?query={}&facets={}&index={}&offset={}&limit={}",
        urlencoding(&query),
        urlencoding(&serde_json::to_string(&facets).unwrap_or_default()),
        index,
        offset,
        limit.min(50),
    );
    api_get(&state, &url).await
}

fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[tauri::command]
pub async fn modrinth_get_project(state: State<'_, AppState>, id: String) -> CmdResult<Value> {
    api_get(&state, &format!("{API}/project/{id}")).await
}

#[tauri::command]
pub async fn modrinth_get_versions(
    state: State<'_, AppState>,
    project_id: String,
    mc_version: Option<String>,
    loader: Option<LoaderKind>,
    filter_loader: bool,
) -> CmdResult<Value> {
    let mut url = format!("{API}/project/{project_id}/version");
    let mut params: Vec<String> = vec![];
    if let Some(v) = mc_version.filter(|v| !v.is_empty()) {
        params.push(format!("game_versions={}", urlencoding(&format!("[\"{v}\"]"))));
    }
    if filter_loader {
        if let Some(l) = loader {
            let names = compatible_loaders(l);
            if !names.is_empty() {
                let arr = serde_json::to_string(&names).unwrap_or_default();
                params.push(format!("loaders={}", urlencoding(&arr)));
            }
        }
    }
    if !params.is_empty() {
        url = format!("{url}?{}", params.join("&"));
    }
    api_get(&state, &url).await
}

fn sha1_hex(data: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// Streams a file through SHA-1 without loading it into memory.
fn sha1_file(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha1::new();
    std::io::copy(&mut std::io::BufReader::new(file), &mut hasher).ok()?;
    Some(hex::encode(hasher.finalize()))
}

/// Fetches a URL with retries and optional sha1 verification. Retries on
/// network/HTTP/hash errors with linear backoff (a moment for blips to clear).
async fn fetch_with_retry(
    http: &reqwest::Client,
    url: &str,
    expected_sha1: Option<&str>,
    attempts: u32,
) -> Result<Vec<u8>, String> {
    let mut last_err = String::new();
    for attempt in 0..attempts {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(400 * attempt as u64)).await;
        }
        match http.get(url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.bytes().await {
                Ok(bytes) => {
                    if let Some(expected) = expected_sha1 {
                        if !sha1_hex(&bytes).eq_ignore_ascii_case(expected) {
                            last_err = format!("Хеш файла не совпадает: {url}");
                            continue;
                        }
                    }
                    return Ok(bytes.to_vec());
                }
                Err(e) => last_err = e.to_string(),
            },
            Ok(resp) => last_err = format!("HTTP {} при загрузке {url}", resp.status()),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(last_err)
}

async fn download_to(
    state: &AppState,
    url: &str,
    dest: &Path,
    expected_sha1: Option<&str>,
) -> Result<(), String> {
    let bytes = fetch_with_retry(&state.http, url, expected_sha1, 3).await?;
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(err_to_string)?;
    }
    tokio::fs::write(dest, &bytes).await.map_err(err_to_string)?;
    Ok(())
}

fn primary_file(version: &Value) -> Option<&Value> {
    let files = version["files"].as_array()?;
    files
        .iter()
        .find(|f| f["primary"].as_bool() == Some(true))
        .or_else(|| files.first())
}

fn project_type_dir(project_type: &str) -> &'static str {
    match project_type {
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        "datapack" => "datapacks",
        _ => "mods",
    }
}

/// Installs a specific Modrinth version (mod / resourcepack / shader) into an
/// instance, resolving required mod dependencies recursively.
#[tauri::command]
pub async fn modrinth_install_version(
    state: State<'_, AppState>,
    instance_id: String,
    version_id: String,
    project_type: String,
) -> CmdResult<Vec<String>> {
    let instance = {
        let instances = state.instances.lock().await;
        instances
            .iter()
            .find(|i| i.id == instance_id)
            .cloned()
            .ok_or("Сборка не найдена")?
    };
    install_version_tree(&state, &instance, version_id, &project_type).await
}

/// Shared install core: downloads a version's primary file (skipping ones
/// already present) and recursively installs required mod dependencies.
async fn install_version_tree(
    state: &AppState,
    instance: &Instance,
    version_id: String,
    project_type: &str,
) -> Result<Vec<String>, String> {
    let target_dir = state
        .instance_dir(&instance.id)?
        .join(project_type_dir(project_type));

    let mut installed: Vec<String> = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: Vec<(String, u8)> = vec![(version_id, 0)];

    while let Some((vid, depth)) = queue.pop() {
        if !visited.insert(vid.clone()) {
            continue;
        }
        let version = api_get(&state, &format!("{API}/version/{vid}")).await?;
        let file = primary_file(&version).ok_or("У версии нет файлов")?;
        let url = file["url"].as_str().ok_or("Нет ссылки на файл")?;
        let filename = file["filename"].as_str().ok_or("Нет имени файла")?;
        if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
            return Err("Некорректное имя файла в версии".into());
        }
        let sha1 = file["hashes"]["sha1"].as_str();

        let dest = target_dir.join(filename);
        if !dest.exists() {
            download_to(&state, url, &dest, sha1).await?;
        }
        installed.push(filename.to_string());

        // Only mods can pull in required dependencies.
        if project_type != "mod" || depth >= 3 {
            continue;
        }
        if let Some(deps) = version["dependencies"].as_array() {
            for dep in deps {
                if dep["dependency_type"].as_str() != Some("required") {
                    continue;
                }
                if let Some(dep_vid) = dep["version_id"].as_str() {
                    queue.push((dep_vid.to_string(), depth + 1));
                } else if let Some(dep_pid) = dep["project_id"].as_str() {
                    if visited.contains(dep_pid) {
                        continue;
                    }
                    visited.insert(dep_pid.to_string());
                    let loaders = compatible_loaders(instance.loader);
                    let arr = serde_json::to_string(&loaders).unwrap_or_default();
                    let url = format!(
                        "{API}/project/{dep_pid}/version?game_versions={}&loaders={}",
                        urlencoding(&format!("[\"{}\"]", instance.mc_version)),
                        urlencoding(&arr)
                    );
                    let versions = api_get(&state, &url).await?;
                    if let Some(first) = versions.as_array().and_then(|a| a.first()) {
                        if let Some(dep_vid) = first["id"].as_str() {
                            queue.push((dep_vid.to_string(), depth + 1));
                        }
                    }
                }
            }
        }
    }

    Ok(installed)
}

/// Modrinth metadata for an installed mod file, matched by sha1.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInfo {
    pub file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_number: Option<String>,
    /// Newer compatible version id, when an update is available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_version_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_version_number: Option<String>,
}

/// Identifies installed mods on Modrinth by file hash and checks for updates.
#[tauri::command]
pub async fn modrinth_enrich_mods(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<Vec<ModInfo>> {
    let instance = {
        let instances = state.instances.lock().await;
        instances
            .iter()
            .find(|i| i.id == instance_id)
            .cloned()
            .ok_or("Сборка не найдена")?
    };
    let mods_dir = state.instance_dir(&instance_id)?.join("mods");

    // Hash every jar on a blocking thread.
    let hash_map: Vec<(String, String)> = {
        let mods_dir = mods_dir.clone();
        tokio::task::spawn_blocking(move || {
            let mut result = Vec::new();
            if let Ok(entries) = std::fs::read_dir(&mods_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if !name.ends_with(".jar") && !name.ends_with(".jar.disabled") {
                        continue;
                    }
                    if let Some(hash) = sha1_file(&entry.path()) {
                        result.push((name, hash));
                    }
                }
            }
            result
        })
        .await
        .map_err(err_to_string)?
    };

    if hash_map.is_empty() {
        return Ok(vec![]);
    }
    let hashes: Vec<&String> = hash_map.iter().map(|(_, h)| h).collect();

    // 1) hash -> installed version
    let versions = api_post(
        &state,
        &format!("{API}/version_files"),
        serde_json::json!({ "hashes": hashes, "algorithm": "sha1" }),
    )
    .await
    .unwrap_or(Value::Null);

    // 2) hash -> latest compatible version
    let loaders = compatible_loaders(instance.loader);
    let updates = if loaders.is_empty() {
        Value::Null
    } else {
        api_post(
            &state,
            &format!("{API}/version_files/update"),
            serde_json::json!({
                "hashes": hashes,
                "algorithm": "sha1",
                "loaders": loaders,
                "game_versions": [instance.mc_version],
            }),
        )
        .await
        .unwrap_or(Value::Null)
    };

    // 3) project metadata (titles, icons)
    let project_ids: Vec<&str> = hash_map
        .iter()
        .filter_map(|(_, h)| versions[h]["project_id"].as_str())
        .collect();
    let projects = if project_ids.is_empty() {
        Value::Null
    } else {
        let ids = serde_json::to_string(&project_ids).unwrap_or_default();
        api_get(&state, &format!("{API}/projects?ids={}", urlencoding(&ids)))
            .await
            .unwrap_or(Value::Null)
    };
    let find_project = |id: &str| -> Option<&Value> {
        projects
            .as_array()?
            .iter()
            .find(|p| p["id"].as_str() == Some(id))
    };

    let mut result = Vec::new();
    for (file_name, hash) in &hash_map {
        let current = &versions[hash];
        let project_id = current["project_id"].as_str();
        let project = project_id.and_then(find_project);

        let latest = &updates[hash];
        let update_available = latest["id"].as_str().is_some()
            && latest["id"].as_str() != current["id"].as_str();

        result.push(ModInfo {
            file_name: file_name.clone(),
            project_id: project_id.map(String::from),
            title: project.and_then(|p| p["title"].as_str()).map(String::from),
            icon_url: project
                .and_then(|p| p["icon_url"].as_str())
                .map(String::from),
            version_number: current["version_number"].as_str().map(String::from),
            update_version_id: update_available
                .then(|| latest["id"].as_str().map(String::from))
                .flatten(),
            update_version_number: update_available
                .then(|| latest["version_number"].as_str().map(String::from))
                .flatten(),
        });
    }
    Ok(result)
}

/// Replaces an installed mod file with a newer Modrinth version.
#[tauri::command]
pub async fn modrinth_update_mod(
    state: State<'_, AppState>,
    instance_id: String,
    file_name: String,
    version_id: String,
) -> CmdResult<String> {
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("Некорректное имя файла".into());
    }
    let mods_dir = state.instance_dir(&instance_id)?.join("mods");
    let was_disabled = file_name.ends_with(".disabled");

    let version = api_get(&state, &format!("{API}/version/{version_id}")).await?;
    let file = primary_file(&version).ok_or("У версии нет файлов")?;
    let url = file["url"].as_str().ok_or("Нет ссылки на файл")?;
    let new_name = file["filename"].as_str().ok_or("Нет имени файла")?;
    if new_name.contains('/') || new_name.contains('\\') || new_name.contains("..") {
        return Err("Некорректное имя файла в версии".into());
    }
    let sha1 = file["hashes"]["sha1"].as_str();

    let final_name = if was_disabled {
        format!("{new_name}.disabled")
    } else {
        new_name.to_string()
    };
    download_to(&state, url, &mods_dir.join(&final_name), sha1).await?;

    let old_path = mods_dir.join(&file_name);
    if final_name != file_name && old_path.exists() {
        let _ = tokio::fs::remove_file(old_path).await;
    }

    // A newer version can require dependencies the old one didn't. Resolve
    // them best-effort (already-present files are skipped); the mod itself is
    // updated either way. Disabled mods don't pull new deps in.
    if !was_disabled {
        let instance = {
            let instances = state.instances.lock().await;
            instances.iter().find(|i| i.id == instance_id).cloned()
        };
        if let Some(instance) = instance {
            let _ = install_version_tree(&state, &instance, version_id, "mod").await;
        }
    }
    Ok(final_name)
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PackProgress {
    instance_id: String,
    stage: String,
    current: u64,
    total: u64,
}

fn emit_pack_progress(app: &AppHandle, id: &str, stage: &str, current: u64, total: u64) {
    let _ = app.emit(
        "modpack-progress",
        PackProgress {
            instance_id: id.to_string(),
            stage: stage.to_string(),
            current,
            total,
        },
    );
}

/// Validates that a relative path from a modpack index stays inside the
/// instance directory.
fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if rel.is_absolute() {
        return Err(format!("Недопустимый путь в модпаке: {relative}"));
    }
    for comp in rel.components() {
        match comp {
            Component::Normal(_) => {}
            _ => return Err(format!("Недопустимый путь в модпаке: {relative}")),
        }
    }
    Ok(base.join(rel))
}

/// Download hosts a modpack index may reference, per the Modrinth .mrpack
/// spec. Blocks a crafted pack from pulling files off arbitrary servers.
fn allowed_pack_url(raw: &str) -> bool {
    let Ok(parsed) = url::Url::parse(raw) else {
        return false;
    };
    parsed.scheme() == "https"
        && matches!(
            parsed.host_str(),
            Some(
                "cdn.modrinth.com"
                    | "cdn-raw.modrinth.com"
                    | "github.com"
                    | "raw.githubusercontent.com"
                    | "gitlab.com"
            )
        )
}

/// Reads modrinth.index.json from a .mrpack archive.
async fn read_pack_index(pack_path: &Path) -> Result<Value, String> {
    let pack_path = pack_path.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<Value, String> {
        let file = std::fs::File::open(&pack_path).map_err(err_to_string)?;
        let mut zip = zip::ZipArchive::new(file).map_err(err_to_string)?;
        let mut entry = zip
            .by_name("modrinth.index.json")
            .map_err(|_| "В архиве нет modrinth.index.json".to_string())?;
        let mut text = String::new();
        std::io::Read::read_to_string(&mut entry, &mut text).map_err(err_to_string)?;
        serde_json::from_str(&text).map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)?
}

/// Extracts loader info from a modrinth.index.json dependencies object.
fn pack_loader(deps: &Value) -> (LoaderKind, Option<String>) {
    if let Some(v) = deps["fabric-loader"].as_str() {
        (LoaderKind::Fabric, Some(v.to_string()))
    } else if let Some(v) = deps["quilt-loader"].as_str() {
        (LoaderKind::Quilt, Some(v.to_string()))
    } else if let Some(v) = deps["neoforge"].as_str() {
        (LoaderKind::NeoForge, Some(v.to_string()))
    } else if let Some(v) = deps["forge"].as_str() {
        (LoaderKind::Forge, Some(v.to_string()))
    } else {
        (LoaderKind::Vanilla, None)
    }
}

/// Picks a unique instance name based on the requested one.
async fn unique_instance_name(state: &AppState, base_name: &str) -> String {
    let instances = state.instances.lock().await;
    let mut name = base_name.to_string();
    let mut n = 2;
    while instances.iter().any(|i| i.name == name) {
        name = format!("{base_name} ({n})");
        n += 1;
    }
    name
}

/// Creates a new instance from a Modrinth modpack version (.mrpack).
#[tauri::command]
pub async fn modrinth_install_modpack(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    version_id: String,
) -> CmdResult<Instance> {
    let project = api_get(&state, &format!("{API}/project/{project_id}")).await?;
    let version = api_get(&state, &format!("{API}/version/{version_id}")).await?;

    let file = primary_file(&version).ok_or("У модпака нет файлов")?;
    let pack_url = file["url"].as_str().ok_or("Нет ссылки на файл модпака")?;
    let pack_sha1 = file["hashes"]["sha1"].as_str();

    // Download the .mrpack into the cache.
    let cache = state.cache_dir();
    let pack_path = cache.join(format!("{version_id}.mrpack"));
    download_to(&state, pack_url, &pack_path, pack_sha1).await?;

    let index = read_pack_index(&pack_path).await?;
    let deps = &index["dependencies"];
    let mc_version = deps["minecraft"]
        .as_str()
        .ok_or("Модпак не указывает версию Minecraft")?
        .to_string();
    let (loader, loader_version) = pack_loader(deps);

    let base_name = project["title"]
        .as_str()
        .or_else(|| index["name"].as_str())
        .unwrap_or("Модпак")
        .to_string();
    let name = unique_instance_name(&state, &base_name).await;

    let instance = Instance {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        mc_version,
        loader,
        loader_version,
        icon_url: project["icon_url"].as_str().map(String::from),
        icon_path: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_played: None,
        total_playtime_secs: 0,
        modpack: Some(ModpackRef {
            project_id,
            version_id: version_id.clone(),
            version_number: version["version_number"].as_str().map(String::from),
            managed_files: Vec::new(),
        }),
        overrides: None,
        group: None,
        quick: false,
    };

    let result = run_pack_install(&app, &state, instance, &index, &pack_path).await;
    let _ = tokio::fs::remove_file(&pack_path).await;
    result
}

/// Imports a local .mrpack file as a new instance.
#[tauri::command]
pub async fn import_mrpack(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<Instance> {
    let pack_path = PathBuf::from(&path);
    if !pack_path.is_file() {
        return Err("Файл не найден".into());
    }
    let index = read_pack_index(&pack_path).await?;
    let deps = &index["dependencies"];
    let mc_version = deps["minecraft"]
        .as_str()
        .ok_or("Модпак не указывает версию Minecraft")?
        .to_string();
    let (loader, loader_version) = pack_loader(deps);

    let base_name = index["name"].as_str().unwrap_or("Модпак").to_string();
    let name = unique_instance_name(&state, &base_name).await;

    let instance = Instance {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        mc_version,
        loader,
        loader_version,
        icon_url: None,
        icon_path: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_played: None,
        total_playtime_secs: 0,
        modpack: None,
        overrides: None,
        group: None,
        quick: false,
    };

    // Keep the user's source file — no cleanup here.
    run_pack_install(&app, &state, instance, &index, &pack_path).await
}

/// Registers the instance, downloads pack files and rolls back on failure.
async fn run_pack_install(
    app: &AppHandle,
    state: &AppState,
    instance: Instance,
    index: &Value,
    pack_path: &Path,
) -> CmdResult<Instance> {
    let instance_dir = state.instance_dir(&instance.id)?;
    std::fs::create_dir_all(&instance_dir).map_err(err_to_string)?;

    state.busy.lock().await.insert(instance.id.clone());
    state.instances.lock().await.push(instance.clone());
    let _ = state.save_instances().await;

    let result = install_pack_files(app, state, &instance, index, pack_path, &instance_dir).await;

    state.busy.lock().await.remove(&instance.id);

    match result {
        Ok(managed) => {
            // Record which files the modpack owns, for clean future updates.
            let mut instance = instance;
            if let Some(pack) = instance.modpack.as_mut() {
                pack.managed_files = managed;
            }
            {
                let mut instances = state.instances.lock().await;
                if let Some(i) = instances.iter_mut().find(|i| i.id == instance.id) {
                    *i = instance.clone();
                }
            }
            let _ = state.save_instances().await;
            emit_pack_progress(app, &instance.id, "done", 1, 1);
            Ok(instance)
        }
        Err(e) => {
            // Roll back the half-installed instance.
            {
                let mut instances = state.instances.lock().await;
                instances.retain(|i| i.id != instance.id);
            }
            let _ = state.save_instances().await;
            let _ = std::fs::remove_dir_all(&instance_dir);
            emit_pack_progress(app, &instance.id, "error", 0, 1);
            Err(e)
        }
    }
}

async fn install_pack_files(
    app: &AppHandle,
    state: &AppState,
    instance: &Instance,
    index: &Value,
    pack_path: &Path,
    instance_dir: &Path,
) -> Result<Vec<String>, String> {
    let empty = vec![];
    let files = index["files"].as_array().unwrap_or(&empty);

    // Plan downloads, skipping server-only files.
    let mut planned: Vec<(String, PathBuf, Option<String>)> = Vec::new();
    let mut managed: Vec<String> = Vec::new();
    for f in files {
        if f["env"]["client"].as_str() == Some("unsupported") {
            continue;
        }
        let rel = f["path"].as_str().ok_or("Файл модпака без пути")?;
        let dest = safe_join(instance_dir, rel)?;
        let url = f["downloads"]
            .as_array()
            .and_then(|d| d.first())
            .and_then(|u| u.as_str())
            .ok_or("Файл модпака без ссылки")?;
        if !allowed_pack_url(url) {
            return Err(format!("Недопустимый источник файла в модпаке: {url}"));
        }
        let sha1 = f["hashes"]["sha1"].as_str().map(String::from);
        managed.push(rel.replace('\\', "/"));
        planned.push((url.to_string(), dest, sha1));
    }

    let total = planned.len() as u64;
    emit_pack_progress(app, &instance.id, "downloading", 0, total.max(1));

    let concurrency = state.settings.lock().await.download_concurrency.clamp(1, 32);
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let done = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let mut tasks = Vec::new();

    for (url, dest, sha1) in planned {
        let semaphore = semaphore.clone();
        let done = done.clone();
        let app = app.clone();
        let http = state.http.clone();
        let instance_id = instance.id.clone();

        tasks.push(tokio::spawn(async move {
            let _permit = semaphore.acquire().await.map_err(err_to_string)?;
            let bytes = fetch_with_retry(&http, &url, sha1.as_deref(), 3).await?;
            if let Some(parent) = dest.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(err_to_string)?;
            }
            tokio::fs::write(&dest, &bytes).await.map_err(err_to_string)?;

            let current = done.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            emit_pack_progress(&app, &instance_id, "downloading", current, total);
            Ok::<(), String>(())
        }));
    }

    for task in tasks {
        task.await.map_err(err_to_string)??;
    }

    // Extract overrides/ and client-overrides/ on a blocking thread.
    emit_pack_progress(app, &instance.id, "extracting", 0, 1);
    {
        let pack_path = pack_path.to_path_buf();
        let instance_dir = instance_dir.to_path_buf();
        let extracted = tokio::task::spawn_blocking(move || -> Result<Vec<String>, String> {
            use std::io::Read;
            let mut managed: Vec<String> = Vec::new();
            let file = std::fs::File::open(&pack_path).map_err(err_to_string)?;
            let mut zip = zip::ZipArchive::new(file).map_err(err_to_string)?;
            let mut total: u64 = 0;
            for i in 0..zip.len() {
                let entry = zip.by_index(i).map_err(err_to_string)?;
                let Some(path) = entry.enclosed_name() else {
                    continue;
                };
                let rel = if let Ok(p) = path.strip_prefix("overrides") {
                    p.to_path_buf()
                } else if let Ok(p) = path.strip_prefix("client-overrides") {
                    p.to_path_buf()
                } else {
                    continue;
                };
                if rel.as_os_str().is_empty() {
                    continue;
                }
                let dest = instance_dir.join(&rel);
                if entry.is_dir() {
                    std::fs::create_dir_all(&dest).map_err(err_to_string)?;
                } else {
                    // Decompression-bomb guard.
                    if entry.size() > MAX_ENTRY_SIZE {
                        return Err("Файл в архиве слишком большой".into());
                    }
                    total = total.saturating_add(entry.size());
                    if total > MAX_TOTAL_EXTRACTED {
                        return Err("Модпак распаковывается в слишком большой размер".into());
                    }
                    if let Some(parent) = dest.parent() {
                        std::fs::create_dir_all(parent).map_err(err_to_string)?;
                    }
                    let mut out = std::fs::File::create(&dest).map_err(err_to_string)?;
                    std::io::copy(&mut entry.take(MAX_ENTRY_SIZE), &mut out)
                        .map_err(err_to_string)?;
                    managed.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
            Ok(managed)
        })
        .await
        .map_err(err_to_string)??;
        managed.extend(extracted);
    }

    Ok(managed)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackUpdate {
    pub version_id: String,
    pub version_number: String,
}

/// Returns the newest modpack version if it differs from the installed one.
#[tauri::command]
pub async fn modrinth_check_modpack_update(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<Option<ModpackUpdate>> {
    check_modpack_update_inner(&state, &instance_id).await
}

async fn check_modpack_update_inner(
    state: &AppState,
    instance_id: &str,
) -> CmdResult<Option<ModpackUpdate>> {
    let pack = {
        let instances = state.instances.lock().await;
        let inst = instances
            .iter()
            .find(|i| i.id == instance_id)
            .ok_or("Сборка не найдена")?;
        match &inst.modpack {
            Some(p) => p.clone(),
            None => return Ok(None),
        }
    };

    let versions = api_get(
        state,
        &format!("{API}/project/{}/version", pack.project_id),
    )
    .await?;
    let latest = versions
        .as_array()
        .and_then(|a| a.first())
        .cloned()
        .unwrap_or(Value::Null);
    let latest_id = match latest["id"].as_str() {
        Some(id) => id.to_string(),
        None => return Ok(None),
    };
    if latest_id == pack.version_id {
        return Ok(None);
    }
    Ok(Some(ModpackUpdate {
        version_id: latest_id,
        version_number: latest["version_number"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    }))
}

/// Updates a modpack instance to a newer version, removing files the old
/// version owned (but leaving user-added mods untouched).
#[tauri::command]
pub async fn modrinth_update_modpack(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<Instance> {
    let (mut instance, pack) = {
        let instances = state.instances.lock().await;
        let inst = instances
            .iter()
            .find(|i| i.id == instance_id)
            .cloned()
            .ok_or("Сборка не найдена")?;
        let pack = inst.modpack.clone().ok_or("Это не модпак Modrinth")?;
        (inst, pack)
    };

    let update = check_modpack_update_inner(&state, &instance_id)
        .await?
        .ok_or("Обновлений нет")?;

    let version = api_get(&state, &format!("{API}/version/{}", update.version_id)).await?;
    let file = primary_file(&version).ok_or("У версии нет файлов")?;
    let pack_url = file["url"].as_str().ok_or("Нет ссылки на файл")?;
    let pack_sha1 = file["hashes"]["sha1"].as_str();

    let pack_path = state.cache_dir().join(format!("{}.mrpack", update.version_id));
    download_to(&state, pack_url, &pack_path, pack_sha1).await?;
    let index = read_pack_index(&pack_path).await?;

    let instance_dir = state.instance_dir(&instance_id)?;
    state.busy.lock().await.insert(instance_id.clone());

    // Remove files owned by the previous modpack version.
    for rel in &pack.managed_files {
        if let Ok(path) = safe_join(&instance_dir, rel) {
            let _ = tokio::fs::remove_file(path).await;
        }
    }

    let result = install_pack_files(&app, &state, &instance, &index, &pack_path, &instance_dir).await;
    state.busy.lock().await.remove(&instance_id);
    let _ = tokio::fs::remove_file(&pack_path).await;

    let managed = result?;
    // Update version + loader info from the new pack.
    let deps = &index["dependencies"];
    let (loader, loader_version) = pack_loader(deps);
    if let Some(mc) = deps["minecraft"].as_str() {
        instance.mc_version = mc.to_string();
    }
    instance.loader = loader;
    instance.loader_version = loader_version;
    instance.modpack = Some(ModpackRef {
        project_id: pack.project_id,
        version_id: update.version_id,
        version_number: Some(update.version_number),
        managed_files: managed,
    });

    {
        let mut instances = state.instances.lock().await;
        if let Some(i) = instances.iter_mut().find(|i| i.id == instance_id) {
            *i = instance.clone();
        }
    }
    let _ = state.save_instances().await;
    emit_pack_progress(&app, &instance_id, "done", 1, 1);
    Ok(instance)
}

/// Exports an instance as a .mrpack: Modrinth-known mods become file
/// references, everything else (configs, unknown jars) goes to overrides/.
#[tauri::command]
pub async fn export_mrpack(
    state: State<'_, AppState>,
    instance_id: String,
    output_path: String,
) -> CmdResult<()> {
    let instance = {
        let instances = state.instances.lock().await;
        instances
            .iter()
            .find(|i| i.id == instance_id)
            .cloned()
            .ok_or("Сборка не найдена")?
    };
    let instance_dir = state.instance_dir(&instance_id)?;

    // Hash mod jars and resolve them on Modrinth.
    let mods_dir = instance_dir.join("mods");
    let jar_hashes: Vec<(String, String)> = {
        let mods_dir = mods_dir.clone();
        tokio::task::spawn_blocking(move || {
            let mut out = Vec::new();
            if let Ok(entries) = std::fs::read_dir(&mods_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if !name.ends_with(".jar") {
                        continue;
                    }
                    if let Some(hash) = sha1_file(&entry.path()) {
                        out.push((name, hash));
                    }
                }
            }
            out
        })
        .await
        .map_err(err_to_string)?
    };

    let resolved = if jar_hashes.is_empty() {
        Value::Null
    } else {
        let hashes: Vec<&String> = jar_hashes.iter().map(|(_, h)| h).collect();
        api_post(
            &state,
            &format!("{API}/version_files"),
            serde_json::json!({ "hashes": hashes, "algorithm": "sha1" }),
        )
        .await
        .unwrap_or(Value::Null)
    };

    // Build the modrinth.index.json files[] from resolved mods.
    let mut files = Vec::new();
    let mut managed_jars = std::collections::HashSet::new();
    for (name, hash) in &jar_hashes {
        let v = &resolved[hash];
        let file = v["files"]
            .as_array()
            .and_then(|fs| fs.iter().find(|f| f["hashes"]["sha1"].as_str() == Some(hash)))
            .or_else(|| primary_file(v));
        if let Some(file) = file {
            if let (Some(url), Some(size)) = (file["url"].as_str(), file["size"].as_u64()) {
                files.push(serde_json::json!({
                    "path": format!("mods/{name}"),
                    "hashes": { "sha1": hash },
                    "downloads": [url],
                    "fileSize": size,
                }));
                managed_jars.insert(name.clone());
            }
        }
    }

    let mut deps = serde_json::Map::new();
    deps.insert("minecraft".into(), Value::String(instance.mc_version.clone()));
    match (instance.loader, &instance.loader_version) {
        (LoaderKind::Fabric, Some(v)) => {
            deps.insert("fabric-loader".into(), Value::String(v.clone()));
        }
        (LoaderKind::Quilt, Some(v)) => {
            deps.insert("quilt-loader".into(), Value::String(v.clone()));
        }
        (LoaderKind::Forge, Some(v)) => {
            deps.insert("forge".into(), Value::String(v.clone()));
        }
        (LoaderKind::NeoForge, Some(v)) => {
            deps.insert("neoforge".into(), Value::String(v.clone()));
        }
        _ => {}
    }

    let index = serde_json::json!({
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": "1.0.0",
        "name": instance.name,
        "files": files,
        "dependencies": deps,
    });

    // Write the archive on a blocking thread: index + overrides for files
    // that aren't Modrinth-managed mods. Write to a temp file first so a
    // failed export never leaves a corrupted .mrpack behind.
    let output = PathBuf::from(&output_path);
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::Write;
        let temp = output.with_extension("mrpack.tmp");
        let file = std::fs::File::create(&temp).map_err(err_to_string)?;
        let mut zip = zip::ZipWriter::new(file);
        let opts: zip::write::FileOptions<()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("modrinth.index.json", opts).map_err(err_to_string)?;
        let index_json = serde_json::to_string_pretty(&index).map_err(err_to_string)?;
        zip.write_all(index_json.as_bytes()).map_err(err_to_string)?;

        // Folders to bundle as overrides (skip Modrinth-managed mod jars).
        for folder in ["config", "mods", "resourcepacks", "shaderpacks", "kubejs", "scripts"] {
            let dir = instance_dir.join(folder);
            if !dir.is_dir() {
                continue;
            }
            add_dir_to_zip(&mut zip, &dir, &instance_dir, &managed_jars, opts)?;
        }
        zip.finish().map_err(err_to_string)?;
        std::fs::rename(&temp, &output).map_err(err_to_string)?;
        Ok(())
    })
    .await
    .map_err(err_to_string)??;

    Ok(())
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    dir: &Path,
    base: &Path,
    managed_jars: &std::collections::HashSet<String>,
    opts: zip::write::FileOptions<()>,
) -> Result<(), String> {
    use std::io::Write;
    let entries = std::fs::read_dir(dir).map_err(err_to_string)?;
    for entry in entries.flatten() {
        let path = entry.path();
        let file_type = entry.file_type().map_err(err_to_string)?;
        if file_type.is_dir() {
            add_dir_to_zip(zip, &path, base, managed_jars, opts)?;
        } else {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Modrinth-managed jars are referenced by URL, not bundled.
            if managed_jars.contains(&name) {
                continue;
            }
            if name.ends_with(".disabled") {
                continue;
            }
            let rel = path.strip_prefix(base).map_err(err_to_string)?;
            let zip_path = format!("overrides/{}", rel.to_string_lossy().replace('\\', "/"));
            zip.start_file(zip_path, opts).map_err(err_to_string)?;
            let data = std::fs::read(&path).map_err(err_to_string)?;
            zip.write_all(&data).map_err(err_to_string)?;
        }
    }
    Ok(())
}
