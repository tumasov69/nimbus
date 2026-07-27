//! Utilities around an installed game rather than the game itself: crash
//! diagnostics, disk usage, desktop shortcuts and migration from other
//! launchers.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use super::{err_to_string, CmdResult};
use crate::models::{Instance, LoaderKind};
use crate::state::AppState;

// ---------- shared helpers ----------

/// Recursively sums the size of every file under `path`.
pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            match entry.file_type() {
                Ok(ft) if ft.is_dir() => total += dir_size(&entry.path()),
                Ok(_) => total += entry.metadata().map(|m| m.len()).unwrap_or(0),
                _ => {}
            }
        }
    }
    total
}

/// Rejects names that could escape their folder.
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
}

fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------- crash reports ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub file: String,
    pub modified_ms: i64,
    pub size_bytes: u64,
}

/// Lists `crash-reports/*.txt` for an instance, newest first.
#[tauri::command]
pub async fn list_crash_reports(
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<Vec<CrashReport>> {
    let dir = state.instance_dir(&id)?.join("crash-reports");
    let result = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if !name.ends_with(".txt") {
                    continue;
                }
                let Ok(meta) = entry.metadata() else { continue };
                out.push(CrashReport {
                    file: name,
                    modified_ms: modified_ms(&meta),
                    size_bytes: meta.len(),
                });
            }
        }
        out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
        out
    })
    .await
    .map_err(err_to_string)?;
    Ok(result)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReportDetail {
    pub text: String,
    /// Headline of the crash — the exception line Minecraft reports.
    pub summary: String,
    /// Installed mod files whose name appears in the report, i.e. the ones
    /// worth disabling first.
    pub suspects: Vec<String>,
}

/// A crash report can be megabytes; only the head is useful for diagnosis.
const CRASH_READ_LIMIT: usize = 256 * 1024;

/// Reads a crash report and points at the mods mentioned in it.
#[tauri::command]
pub async fn read_crash_report(
    state: State<'_, AppState>,
    id: String,
    file: String,
) -> CmdResult<CrashReportDetail> {
    if !safe_name(&file) || !file.ends_with(".txt") {
        return Err("Некорректное имя файла".into());
    }
    let instance_dir = state.instance_dir(&id)?;
    let result = tokio::task::spawn_blocking(move || -> Result<CrashReportDetail, String> {
        let path = instance_dir.join("crash-reports").join(&file);
        let bytes = std::fs::read(&path).map_err(err_to_string)?;
        let head = &bytes[..bytes.len().min(CRASH_READ_LIMIT)];
        let text = String::from_utf8_lossy(head).into_owned();

        // "Description:" and the following exception line are the two lines a
        // human actually needs; everything else is stack frames.
        let mut summary = String::new();
        for line in text.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("Description:") {
                summary = rest.trim().to_string();
            } else if summary.is_empty() && line.contains("Exception") && line.contains(':') {
                summary = line.to_string();
                break;
            }
        }
        if summary.is_empty() {
            summary = text
                .lines()
                .find(|l| !l.trim().is_empty() && !l.starts_with("---"))
                .unwrap_or("")
                .trim()
                .to_string();
        }

        // Match installed jars against the report text. Mod ids in stack traces
        // rarely match file names exactly, so compare on a normalized stem.
        let lower = text.to_lowercase();
        let mut suspects = Vec::new();
        if let Ok(entries) = std::fs::read_dir(instance_dir.join("mods")) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if !name.ends_with(".jar") {
                    continue;
                }
                let stem = name.trim_end_matches(".jar");
                // Strip the version tail: "sodium-fabric-0.5.8+mc1.20" -> "sodium-fabric".
                let base: String = stem
                    .split(|c: char| c == '-' || c == '_' || c == '+')
                    .take_while(|part| !part.chars().next().is_some_and(|c| c.is_ascii_digit()))
                    .collect::<Vec<_>>()
                    .join("-");
                let needle = base.trim().to_lowercase();
                if needle.len() >= 4 && lower.contains(&needle) {
                    suspects.push(name);
                }
            }
        }
        suspects.sort();
        suspects.dedup();
        suspects.truncate(8);

        Ok(CrashReportDetail {
            text,
            summary,
            suspects,
        })
    })
    .await
    .map_err(err_to_string)??;
    Ok(result)
}

