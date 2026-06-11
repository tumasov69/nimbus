use std::sync::{Arc, Mutex as StdMutex};

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use super::{err_to_string, CmdResult};
use crate::models::{Account, AccountKind, AccountStore};
use crate::state::AppState;

#[tauri::command]
pub async fn get_accounts(state: State<'_, AppState>) -> CmdResult<AccountStore> {
    Ok(state.accounts.lock().await.clone())
}

/// Ensures a Microsoft account's access token is fresh, refreshing and
/// persisting it when expired. Returns the valid access token.
pub(crate) async fn ensure_ms_token(
    state: &AppState,
    account_id: &str,
) -> Result<String, String> {
    let account = {
        let store = state.accounts.lock().await;
        store
            .accounts
            .iter()
            .find(|a| a.id == account_id)
            .cloned()
            .ok_or("Аккаунт не найден")?
    };
    if account.kind != AccountKind::Microsoft {
        return Err("Требуется аккаунт Microsoft".into());
    }

    let expired = account
        .exp
        .map(|exp| !lyceris::auth::microsoft::validate(exp))
        .unwrap_or(true);

    if !expired {
        return account
            .access_token
            .ok_or("Нет токена доступа — войдите в аккаунт заново".into());
    }

    let refresh_token = account
        .refresh_token
        .clone()
        .ok_or("Нет refresh-токена, войдите в аккаунт заново")?;
    let refreshed = lyceris::auth::microsoft::refresh(refresh_token, &state.http)
        .await
        .map_err(|e| format!("Не удалось обновить токен Microsoft: {e}"))?;

    {
        let mut store = state.accounts.lock().await;
        if let Some(a) = store.accounts.iter_mut().find(|a| a.id == account_id) {
            a.username = refreshed.username.clone();
            a.uuid = refreshed.uuid.clone();
            a.access_token = Some(refreshed.access_token.clone());
            a.refresh_token = Some(refreshed.refresh_token.clone());
            a.xuid = Some(refreshed.xuid.clone());
            a.exp = Some(refreshed.exp);
        }
    }
    let _ = state.save_accounts().await;
    Ok(refreshed.access_token)
}

/// Reads a small image file as a data URL for previewing (skin files).
#[tauri::command]
pub async fn read_image_preview(path: String) -> CmdResult<String> {
    let meta = tokio::fs::metadata(&path).await.map_err(err_to_string)?;
    if meta.len() > 4 * 1024 * 1024 {
        return Err("Файл слишком большой".into());
    }
    let bytes = tokio::fs::read(&path).await.map_err(err_to_string)?;
    // PNG signature check — skins must be PNG.
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("Файл должен быть PNG".into());
    }
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Changes the Minecraft skin of a Microsoft (licensed) account by uploading
/// an image to the Mojang services API. `variant` is "classic" or "slim".
#[tauri::command]
pub async fn set_skin(
    state: State<'_, AppState>,
    account_id: String,
    file_path: String,
    variant: String,
) -> CmdResult<()> {
    // Tokens live ~24h — refresh transparently so skin upload always works.
    let token = ensure_ms_token(&state, &account_id).await?;

    let bytes = tokio::fs::read(&file_path).await.map_err(err_to_string)?;
    let variant = if variant == "slim" { "slim" } else { "classic" };

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("skin.png")
        .mime_str("image/png")
        .map_err(err_to_string)?;
    let form = reqwest::multipart::Form::new()
        .text("variant", variant)
        .part("file", part);

    let resp = state
        .http
        .post("https://api.minecraftservices.com/minecraft/profile/skins")
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(err_to_string)?;

    if !resp.status().is_success() {
        return Err(format!("Mojang API: HTTP {}", resp.status()));
    }
    Ok(())
}

