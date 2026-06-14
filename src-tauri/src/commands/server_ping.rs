use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::{err_to_string, CmdResult};

/// Splits an address into (host, port) with the default MC port. Handles
/// "host", "host:port", bracketed IPv6 "[::1]:25565" / "[::1]", and bare IPv6
/// literals like "::1" / "fe80::1" (treated as host-only, default port).
pub fn parse_server_addr(addr: &str) -> (String, u16) {
    let addr = addr.trim();
    // Bracketed IPv6: [host] or [host]:port
    if let Some(rest) = addr.strip_prefix('[') {
        if let Some((host, after)) = rest.split_once(']') {
            let port = after
                .strip_prefix(':')
                .and_then(|p| p.parse().ok())
                .unwrap_or(25565);
            return (host.to_string(), port);
        }
    }
    // Only treat as host:port when there's a single colon, so a bare IPv6
    // literal (multiple colons, no brackets) stays intact as the host.
    if addr.matches(':').count() == 1 {
        if let Some((host, port)) = addr.split_once(':') {
            if let Ok(p) = port.parse::<u16>() {
                return (host.to_string(), p);
            }
        }
    }
    (addr.to_string(), 25565)
}

fn write_varint(buf: &mut Vec<u8>, mut value: i32) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value = ((value as u32) >> 7) as i32;
        if value != 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if value == 0 {
            break;
        }
    }
}

async fn read_varint(stream: &mut TcpStream) -> std::io::Result<i32> {
    let mut result: u32 = 0;
    let mut shift = 0;
    loop {
        let byte = stream.read_u8().await?;
        result |= ((byte & 0x7F) as u32) << shift;
        if byte & 0x80 == 0 {
            return Ok(result as i32);
        }
        shift += 7;
        if shift >= 32 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "varint too long",
            ));
        }
    }
}

/// Recursively flattens a chat-component / legacy MOTD into plain text.
fn flatten_motd(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Object(o) => {
            let mut out = String::new();
            if let Some(t) = o.get("text").and_then(|t| t.as_str()) {
                out.push_str(t);
            }
            if let Some(extra) = o.get("extra").and_then(|e| e.as_array()) {
                for child in extra {
                    out.push_str(&flatten_motd(child));
                }
            }
            out
        }
        _ => String::new(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub online: u32,
    pub max: u32,
    pub version: String,
    pub motd: String,
    /// `data:image/png;base64,…` server icon, if the server provides one.
    pub favicon: Option<String>,
    pub latency_ms: u32,
}

async fn ping_inner(host: &str, port: u16) -> std::io::Result<ServerStatus> {
    let started = Instant::now();
    let mut stream = TcpStream::connect((host, port)).await?;
    let latency_ms = started.elapsed().as_millis() as u32;

    // --- Handshake (next state = 1: status) ---
    let mut hs = Vec::new();
    write_varint(&mut hs, 0x00); // packet id
    write_varint(&mut hs, -1); // protocol version (any)
    write_varint(&mut hs, host.len() as i32);
    hs.extend_from_slice(host.as_bytes());
    hs.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut hs, 1); // next state: status
    let mut framed = Vec::new();
    write_varint(&mut framed, hs.len() as i32);
    framed.extend_from_slice(&hs);
    stream.write_all(&framed).await?;

    // --- Status request (empty) ---
    stream.write_all(&[0x01, 0x00]).await?;

    // --- Status response ---
    let _packet_len = read_varint(&mut stream).await?;
    let _packet_id = read_varint(&mut stream).await?;
    let json_len = read_varint(&mut stream).await?;
    if !(0..=(1 << 21)).contains(&json_len) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "bad response length",
        ));
    }
    let mut buf = vec![0u8; json_len as usize];
    stream.read_exact(&mut buf).await?;
    let json: serde_json::Value = serde_json::from_slice(&buf)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    Ok(ServerStatus {
        online: json["players"]["online"].as_u64().unwrap_or(0) as u32,
        max: json["players"]["max"].as_u64().unwrap_or(0) as u32,
        version: json["version"]["name"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        motd: flatten_motd(&json["description"]),
        // Only accept a data-URL image so a hostile server can't inject arbitrary strings.
        favicon: json["favicon"]
            .as_str()
            .filter(|f| f.starts_with("data:image/"))
            .map(String::from),
        latency_ms,
    })
}

/// Pings a Minecraft server (Server List Ping, 1.7+) and returns its status.
#[tauri::command]
pub async fn ping_server(addr: String) -> CmdResult<ServerStatus> {
    let (host, port) = parse_server_addr(&addr);
    tokio::time::timeout(Duration::from_secs(5), ping_inner(&host, port))
        .await
        .map_err(|_| "Сервер не отвечает".to_string())?
        .map_err(err_to_string)
}
