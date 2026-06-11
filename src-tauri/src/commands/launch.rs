use std::time::{Duration, Instant};

use lyceris::auth::AuthMethod;
use lyceris::minecraft::{
    config::{Config, ConfigBuilder, Memory, Profile},
    emitter::{Emitter, Event},
    install::install,
    launch::launch,
    loader::{fabric::Fabric, forge::Forge, neoforge::NeoForge, quilt::Quilt, Loader},
};
use tauri::{AppHandle, Emitter as TauriEmitter, Manager, State};

use super::{err_to_string, CmdResult};
use crate::models::{AccountKind, Instance, LoaderKind, Settings};
use crate::state::AppState;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatePayload<'a> {
    instance_id: &'a str,
    state: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn emit_state(app: &AppHandle, id: &str, state: &str, error: Option<String>) {
    let _ = app.emit(
        "instance-state",
        StatePayload {
            instance_id: id,
            state,
            error,
        },
    );
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    instance_id: String,
    kind: String,
    path: String,
    current: u64,
    total: u64,
}

/// Resolves the auth method for the active account, refreshing the
/// Microsoft token when it is expired. Persists the refreshed token.
async fn resolve_auth(state: &AppState) -> Result<AuthMethod, String> {
    let account = {
        let store = state.accounts.lock().await;
        let active_id = store.active.clone().ok_or("Добавьте аккаунт перед запуском")?;
        store
            .accounts
            .iter()
            .find(|a| a.id == active_id)
            .cloned()
            .ok_or("Активный аккаунт не найден")?
    };

    match account.kind {
        AccountKind::Offline => Ok(AuthMethod::Offline {
            username: account.username.clone(),
            uuid: Some(account.uuid.clone()),
        }),
        AccountKind::Microsoft => {
            // Refresh + persist if expired, then re-read the stored account.
            crate::commands::accounts::ensure_ms_token(state, &account.id).await?;
            let account = {
                let store = state.accounts.lock().await;
                store
                    .accounts
                    .iter()
                    .find(|a| a.id == account.id)
                    .cloned()
                    .ok_or("Активный аккаунт не найден")?
            };
            Ok(AuthMethod::Microsoft {
                username: account.username.clone(),
                xuid: account.xuid.clone().unwrap_or_default(),
                uuid: account.uuid.clone(),
                access_token: account.access_token.clone().unwrap_or_default(),
                refresh_token: account.refresh_token.clone().unwrap_or_default(),
            })
        }
    }
}

fn build_config(
    state: &AppState,
    instance: &Instance,
    settings: &Settings,
    auth: AuthMethod,
) -> Config<Box<dyn Loader>> {
    let loader: Box<dyn Loader> = match (&instance.loader, &instance.loader_version) {
        (LoaderKind::Fabric, Some(v)) => Fabric(v.clone()).into(),
        (LoaderKind::Quilt, Some(v)) => Quilt(v.clone()).into(),
        (LoaderKind::Forge, Some(v)) => Forge(v.clone()).into(),
        (LoaderKind::NeoForge, Some(v)) => NeoForge(v.clone()).into(),
        _ => Box::new(()),
    };

    // Per-instance overrides take precedence over the global settings.
    let ov = instance.overrides.clone().unwrap_or_default();
    let memory_mb = ov.memory_mb.unwrap_or(settings.memory_mb);
    let java_args = ov.java_args.clone().unwrap_or_else(|| settings.java_args.clone());
    let fullscreen = ov.fullscreen.unwrap_or(settings.fullscreen);
    let game_width = ov.game_width.unwrap_or(settings.game_width);
    let game_height = ov.game_height.unwrap_or(settings.game_height);

    let mut custom_args: Vec<String> = Vec::new();
    if fullscreen {
        custom_args.push("--fullscreen".into());
    } else if game_width > 0 && game_height > 0 {
        custom_args.extend([
            "--width".into(),
            game_width.to_string(),
            "--height".into(),
            game_height.to_string(),
        ]);
    }

    let custom_java_args: Vec<String> =
        java_args.split_whitespace().map(String::from).collect();

    ConfigBuilder::new(state.game_dir(), instance.mc_version.clone(), auth)
        .memory(Memory::Megabyte(memory_mb))
        .version_name(instance.version_name())
        .profile(Profile::new(instance.id.clone(), state.instances_dir()))
        .custom_java_args(custom_java_args)
        .custom_args(custom_args)
        .client(state.http.clone())
        .loader(loader)
        .build()
}

/// Builds a lyceris emitter that forwards progress and console output
/// to the frontend as Tauri events.
async fn build_emitter(app: AppHandle, instance_id: String) -> Emitter {
    let emitter = Emitter::default();

    {
        let app = app.clone();
        let id = instance_id.clone();
        let last = std::sync::Mutex::new(Instant::now() - Duration::from_secs(1));
        emitter
            .on(
                Event::SingleDownloadProgress,
                move |(path, current, total): (String, u64, u64)| {
                    let mut last = last.lock().unwrap();
                    if last.elapsed() < Duration::from_millis(150) && current != total {
                        return;
                    }
                    *last = Instant::now();
                    let _ = app.emit(
                        "install-progress",
                        ProgressPayload {
                            instance_id: id.clone(),
                            kind: "single".into(),
                            path,
                            current,
                            total,
                        },
                    );
                },
            )
            .await;
    }

    {
        let app = app.clone();
        let id = instance_id.clone();
        let last = std::sync::Mutex::new(Instant::now() - Duration::from_secs(1));
        emitter
            .on(
                Event::MultipleDownloadProgress,
                move |(path, current, total): (String, u64, u64)| {
                    let mut last = last.lock().unwrap();
                    if last.elapsed() < Duration::from_millis(120) && current != total {
                        return;
                    }
                    *last = Instant::now();
                    let _ = app.emit(
                        "install-progress",
                        ProgressPayload {
                            instance_id: id.clone(),
                            kind: "multiple".into(),
                            path,
                            current,
                            total,
                        },
                    );
                },
            )
            .await;
    }

    {
        let app = app.clone();
        let id = instance_id.clone();
        emitter
            .on(Event::Console, move |line: String| {
                let _ = app.emit(
                    "console-line",
                    serde_json::json!({ "instanceId": id, "line": line }),
                );
            })
            .await;
    }

    emitter
}

