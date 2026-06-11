use serde_json::Value;
use tauri::State;

use super::{err_to_string, CmdResult};
use crate::models::LoaderKind;
use crate::state::AppState;

const MC_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McVersion {
    pub id: String,
    pub r#type: String,
}

/// Returns the full Mojang version list (releases + snapshots), newest first.
#[tauri::command]
pub async fn get_minecraft_versions(state: State<'_, AppState>) -> CmdResult<Vec<McVersion>> {
    let mut cache = state.mc_manifest_cache.lock().await;
    if cache.is_none() {
        let disk_cache = state.cache_dir().join("version_manifest.json");
        let fetched: Result<Value, String> = async {
            let resp = state
                .http
                .get(MC_MANIFEST_URL)
                .send()
                .await
                .map_err(err_to_string)?;
            resp.json().await.map_err(err_to_string)
        }
        .await;

        let manifest = match fetched {
            Ok(manifest) => {
                let _ = crate::storage::write_json(&disk_cache, &manifest);
                manifest
            }
            // Offline fallback: use the last fetched manifest.
            Err(e) => match std::fs::read_to_string(&disk_cache)
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            {
                Some(manifest) => manifest,
                None => return Err(e),
            },
        };
        *cache = Some(manifest);
    }

    let manifest = cache.as_ref().unwrap();
    let versions = manifest["versions"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    Some(McVersion {
                        id: v["id"].as_str()?.to_string(),
                        r#type: v["type"].as_str()?.to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(versions)
}

/// Returns available loader versions for a given Minecraft version, newest first.
#[tauri::command]
pub async fn get_loader_versions(
    state: State<'_, AppState>,
    loader: LoaderKind,
    mc_version: String,
) -> CmdResult<Vec<String>> {
    let http = &state.http;
    match loader {
        LoaderKind::Vanilla => Ok(vec![]),
        LoaderKind::Fabric => {
            let url = format!("https://meta.fabricmc.net/v2/versions/loader/{mc_version}");
            let list: Vec<Value> = http
                .get(url)
                .send()
                .await
                .map_err(err_to_string)?
                .json()
                .await
                .map_err(err_to_string)?;
            Ok(list
                .iter()
                .filter_map(|v| v["loader"]["version"].as_str().map(String::from))
                .collect())
        }
        LoaderKind::Quilt => {
            let url = format!("https://meta.quiltmc.org/v3/versions/loader/{mc_version}");
            let list: Vec<Value> = http
                .get(url)
                .send()
                .await
                .map_err(err_to_string)?
                .json()
                .await
                .map_err(err_to_string)?;
            Ok(list
                .iter()
                .filter_map(|v| v["loader"]["version"].as_str().map(String::from))
                // beta loader versions often break — keep them but put stable first
                .collect())
        }
        LoaderKind::NeoForge => {
            let resp: Value = http
                .get("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge")
                .send()
                .await
                .map_err(err_to_string)?
                .json()
                .await
                .map_err(err_to_string)?;
            // MC 1.21.4 -> NeoForge 21.4.x ; MC 1.21 -> 21.0.x
            let parts: Vec<&str> = mc_version.split('.').collect();
            let prefix = match (parts.get(1), parts.get(2)) {
                (Some(minor), Some(patch)) => format!("{minor}.{patch}."),
                (Some(minor), None) => format!("{minor}.0."),
                _ => return Ok(vec![]),
            };
            let mut versions: Vec<String> = resp["versions"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .filter(|v| v.starts_with(&prefix))
                        .map(String::from)
                        .collect()
                })
                .unwrap_or_default();
            versions.reverse();
            Ok(versions)
        }
        LoaderKind::Forge => {
            let resp: Value = http
                .get("https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json")
                .send()
                .await
                .map_err(err_to_string)?
                .json()
                .await
                .map_err(err_to_string)?;
            let mut versions: Vec<String> = resp[&mc_version]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .filter_map(|v| v.strip_prefix(&format!("{mc_version}-")))
                        .map(String::from)
                        .collect()
                })
                .unwrap_or_default();
            versions.reverse();
            Ok(versions)
        }
    }
}
