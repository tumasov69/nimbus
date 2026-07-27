mod commands;
mod discord;
mod models;
mod secure;
mod state;
mod storage;

use tauri::Manager;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: a second launcher copy would race on
        // instances.json/accounts.json. Focus the existing window instead.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            // A desktop shortcut for an instance re-runs the exe with
            // `--launch <id>`; forward it to the already-running window.
            if let Some(id) = crate::state::parse_launch_arg(args) {
                use tauri::Emitter;
                let _ = app.emit("launch-request", id);
            }
        }))
        // Remember only the maximized state — NOT position or size. The window
        // is configured with `center: true`, so each launch opens centered on
        // the monitor at the comfortable default size (a previous move/resize
        // won't carry over). Visibility is excluded too: the window stays hidden
        // until the UI is ready (no startup flash).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir)?;

            // Native backdrop: Mica (Win11) → Acrylic → none. The frontend
            // keeps a solid background when no effect could be applied.
            let mut mica = false;
            if let Some(win) = app.get_webview_window("main") {
                use tauri::window::{Effect, EffectsBuilder};
                for effect in [Effect::Mica, Effect::Acrylic] {
                    if win
                        .set_effects(EffectsBuilder::new().effect(effect).build())
                        .is_ok()
                    {
                        mica = true;
                        break;
                    }
                }
            }

            eprintln!("[nimbus] native backdrop applied: {mica}");
            app.manage(AppState::new(data_dir, mica));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::get_system_info,
            commands::settings::open_data_folder,
            commands::settings::set_window_theme,
            commands::versions::get_minecraft_versions,
            commands::versions::get_loader_versions,
            commands::instances::list_instances,
            commands::instances::create_instance,
            commands::instances::rename_instance,
            commands::instances::set_instance_overrides,
            commands::instances::set_instance_group,
            commands::instances::clone_instance,
            commands::instances::set_instance_icon,
            commands::instances::repair_instance,
            commands::instances::delete_instance,
            commands::instances::open_instance_folder,
            commands::instances::list_mods,
            commands::instances::toggle_mod,
            commands::instances::delete_mod,
            commands::content::list_worlds,
            commands::content::delete_world,
            commands::content::open_world_folder,
            commands::content::backup_world,
            commands::content::list_servers,
            commands::content::add_server,
            commands::content::remove_server,
            commands::launch::launch_instance,
            commands::launch::kill_instance,
            commands::launch::get_running_instances,
            commands::server_ping::ping_server,
            commands::accounts::get_accounts,
            commands::accounts::add_offline_account,
            commands::accounts::remove_account,
            commands::accounts::set_active_account,
            commands::accounts::login_microsoft,
            commands::accounts::set_skin,
            commands::accounts::set_skin_from_url,
            commands::accounts::get_player_skin,
            commands::accounts::read_image_preview,
            commands::modrinth::modrinth_search,
            commands::modrinth::modrinth_categories,
            commands::modrinth::modrinth_get_project,
            commands::modrinth::modrinth_get_versions,
            commands::modrinth::modrinth_install_version,
            commands::modrinth::modrinth_install_modpack,
            commands::modrinth::import_mrpack,
            commands::modrinth::export_mrpack,
            commands::modrinth::modrinth_enrich_mods,
            commands::modrinth::modrinth_update_mod,
            commands::modrinth::modrinth_check_modpack_update,
            commands::modrinth::modrinth_update_modpack,
            commands::translate::translate_texts,
            commands::tools::list_crash_reports,
            commands::tools::read_crash_report,
            commands::tools::get_disk_usage,
            commands::tools::clear_cache,
            commands::tools::cleanup_unused_versions,
            commands::tools::create_desktop_shortcut,
            commands::tools::scan_external_launchers,
            commands::tools::import_external_instance,
            commands::settings::take_pending_launch,
            commands::instances::install_local_mods,
            commands::modrinth::rollback_mod,
            commands::modrinth::list_mod_backups,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