#[tauri::command]
pub async fn add_offline_account(
    state: State<'_, AppState>,
    username: String,
) -> CmdResult<Account> {
    let username = username.trim().to_string();
    if username.len() < 3
        || username.len() > 16
        || !username.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err("Ник: 3–16 символов, латиница, цифры и _".into());
    }

    // Stable offline UUID derived from the username (matches vanilla offline servers).
    let uuid = uuid::Uuid::new_v5(
        &uuid::Uuid::NAMESPACE_OID,
        format!("OfflinePlayer:{username}").as_bytes(),
    )
    .to_string();

    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        kind: AccountKind::Offline,
        username,
        uuid,
        access_token: None,
        refresh_token: None,
        xuid: None,
        exp: None,
    };

    {
        let mut store = state.accounts.lock().await;
        store.accounts.push(account.clone());
        if store.active.is_none() {
            store.active = Some(account.id.clone());
        }
    }
    state.save_accounts().await.map_err(err_to_string)?;
    Ok(account)
}

#[tauri::command]
pub async fn remove_account(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    {
        let mut store = state.accounts.lock().await;
        store.accounts.retain(|a| a.id != id);
        if store.active.as_deref() == Some(id.as_str()) {
            store.active = store.accounts.first().map(|a| a.id.clone());
        }
    }
    state.save_accounts().await.map_err(err_to_string)
}

#[tauri::command]
pub async fn set_active_account(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    {
        let mut store = state.accounts.lock().await;
        if !store.accounts.iter().any(|a| a.id == id) {
            return Err("Аккаунт не найден".into());
        }
        store.active = Some(id);
    }
    state.save_accounts().await.map_err(err_to_string)
}

/// Opens a Microsoft sign-in window, waits for the OAuth redirect,
/// exchanges the code and stores the resulting account.
#[tauri::command]
pub async fn login_microsoft(app: AppHandle, state: State<'_, AppState>) -> CmdResult<Account> {
    if let Some(existing) = app.get_webview_window("ms-login") {
        let _ = existing.close();
    }

    let auth_url = lyceris::auth::microsoft::create_link().map_err(err_to_string)?;
    let url: tauri::Url = auth_url.parse().map_err(err_to_string)?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let tx = Arc::new(StdMutex::new(Some(tx)));

    let nav_tx = tx.clone();
    let window = WebviewWindowBuilder::new(&app, "ms-login", WebviewUrl::External(url))
        .title("Вход в Microsoft")
        .inner_size(520.0, 680.0)
        .center()
        .on_navigation(move |url| {
            if url
                .as_str()
                .starts_with(lyceris::auth::microsoft::REDIRECT_URI)
            {
                let code = url
                    .query_pairs()
                    .find(|(k, _)| k == "code")
                    .map(|(_, v)| v.into_owned());
                if let Some(tx) = nav_tx.lock().unwrap().take() {
                    let _ = tx.send(code);
                }
                return false;
            }
            true
        })
        .build()
        .map_err(err_to_string)?;

    let close_tx = tx.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Some(tx) = close_tx.lock().unwrap().take() {
                let _ = tx.send(None);
            }
        }
    });

    let code = tokio::time::timeout(std::time::Duration::from_secs(300), rx)
        .await
        .map_err(|_| "Время входа истекло".to_string())?
        .map_err(|_| "Окно входа закрыто".to_string())?
        .ok_or("Вход отменён".to_string())?;

    if let Some(win) = app.get_webview_window("ms-login") {
        let _ = win.close();
    }

    let mc_account = lyceris::auth::microsoft::authenticate(code, &state.http)
        .await
        .map_err(|e| format!("Ошибка авторизации: {e}"))?;

    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        kind: AccountKind::Microsoft,
        username: mc_account.username,
        uuid: mc_account.uuid,
        access_token: Some(mc_account.access_token),
        refresh_token: Some(mc_account.refresh_token),
        xuid: Some(mc_account.xuid),
        exp: Some(mc_account.exp),
    };

    {
        let mut store = state.accounts.lock().await;
        // Replace an existing entry for the same Minecraft profile.
        store
            .accounts
            .retain(|a| !(a.kind == AccountKind::Microsoft && a.uuid == account.uuid));
        store.accounts.push(account.clone());
        store.active = Some(account.id.clone());
    }
    state.save_accounts().await.map_err(err_to_string)?;
    Ok(account)
}