#[tauri::command]
pub async fn launch_instance(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<()> {
    {
        let mut busy = state.busy.lock().await;
        if busy.contains(&id) || state.children.lock().await.contains_key(&id) {
            return Err("Сборка уже запускается или запущена".into());
        }
        busy.insert(id.clone());
    }

    let result = launch_inner(&app, &state, &id).await;

    state.busy.lock().await.remove(&id);

    if let Err(e) = &result {
        emit_state(&app, &id, "stopped", Some(e.clone()));
    }
    result
}

/// Installs/verifies game files for an instance without launching it.
/// Used by the "repair" action.
pub async fn install_only(app: &AppHandle, state: &AppState, id: &str) -> Result<(), String> {
    {
        let mut busy = state.busy.lock().await;
        if busy.contains(id) || state.children.lock().await.contains_key(id) {
            return Err("Сборка уже запускается или запущена".into());
        }
        busy.insert(id.to_string());
    }

    let result = async {
        let instance = {
            let instances = state.instances.lock().await;
            instances
                .iter()
                .find(|i| i.id == id)
                .cloned()
                .ok_or("Сборка не найдена")?
        };
        let settings = state.settings.lock().await.clone();
        // File verification only downloads game files — it works fine without
        // an account, so fall back to a dummy offline identity.
        let auth = match resolve_auth(state).await {
            Ok(auth) => auth,
            Err(_) => AuthMethod::Offline {
                username: "Player".into(),
                uuid: None,
            },
        };
        let config = build_config(state, &instance, &settings, auth);
        let emitter = build_emitter(app.clone(), id.to_string()).await;
        emit_state(app, id, "installing", None);
        install(&config, Some(&emitter))
            .await
            .map_err(|e| format!("Ошибка установки: {e}"))
    }
    .await;

    state.busy.lock().await.remove(id);
    emit_state(app, id, "stopped", result.as_ref().err().cloned());
    result
}

async fn launch_inner(app: &AppHandle, state: &AppState, id: &str) -> Result<(), String> {
    let instance = {
        let instances = state.instances.lock().await;
        instances
            .iter()
            .find(|i| i.id == id)
            .cloned()
            .ok_or("Сборка не найдена")?
    };
    let settings = state.settings.lock().await.clone();

    emit_state(app, id, "preparing", None);
    let auth = resolve_auth(state).await?;

    let config = build_config(state, &instance, &settings, auth);
    let emitter = build_emitter(app.clone(), id.to_string()).await;

    emit_state(app, id, "installing", None);
    install(&config, Some(&emitter))
        .await
        .map_err(|e| format!("Ошибка установки: {e}"))?;

    emit_state(app, id, "launching", None);
    let child = launch(&config, Some(&emitter))
        .await
        .map_err(|e| format!("Ошибка запуска: {e}"))?;

    state.children.lock().await.insert(id.to_string(), child);

    {
        let mut instances = state.instances.lock().await;
        if let Some(inst) = instances.iter_mut().find(|i| i.id == id) {
            inst.last_played = Some(chrono::Utc::now().to_rfc3339());
        }
    }
    let _ = state.save_instances().await;

    emit_state(app, id, "running", None);

    // Discord Rich Presence (best-effort).
    if settings.discord_rpc {
        crate::discord::set_playing(state, &instance).await;
    }

    if settings.hide_launcher {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.minimize();
        }
    }

    // Watch the process until it exits.
    let app = app.clone();
    let id = id.to_string();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(1000)).await;
            let state = app.state::<AppState>();
            let mut children = state.children.lock().await;
            match children.get_mut(&id) {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => {
                        children.remove(&id);
                        drop(children);
                        // Non-zero exit with no explicit kill = crash.
                        let crashed = !status.success();
                        let payload = if crashed {
                            Some(
                                status
                                    .code()
                                    .map(|c| format!("Игра завершилась с ошибкой (код {c})"))
                                    .unwrap_or_else(|| "Игра аварийно завершилась".into()),
                            )
                        } else {
                            None
                        };
                        emit_state(&app, &id, if crashed { "crashed" } else { "stopped" }, payload);
                        crate::discord::clear(app.state::<AppState>().inner()).await;
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                        break;
                    }
                    Err(_) => {
                        children.remove(&id);
                        drop(children);
                        emit_state(&app, &id, "stopped", None);
                        crate::discord::clear(app.state::<AppState>().inner()).await;
                        break;
                    }
                    Ok(None) => {}
                },
                None => break, // killed via kill_instance
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn kill_instance(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let child = state.children.lock().await.remove(&id);
    match child {
        Some(mut child) => {
            child.kill().await.map_err(err_to_string)?;
            emit_state(&app, &id, "stopped", None);
            crate::discord::clear(&state).await;
            Ok(())
        }
        None => Err("Игра не запущена".into()),
    }
}

/// Returns ids of instances whose game process is currently running.
#[tauri::command]
pub async fn get_running_instances(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    Ok(state.children.lock().await.keys().cloned().collect())
}
