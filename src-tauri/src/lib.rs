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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        // Restore size/position but NOT visibility: the window stays hidden
        // until the frontend is ready (prevents the resize flash on startup).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            commands::accounts::get_accounts,
            commands::accounts::add_offline_account,
            commands::accounts::remove_account,
            commands::accounts::set_active_account,
            commands::accounts::login_microsoft,
            commands::accounts::set_skin,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