// ---------- disk usage ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceUsage {
    pub id: String,
    pub name: String,
    pub bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub instances: Vec<InstanceUsage>,
    /// Shared game data (assets, libraries, versions, runtimes).
    pub game_bytes: u64,
    pub cache_bytes: u64,
    pub total_bytes: u64,
    /// Installed game versions no instance refers to any more.
    pub unused_versions: Vec<String>,
    pub unused_version_bytes: u64,
}

#[tauri::command]
pub async fn get_disk_usage(state: State<'_, AppState>) -> CmdResult<DiskUsage> {
    let instances: Vec<(String, String, PathBuf, String)> = {
        let list = state.instances.lock().await;
        list.iter()
            .filter_map(|i| {
                let dir = state.instance_dir(&i.id).ok()?;
                Some((i.id.clone(), i.name.clone(), dir, i.version_name()))
            })
            .collect()
    };
    let game_dir = state.game_dir();
    let cache_dir = state.cache_dir();

    let result = tokio::task::spawn_blocking(move || {
        let used: std::collections::HashSet<String> =
            instances.iter().map(|(_, _, _, v)| v.clone()).collect();

        let mut usage: Vec<InstanceUsage> = instances
            .iter()
            .map(|(id, name, dir, _)| InstanceUsage {
                id: id.clone(),
                name: name.clone(),
                bytes: dir_size(dir),
            })
            .collect();
        usage.sort_by(|a, b| b.bytes.cmp(&a.bytes));

        // Versions on disk that no instance uses any more (left over from
        // deleted instances or version switches).
        let mut unused_versions = Vec::new();
        let mut unused_version_bytes = 0;
        if let Ok(entries) = std::fs::read_dir(game_dir.join("versions")) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                if !used.contains(&name) {
                    unused_version_bytes += dir_size(&entry.path());
                    unused_versions.push(name);
                }
            }
        }
        unused_versions.sort();

        let game_bytes = dir_size(&game_dir);
        let cache_bytes = dir_size(&cache_dir);
        let total_bytes =
            game_bytes + cache_bytes + usage.iter().map(|u| u.bytes).sum::<u64>();

        DiskUsage {
            instances: usage,
            game_bytes,
            cache_bytes,
            total_bytes,
            unused_versions,
            unused_version_bytes,
        }
    })
    .await
    .map_err(err_to_string)?;
    Ok(result)
}

/// Empties the download cache. Returns the number of bytes freed.
#[tauri::command]
pub async fn clear_cache(state: State<'_, AppState>) -> CmdResult<u64> {
    let cache = state.cache_dir();
    let freed = tokio::task::spawn_blocking(move || {
        let size = dir_size(&cache);
        let mut freed = 0;
        if let Ok(entries) = std::fs::read_dir(&cache) {
            for entry in entries.flatten() {
                let path = entry.path();
                let ok = if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    std::fs::remove_dir_all(&path).is_ok()
                } else {
                    std::fs::remove_file(&path).is_ok()
                };
                if !ok {
                    // Something is locked — report only what actually went away.
                    return dir_size_diff(size, &cache);
                }
                freed += 1;
            }
        }
        let _ = freed;
        dir_size_diff(size, &cache)
    })
    .await
    .map_err(err_to_string)?;
    Ok(freed)
}

fn dir_size_diff(before: u64, path: &Path) -> u64 {
    before.saturating_sub(dir_size(path))
}

