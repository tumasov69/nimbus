use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::{err_to_string, CmdResult};
use crate::state::AppState;

// ---------- Worlds ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    pub folder: String,
    pub name: String,
    pub size_bytes: u64,
    pub last_played: Option<i64>,
}

#[derive(Deserialize)]
struct LevelRoot {
    #[serde(rename = "Data")]
    data: LevelData,
}

#[derive(Deserialize)]
struct LevelData {
    #[serde(rename = "LevelName")]
    level_name: Option<String>,
    #[serde(rename = "LastPlayed")]
    last_played: Option<i64>,
}

fn dir_size(path: &Path) -> u64 {
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

/// Reads world name + last-played from a gzip-compressed level.dat.
fn read_level_dat(level_dat: &Path) -> (Option<String>, Option<i64>) {
    let Ok(bytes) = std::fs::read(level_dat) else {
        return (None, None);
    };
    let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
    let mut decompressed = Vec::new();
    if decoder.read_to_end(&mut decompressed).is_err() {
        return (None, None);
    }
    match fastnbt::from_bytes::<LevelRoot>(&decompressed) {
        Ok(root) => (root.data.level_name, root.data.last_played),
        Err(_) => (None, None),
    }
}

#[tauri::command]
pub async fn list_worlds(state: State<'_, AppState>, id: String) -> CmdResult<Vec<WorldInfo>> {
    let saves = state.instance_dir(&id).join("saves");
    let result = tokio::task::spawn_blocking(move || {
        let mut worlds = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&saves) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let path = entry.path();
                let folder = entry.file_name().to_string_lossy().into_owned();
                let (name, last_played) = read_level_dat(&path.join("level.dat"));
                worlds.push(WorldInfo {
                    name: name.unwrap_or_else(|| folder.clone()),
                    folder,
                    size_bytes: dir_size(&path),
                    last_played,
                });
            }
        }
        worlds.sort_by(|a, b| b.last_played.cmp(&a.last_played));
        worlds
    })
    .await
    .map_err(err_to_string)?;
    Ok(result)
}

fn valid_folder(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
}

#[tauri::command]
pub async fn delete_world(
    state: State<'_, AppState>,
    id: String,
    folder: String,
) -> CmdResult<()> {
    if !valid_folder(&folder) {
        return Err("Некорректная папка".into());
    }
    let path = state.instance_dir(&id).join("saves").join(&folder);
    if path.is_dir() {
        tokio::fs::remove_dir_all(path).await.map_err(err_to_string)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_world_folder(
    state: State<'_, AppState>,
    id: String,
    folder: String,
) -> CmdResult<()> {
    if !valid_folder(&folder) {
        return Err("Некорректная папка".into());
    }
    let path = state.instance_dir(&id).join("saves").join(&folder);
    tauri_plugin_opener::open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(err_to_string)
}

/// Zips a world folder to the chosen destination.
#[tauri::command]
pub async fn backup_world(
    state: State<'_, AppState>,
    id: String,
    folder: String,
    output_path: String,
) -> CmdResult<()> {
    if !valid_folder(&folder) {
        return Err("Некорректная папка".into());
    }
    let world_dir = state.instance_dir(&id).join("saves").join(&folder);
    if !world_dir.is_dir() {
        return Err("Мир не найден".into());
    }
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let out = std::fs::File::create(&output_path).map_err(err_to_string)?;
        let mut zip = zip::ZipWriter::new(out);
        let opts: zip::write::FileOptions<()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip_dir(&mut zip, &world_dir, &world_dir, opts)?;
        zip.finish().map_err(err_to_string)?;
        Ok(())
    })
    .await
    .map_err(err_to_string)??;
    Ok(())
}

fn zip_dir(
    zip: &mut zip::ZipWriter<std::fs::File>,
    dir: &Path,
    base: &Path,
    opts: zip::write::FileOptions<()>,
) -> Result<(), String> {
    use std::io::Write;
    for entry in std::fs::read_dir(dir).map_err(err_to_string)?.flatten() {
        let path = entry.path();
        if entry.file_type().map_err(err_to_string)?.is_dir() {
            zip_dir(zip, &path, base, opts)?;
        } else {
            let rel = path.strip_prefix(base).map_err(err_to_string)?;
            zip.start_file(rel.to_string_lossy().replace('\\', "/"), opts)
                .map_err(err_to_string)?;
            let data = std::fs::read(&path).map_err(err_to_string)?;
            zip.write_all(&data).map_err(err_to_string)?;
        }
    }
    Ok(())
}

// ---------- Servers (servers.dat NBT) ----------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    pub name: String,
    pub ip: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct ServersFile {
    #[serde(default)]
    servers: Vec<ServerEntry>,
}

#[tauri::command]
pub async fn list_servers(state: State<'_, AppState>, id: String) -> CmdResult<Vec<ServerEntry>> {
    let path = state.instance_dir(&id).join("servers.dat");
    let result = tokio::task::spawn_blocking(move || {
        let Ok(bytes) = std::fs::read(&path) else {
            return Vec::new();
        };
        // servers.dat is uncompressed NBT.
        fastnbt::from_bytes::<ServersFile>(&bytes)
            .map(|f| f.servers)
            .unwrap_or_default()
    })
    .await
    .map_err(err_to_string)?;
    Ok(result)
}

async fn write_servers(path: std::path::PathBuf, servers: Vec<ServerEntry>) -> CmdResult<()> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = ServersFile { servers };
        let bytes = fastnbt::to_bytes(&file).map_err(err_to_string)?;
        std::fs::write(&path, bytes).map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn add_server(
    state: State<'_, AppState>,
    id: String,
    name: String,
    ip: String,
) -> CmdResult<Vec<ServerEntry>> {
    let name = name.trim().to_string();
    let ip = ip.trim().to_string();
    if name.is_empty() || ip.is_empty() {
        return Err("Заполните название и адрес".into());
    }
    let mut servers = list_servers(state.clone(), id.clone()).await?;
    servers.push(ServerEntry { name, ip, icon: None });
    write_servers(state.instance_dir(&id).join("servers.dat"), servers.clone()).await?;
    Ok(servers)
}

#[tauri::command]
pub async fn remove_server(
    state: State<'_, AppState>,
    id: String,
    index: usize,
) -> CmdResult<Vec<ServerEntry>> {
    let mut servers = list_servers(state.clone(), id.clone()).await?;
    if index < servers.len() {
        servers.remove(index);
    }
    write_servers(state.instance_dir(&id).join("servers.dat"), servers.clone()).await?;
    Ok(servers)
}
