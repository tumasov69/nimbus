use tauri::State;

use super::CmdResult;
use crate::state::AppState;

/// Percent-encodes a query string component.
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Clips text to at most `max` bytes without splitting a UTF-8 character.
fn clip(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Translates one text, English → target. Tries Google's public endpoint first
/// (no daily quota), then falls back to MyMemory. Returns None on failure so the
/// caller keeps the original text. Names must NOT be passed here.
async fn translate_one(state: &AppState, text: &str, target: &str) -> Option<String> {
    if text.trim().is_empty() {
        return Some(text.to_string());
    }
    if let Some(t) = translate_google(state, text, target).await {
        return Some(t);
    }
    translate_mymemory(state, text, target).await
}

/// Google's unofficial `gtx` translate endpoint. No API key, no daily limit, and
/// it accepts much longer inputs than MyMemory. Response is a nested JSON array
/// `[[[ "translated", "original", … ], … ], … ]`; we concatenate every segment.
async fn translate_google(state: &AppState, text: &str, target: &str) -> Option<String> {
    let snippet = clip(text, 1800);
    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={}&dt=t&q={}",
        target,
        encode(snippet)
    );
    let resp = state
        .http
        .get(&url)
        .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;
    let segments = json.get(0)?.as_array()?;
    let mut out = String::new();
    for seg in segments {
        if let Some(s) = seg.get(0).and_then(|v| v.as_str()) {
            out.push_str(s);
        }
    }
    if out.trim().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Fallback: the free MyMemory API. It puts quota/errors in the `translatedText`
/// field instead of failing the request, so we explicitly reject those strings —
/// otherwise the UI would show "MYMEMORY WARNING: YOU USED ALL …" as a translation.
async fn translate_mymemory(state: &AppState, text: &str, target: &str) -> Option<String> {
    let snippet = clip(text, 480);
    let url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair=en|{}",
        encode(snippet),
        target
    );
    let resp = state.http.get(&url).send().await.ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    let translated = json["responseData"]["translatedText"].as_str()?;
    let upper = translated.to_uppercase();
    if translated.trim().is_empty()
        || upper.contains("MYMEMORY WARNING")
        || upper.contains("YOU USED ALL")
        || upper.contains("INVALID LANGUAGE PAIR")
        || upper.contains("QUERY LENGTH LIMIT")
    {
        return None;
    }
    Some(translated.to_string())
}

/// Translates a batch of texts (English → target UI language). Successful
/// results are cached in memory so repeated views never re-request; failures are
/// NOT cached, so a later view retries (e.g. after a transient network error).
/// Falls back to the original text on any failure so the UI never shows blanks.
#[tauri::command]
pub async fn translate_texts(
    state: State<'_, AppState>,
    texts: Vec<String>,
    target: String,
) -> CmdResult<Vec<String>> {
    let target = target.split('-').next().unwrap_or("en").to_lowercase();
    if target == "en" || target.is_empty() {
        return Ok(texts);
    }

    let mut out = Vec::with_capacity(texts.len());
    for text in texts {
        let key = format!("{target}\u{0}{text}");
        if let Some(cached) = state.translation_cache.lock().await.get(&key).cloned() {
            out.push(cached);
            continue;
        }
        let translated = match translate_one(&state, &text, &target).await {
            Some(t) => {
                let mut cache = state.translation_cache.lock().await;
                // Soft cap so the cache can't grow without bound over a long
                // session (each entry is a catalog description).
                if cache.len() >= 20_000 {
                    cache.clear();
                }
                cache.insert(key, t.clone());
                t
            }
            None => text.clone(),
        };
        out.push(translated);
    }
    Ok(out)
}