/// Deletes installed game versions that no instance refers to.
#[tauri::command]
pub async fn cleanup_unused_versions(state: State<'_, AppState>) -> CmdResult<u64> {
    let used: std::collections::HashSet<String> = {
        let list = state.instances.lock().await;
        list.iter().map(|i| i.version_name()).collect()
    };
    // Never touch files while an install is running.
    if !state.busy.lock().await.is_empty() || !state.children.lock().await.is_empty() {
        return Err("Дождитесь завершения операций и закройте игру".into());
    }
    let versions_dir = state.game_dir().join("versions");
    let freed = tokio::task::spawn_blocking(move || {
        let mut freed = 0;
        if let Ok(entries) = std::fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                if used.contains(&name) {
                    continue;
                }
                let path = entry.path();
                let size = dir_size(&path);
                if std::fs::remove_dir_all(&path).is_ok() {
                    freed += size;
                }
            }
        }
        freed
    })
    .await
    .map_err(err_to_string)?;
    Ok(freed)
}

// ---------- desktop shortcut ----------

/// Creates a desktop shortcut that launches this instance directly
/// (`nimbus.exe --launch <id>`).
#[tauri::command]
pub async fn create_desktop_shortcut(
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<String> {
    let instance = {
        let list = state.instances.lock().await;
        list.iter()
            .find(|i| i.id == id)
            .cloned()
            .ok_or("Сборка не найдена")?
    };
    let exe = std::env::current_exe().map_err(err_to_string)?;

    #[cfg(windows)]
    {
        let desktop = dirs_desktop().ok_or("Не удалось найти рабочий стол")?;
        // Keep the file name filesystem-safe.
        let safe: String = instance
            .name
            .chars()
            .map(|c| if r#"\/:*?"<>|"#.contains(c) { '_' } else { c })
            .collect();
        let link = desktop.join(format!("{safe}.lnk"));
        let script = format!(
            r#"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{link}');$s.TargetPath='{exe}';$s.Arguments='--launch {id}';$s.IconLocation='{exe},0';$s.Description='Nimbus';$s.Save()"#,
            link = link.to_string_lossy().replace('\'', "''"),
            exe = exe.to_string_lossy().replace('\'', "''"),
            id = id.replace('\'', "''"),
        );
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .map_err(err_to_string)?;
        if !output.status.success() {
            return Err("Не удалось создать ярлык".into());
        }
        return Ok(link.to_string_lossy().into_owned());
    }

    #[cfg(not(windows))]
    {
        let _ = (instance, exe);
        Err("Ярлыки поддерживаются только в Windows".into())
    }
}

#[cfg(windows)]
fn dirs_desktop() -> Option<PathBuf> {
    let profile = std::env::var_os("USERPROFILE")?;
    let path = PathBuf::from(profile).join("Desktop");
    if path.is_dir() {
        return Some(path);
    }
    // OneDrive-redirected desktop.
    let onedrive = std::env::var_os("OneDrive")?;
    let path = PathBuf::from(onedrive).join("Desktop");
    path.is_dir().then_some(path)
}

// ---------- import from other launchers ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExternalInstance {
    /// "vanilla" | "curseforge" | "prism" | "mmc" | "gdlauncher" | "atlauncher"
    pub source: String,
    pub name: String,
    pub path: String,
    pub mc_version: Option<String>,
    pub loader: Option<LoaderKind>,
    pub loader_version: Option<String>,
    pub mods_count: u32,
    pub worlds_count: u32,
    pub size_bytes: u64,
}

fn count_in(dir: &Path, ext: &str) -> u32 {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .to_lowercase()
                        .ends_with(ext)
                })
                .count() as u32
        })
        .unwrap_or(0)
}

fn count_dirs(dir: &Path) -> u32 {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .count() as u32
        })
        .unwrap_or(0)
}

/// Builds an entry from a game folder (one that has mods/saves inside).
fn describe(source: &str, name: String, path: &Path) -> ExternalInstance {
    ExternalInstance {
        source: source.to_string(),
        name,
        path: path.to_string_lossy().into_owned(),
        mc_version: None,
        loader: None,
        loader_version: None,
        mods_count: count_in(&path.join("mods"), ".jar"),
        worlds_count: count_dirs(&path.join("saves")),
        size_bytes: dir_size(path),
    }
}

