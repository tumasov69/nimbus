use tauri::State;

use super::{err_to_string, CmdResult};
use crate::models::{Instance, InstanceOverrides, LoaderKind};
use crate::state::AppState;

#[tauri::command]
pub async fn list_instances(state: State<'_, AppState>) -> CmdResult<Vec<Instance>> {
    Ok(state.instances.lock().await.clone())
}

#[tauri::command]
pub async fn create_instance(
    state: State<'_, AppState>,
    name: String,
    mc_version: String,
    loader: LoaderKind,
    loader_version: Option<String>,
    quick: Option<bool>,
) -> CmdResult<Instance> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Название сборки не может быть пустым".into());
    }
    if loader != LoaderKind::Vanilla && loader_version.is_none() {
        return Err("Не выбрана версия загрузчика".into());
    }

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
        quick: quick.unwrap_or(false),
    };

    std::fs::create_dir_all(state.instance_dir(&instance.id)?).map_err(err_to_string)?;

    state.instances.lock().await.push(instance.clone());
    state.save_instances().await.map_err(err_to_string)?;
    Ok(instance)
}

/// Recursively copies a directory tree.
fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn clone_instance(state: State<'_, AppState>, id: String) -> CmdResult<Instance> {
    let source = {
        let instances = state.instances.lock().await;
        instances
            .iter()
            .find(|i| i.id == id)
            .cloned()
            .ok_or("Сборка не найдена")?
    };

    let base_name = format!("{} (копия)", source.name);
    let name = {
        let instances = state.instances.lock().await;
        let mut name = base_name.clone();
        let mut n = 2;
        while instances.iter().any(|i| i.name == name) {
            name = format!("{} (копия {n})", source.name);
            n += 1;
        }
        name
    };

    let mut clone = source.clone();
    clone.id = uuid::Uuid::new_v4().to_string();
    clone.name = name;
    clone.created_at = chrono::Utc::now().to_rfc3339();
    clone.last_played = None;
    clone.quick = false;

    // Copy instance files (mods, worlds, configs) — game data is shared.
    let src_dir = state.instance_dir(&id)?;
    let dst_dir = state.instance_dir(&clone.id)?;
    if src_dir.exists() {
        let (s, d) = (src_dir.clone(), dst_dir.clone());
        tokio::task::spawn_blocking(move || copy_dir(&s, &d))
            .await
            .map_err(err_to_string)?
            .map_err(err_to_string)?;
    } else {
        std::fs::create_dir_all(&dst_dir).map_err(err_to_string)?;
    }

    state.instances.lock().await.push(clone.clone());
    state.save_instances().await.map_err(err_to_string)?;
    Ok(clone)
}

/// Sets a custom icon by copying the chosen image into the instance dir.
/// The file gets a unique name so the webview never shows a stale cache.
#[tauri::command]
pub async fn set_instance_icon(
    state: State<'_, AppState>,
    id: String,
    source_path: String,
) -> CmdResult<String> {
    let dir = state.instance_dir(&id)?;
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    let stamp = chrono::Utc::now().timestamp_millis();
    let dest = dir.join(format!("icon_{stamp}.png"));
    std::fs::copy(&source_path, &dest).map_err(err_to_string)?;
    let dest_str = dest.to_string_lossy().into_owned();
    let old = {
        let mut instances = state.instances.lock().await;
        let inst = instances
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or("Сборка не найдена")?;
        let old = inst.icon_path.take();
        inst.icon_path = Some(dest_str.clone());
        old
    };
    state.save_instances().await.map_err(err_to_string)?;
    if let Some(old) = old {
        let _ = std::fs::remove_file(old);
    }
    Ok(dest_str)
}

/// Re-validates and re-downloads any broken/missing game files via lyceris.
#[tauri::command]
pub async fn repair_instance(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<()> {
    crate::commands::launch::install_only(&app, &state, &id).await
}

#[tauri::command]
pub async fn rename_instance(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Название сборки не может быть пустым".into());
    }
    {
        let mut instances = state.instances.lock().await;
        let inst = instances
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or("Сборка не найдена")?;
        inst.name = name;
    }
    state.save_instances().await.map_err(err_to_string)
}

/// Assigns an instance to a folder/group (empty string = ungrouped).
#[tauri::command]
pub async fn set_instance_group(
    state: State<'_, AppState>,
    id: String,
    group: Option<String>,
) -> CmdResult<()> {
    {
        let mut instances = state.instances.lock().await;
        let inst = instances
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or("Сборка не найдена")?;
        inst.group = group.filter(|g| !g.trim().is_empty());
    }
    state.save_instances().await.map_err(err_to_string)
}

