use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;

pub fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> T {
    let Ok(text) = std::fs::read_to_string(path) else {
        return T::default();
    };
    match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(e) => {
            // Falling back to the default silently would wipe every instance
            // or account on the next save. Keep the unreadable file so the
            // data can still be recovered by hand.
            eprintln!("[nimbus] {} is not valid JSON: {e}", path.display());
            let backup = path.with_extension("json.corrupt");
            let _ = std::fs::rename(path, &backup);
            T::default()
        }
    }
}

/// Writes JSON atomically (temp file + rename), so a crash or power loss
/// mid-write can never corrupt instances.json/accounts.json — a corrupted
/// file would silently reset to defaults on next start.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(value)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}