fn parse_loader(id: &str) -> Option<(LoaderKind, Option<String>)> {
    let lower = id.to_lowercase();
    if lower.contains("neoforge") {
        Some((LoaderKind::NeoForge, None))
    } else if lower.contains("forge") {
        Some((LoaderKind::Forge, None))
    } else if lower.contains("fabric") {
        Some((LoaderKind::Fabric, None))
    } else if lower.contains("quilt") {
        Some((LoaderKind::Quilt, None))
    } else {
        None
    }
}

/// Scans the machine for instances belonging to other launchers.
#[tauri::command]
pub async fn scan_external_launchers() -> CmdResult<Vec<ExternalInstance>> {
    let result = tokio::task::spawn_blocking(scan_blocking)
        .await
        .map_err(err_to_string)?;
    Ok(result)
}

fn scan_blocking() -> Vec<ExternalInstance> {
    let mut found: Vec<ExternalInstance> = Vec::new();
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);

    // --- Official launcher: a single .minecraft folder ---
    if let Some(appdata) = &appdata {
        let mc = appdata.join(".minecraft");
        if mc.is_dir() && (mc.join("saves").is_dir() || mc.join("mods").is_dir()) {
            let mut entry = describe("vanilla", "Minecraft (.minecraft)".into(), &mc);
            // Newest version folder is a reasonable default.
            if let Ok(versions) = std::fs::read_dir(mc.join("versions")) {
                let mut names: Vec<String> = versions
                    .flatten()
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect();
                names.sort();
                if let Some(last) = names.last() {
                    if let Some((loader, lv)) = parse_loader(last) {
                        entry.loader = Some(loader);
                        entry.loader_version = lv;
                    }
                    // "1.20.1" / "1.20.1-forge-47.2.0" -> "1.20.1"
                    entry.mc_version = last.split('-').next().map(String::from);
                }
            }
            found.push(entry);
        }
    }

    // --- CurseForge ---
    if let Some(home) = &home {
        for root in [
            home.join("curseforge/minecraft/Instances"),
            home.join("Documents/curseforge/minecraft/Instances"),
        ] {
            collect_dir_instances(&mut found, &root, "curseforge", |dir, entry| {
                let meta = dir.join("minecraftinstance.json");
                let Ok(text) = std::fs::read_to_string(meta) else {
                    return;
                };
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
                    return;
                };
                if let Some(name) = json["name"].as_str() {
                    entry.name = name.to_string();
                }
                let target = &json["baseModLoader"];
                entry.mc_version = json["gameVersion"]
                    .as_str()
                    .map(String::from)
                    .or_else(|| target["minecraftVersion"].as_str().map(String::from));
                if let Some(name) = target["name"].as_str() {
                    if let Some((loader, _)) = parse_loader(name) {
                        entry.loader = Some(loader);
                        // "forge-47.2.0" -> "47.2.0"
                        entry.loader_version =
                            name.split('-').nth(1).map(String::from);
                    }
                }
            });
        }
    }

    // --- Prism / MultiMC / PolyMC ---
    if let Some(appdata) = &appdata {
        for (root, source) in [
            (appdata.join("PrismLauncher/instances"), "prism"),
            (appdata.join("PolyMC/instances"), "prism"),
            (appdata.join("MultiMC/instances"), "mmc"),
        ] {
            collect_dir_instances(&mut found, &root, source, |dir, entry| {
                if let Ok(cfg) = std::fs::read_to_string(dir.join("instance.cfg")) {
                    for line in cfg.lines() {
                        if let Some(v) = line.strip_prefix("name=") {
                            entry.name = v.trim().to_string();
                        }
                    }
                }
                if let Ok(text) = std::fs::read_to_string(dir.join("mmc-pack.json")) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                        for comp in json["components"].as_array().unwrap_or(&vec![]) {
                            let uid = comp["uid"].as_str().unwrap_or("");
                            let version = comp["version"].as_str().map(String::from);
                            match uid {
                                "net.minecraft" => entry.mc_version = version,
                                "net.fabricmc.fabric-loader" => {
                                    entry.loader = Some(LoaderKind::Fabric);
                                    entry.loader_version = version;
                                }
                                "org.quiltmc.quilt-loader" => {
                                    entry.loader = Some(LoaderKind::Quilt);
                                    entry.loader_version = version;
                                }
                                "net.minecraftforge" => {
                                    entry.loader = Some(LoaderKind::Forge);
                                    entry.loader_version = version;
                                }
                                "net.neoforged" => {
                                    entry.loader = Some(LoaderKind::NeoForge);
                                    entry.loader_version = version;
                                }
                                _ => {}
                            }
                        }
                    }
                }
            });
        }
    }

    // --- GDLauncher / ATLauncher ---
    if let Some(appdata) = &appdata {
        collect_dir_instances(
            &mut found,
            &appdata.join("gdlauncher_next/instances"),
            "gdlauncher",
            |_, _| {},
        );
    }
    if let Some(home) = &home {
        collect_dir_instances(
            &mut found,
            &home.join("ATLauncher/instances"),
            "atlauncher",
            |_, _| {},
        );
    }

    found.retain(|e| e.mods_count > 0 || e.worlds_count > 0);
    found.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    found.truncate(60);
    found
}

