//! At-rest protection for sensitive account fields (Microsoft tokens).
//! On Windows this uses DPAPI (CryptProtectData) so only the same Windows
//! user can decrypt. Encrypted values are stored as `dpapi:<hex>`.

const PREFIX: &str = "dpapi:";

#[cfg(windows)]
fn dpapi(data: &[u8], protect: bool) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();

        let ok = if protect {
            CryptProtectData(&mut input, None, None, None, None, 0, &mut output)
        } else {
            CryptUnprotectData(&mut input, None, None, None, None, 0, &mut output)
        };
        if ok.is_err() {
            return None;
        }

        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let result = slice.to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
        Some(result)
    }
}

#[cfg(not(windows))]
fn dpapi(_data: &[u8], _protect: bool) -> Option<Vec<u8>> {
    None
}

/// Encrypts a token for storage. Falls back to plaintext if DPAPI is
/// unavailable (e.g. non-Windows), so the app still works.
pub fn encrypt(value: &str) -> String {
    if value.is_empty() {
        return value.to_string();
    }
    match dpapi(value.as_bytes(), true) {
        Some(enc) => format!("{PREFIX}{}", hex::encode(enc)),
        None => value.to_string(),
    }
}

/// Decrypts a stored token. Plaintext (pre-encryption) values pass through.
pub fn decrypt(value: &str) -> String {
    let Some(hexpart) = value.strip_prefix(PREFIX) else {
        return value.to_string();
    };
    let Ok(bytes) = hex::decode(hexpart) else {
        return value.to_string();
    };
    match dpapi(&bytes, false) {
        Some(dec) => String::from_utf8_lossy(&dec).into_owned(),
        None => value.to_string(),
    }
}
