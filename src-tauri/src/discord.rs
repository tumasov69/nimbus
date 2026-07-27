//! Best-effort Discord Rich Presence. All operations are non-fatal: if
//! Discord isn't running or the client errors, we silently no-op.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

use crate::models::{Instance, LoaderKind};
use crate::state::AppState;

/// Replace with your own Discord application client ID (Developer Portal →
/// Applications) to show a custom name and icon. With a placeholder ID the
/// presence simply won't appear.
const APP_ID: &str = "1249999999999999999";

fn loader_label(loader: LoaderKind) -> &'static str {
    match loader {
        LoaderKind::Vanilla => "Vanilla",
        LoaderKind::Fabric => "Fabric",
        LoaderKind::Quilt => "Quilt",
        LoaderKind::Forge => "Forge",
        LoaderKind::NeoForge => "NeoForge",
    }
}

pub async fn set_playing(state: &AppState, instance: &Instance) {
    let details = instance.name.clone();
    let line = format!(
        "Minecraft {} · {}",
        instance.mc_version,
        loader_label(instance.loader)
    );

    let mut guard = state.discord.lock().await;
    if guard.is_none() {
        if let Ok(mut client) = DiscordIpcClient::new(APP_ID) {
            if client.connect().is_ok() {
                *guard = Some(client);
            }
        }
    }
    if let Some(client) = guard.as_mut() {
        let result = client.set_activity(
            activity::Activity::new()
                .details(&details)
                .state(&line)
                .assets(activity::Assets::new().large_image("nimbus").large_text("Nimbus")),
        );
        // Discord was closed (or restarted) since we connected — drop the dead
        // client so the next launch reconnects instead of silently doing
        // nothing until the launcher itself is restarted.
        if result.is_err() {
            let _ = client.close();
            *guard = None;
        }
    }
}

pub async fn clear(state: &AppState) {
    let mut guard = state.discord.lock().await;
    if let Some(client) = guard.as_mut() {
        let _ = client.clear_activity();
    }
}