/// Walks `root`, treating each child directory as one instance. `enrich` reads
/// launcher-specific metadata; the game folder may be the directory itself or
/// a `.minecraft` / `minecraft` subfolder.
fn collect_dir_instances(
    out: &mut Vec<ExternalInstance>,
    root: &Path,
    source: &str,
    enrich: impl Fn(&Path, &mut ExternalInstance),
) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let dir = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let game_dir = [".minecraft", "minecraft", ""]
            .iter()
            .map(|sub| if sub.is_empty() { dir.clone() } else { dir.join(sub) })
            .find(|p| p.join("mods").is_dir() || p.join("saves").is_dir());
        let Some(game_dir) = game_dir else { continue };

        let mut item = describe(source, name, &game_dir);
        enrich(&dir, &mut item);
        out.push(item);
    }
}

/// Copies an external instance's game folder into a new Nimbus instance.
#[tauri::command]
pub async fn import_external_instance(
    state: State<'_, AppState>,
    path: String,
    name: String,
    mc_version: String,
    loader: LoaderKind,
    loader_version: Option<String>,
) -> CmdResult<Instance> {
    let source = PathBuf::from(&path);
    if !source.is_dir() {
        return Err("Папка не найдена".into());
    }
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Название сборки не может быть пустым".into());
    }
    if loader != LoaderKind::Vanilla && loader_version.is_none() {
        return Err("Не выбрана версия загрузчика".into());
    }

    let name = {
        let instances = state.instances.lock().await;
        let mut candidate = name.clone();
        let mut n = 2;
        while instances.iter().any(|i| i.name == candidate) {
            candidate = format!("{name} ({n})");
            n += 1;
        }
        candidate
    };

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

    let dest = state.instance_dir(&instance.id)?;
    // Only user content is copied — never the other launcher's engine files.
    const COPY: [&str; 9] = [
        "mods",
        "config",
        "saves",
        "resourcepacks",
        "shaderpacks",
        "screenshots",
        "kubejs",
        "scripts",
        "schematics",
    ];
    const COPY_FILES: [&str; 3] = ["options.txt", "servers.dat", "optionsof.txt"];

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(&dest).map_err(err_to_string)?;
        for folder in COPY {
            let from = source.join(folder);
            if from.is_dir() {
                copy_tree(&from, &dest.join(folder)).map_err(err_to_string)?;
            }
        }
        for file in COPY_FILES {
            let from = source.join(file);
            if from.is_file() {
                let _ = std::fs::copy(&from, dest.join(file));
            }
        }
        Ok(())
    })
    .await
    .map_err(err_to_string)??;

    state.instances.lock().await.push(instance.clone());
    state.save_instances().await.map_err(err_to_string)?;
    Ok(instance)
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}