#[tauri::command]
pub async fn set_instance_overrides(
    state: State<'_, AppState>,
    id: String,
    overrides: Option<InstanceOverrides>,
) -> CmdResult<()> {
    {
        let mut instances = state.instances.lock().await;
        let inst = instances
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or("Сборка не найдена")?;
        inst.overrides = overrides;
    }
    state.save_instances().await.map_err(err_to_string)
}

#[tauri::command]
pub async fn delete_instance(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    if state.children.lock().await.contains_key(&id) {
        return Err("Сначала остановите игру".into());
    }
    // Reject deletion while an install/repair is writing into the folder —
    // otherwise the task keeps writing into (and re-creating) a removed dir.
    if state.busy.lock().await.contains(&id) {
        return Err("Дождитесь завершения операции".into());
    }
    {
        let mut instances = state.instances.lock().await;
        instances.retain(|i| i.id != id);
    }
    state.save_instances().await.map_err(err_to_string)?;

    let dir = state.instance_dir(&id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(err_to_string)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_instance_folder(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let dir = state.instance_dir(&id)?;
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(err_to_string)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModFile {
    pub file_name: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub enabled: bool,
}

/// Allowed content folders inside an instance.
fn content_folder(folder: Option<&str>) -> Result<&'static str, String> {
    match folder.unwrap_or("mods") {
        "mods" => Ok("mods"),
        "resourcepacks" => Ok("resourcepacks"),
        "shaderpacks" => Ok("shaderpacks"),
        _ => Err("Недопустимая папка".into()),
    }
}

#[tauri::command]
pub async fn list_mods(
    state: State<'_, AppState>,
    id: String,
    folder: Option<String>,
) -> CmdResult<Vec<ModFile>> {
    let folder = content_folder(folder.as_deref())?;
    let dir = state.instance_dir(&id)?.join(folder);
    let jars_only = folder == "mods";
    let mut result = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let enabled = !file_name.ends_with(".disabled");
            if jars_only && !file_name.trim_end_matches(".disabled").ends_with(".jar") {
                continue;
            }
            let display_name = file_name
                .trim_end_matches(".disabled")
                .trim_end_matches(".jar")
                .trim_end_matches(".zip")
                .to_string();
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            result.push(ModFile {
                file_name,
                display_name,
                size_bytes,
                enabled,
            });
        }
    }
    result.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    Ok(result)
}

#[tauri::command]
pub async fn toggle_mod(
    state: State<'_, AppState>,
    id: String,
    file_name: String,
    enabled: bool,
    folder: Option<String>,
) -> CmdResult<()> {
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("Некорректное имя файла".into());
    }
    let dir = state
        .instance_dir(&id)?
        .join(content_folder(folder.as_deref())?);
    let from = dir.join(&file_name);
    let to = if enabled {
        dir.join(file_name.trim_end_matches(".disabled"))
    } else {
        dir.join(format!("{file_name}.disabled"))
    };
    if from != to {
        std::fs::rename(from, to).map_err(err_to_string)?;
    }
    Ok(())
}

/// Copies local files (dragged onto the window, or picked from disk) into a
/// content folder of an instance. Returns the names that were installed.
#[tauri::command]
pub async fn install_local_mods(
    state: State<'_, AppState>,
    id: String,
    paths: Vec<String>,
    folder: Option<String>,
) -> CmdResult<Vec<String>> {
    let dir = state
        .instance_dir(&id)?
        .join(content_folder(folder.as_deref())?);
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;

    let mut installed = Vec::new();
    for path in paths {
        let source = std::path::PathBuf::from(&path);
        let Some(file_name) = source.file_name().map(|n| n.to_string_lossy().into_owned())
        else {
            continue;
        };
        let lower = file_name.to_lowercase();
        // Only real content files; anything else is a mistake worth reporting.
        if !(lower.ends_with(".jar") || lower.ends_with(".zip")) {
            return Err(format!("Не мод и не архив: {file_name}"));
        }
        if !source.is_file() {
            continue;
        }
        tokio::fs::copy(&source, dir.join(&file_name))
            .await
            .map_err(err_to_string)?;
        installed.push(file_name);
    }
    Ok(installed)
}

#[tauri::command]
pub async fn delete_mod(
    state: State<'_, AppState>,
    id: String,
    file_name: String,
    folder: Option<String>,
) -> CmdResult<()> {
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("Некорректное имя файла".into());
    }
    let path = state
        .instance_dir(&id)?
        .join(content_folder(folder.as_deref())?)
        .join(&file_name);
    std::fs::remove_file(path).map_err(err_to_string)
}
