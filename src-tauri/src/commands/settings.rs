use tauri::State;

use super::{err_to_string, CmdResult};
use crate::models::Settings;
use crate::state::AppState;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> CmdResult<Settings> {
    Ok(state.settings.lock().await.clone())
}

#[tauri::command]
pub async fn save_settings(state: State<'_, AppState>, settings: Settings) -> CmdResult<()> {
    *state.settings.lock().await = settings;
    state.save_settings().await.map_err(err_to_string)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub total_memory_mb: u64,
    pub data_dir: String,
    pub mica: bool,
}

#[tauri::command]
pub async fn get_system_info(state: State<'_, AppState>) -> CmdResult<SystemInfo> {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    Ok(SystemInfo {
        total_memory_mb: sys.total_memory() / 1024 / 1024,
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        mica: state.mica,
    })
}

/// Syncs the native window theme (Mica tint, titlebar) with the app theme.
#[tauri::command]
pub async fn set_window_theme(app: tauri::AppHandle, theme: String) -> CmdResult<()> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        let theme = match theme.as_str() {
            "light" => Some(tauri::Theme::Light),
            "dark" => Some(tauri::Theme::Dark),
            _ => None,
        };
        win.set_theme(theme).map_err(err_to_string)?;
    }
    Ok(())
}

/// Returns (once) the instance id this process was started with via
/// `--launch <id>`, so the UI can play it straight away.
#[tauri::command]
pub async fn take_pending_launch(state: State<'_, AppState>) -> CmdResult<Option<String>> {
    Ok(state.pending_launch.lock().await.take())
}

#[tauri::command]
pub async fn open_data_folder(state: State<'_, AppState>) -> CmdResult<()> {
    let dir = state.data_dir.clone();
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(err_to_string)
}
