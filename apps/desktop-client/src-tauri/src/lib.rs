#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mcp_tools;
mod visual_automation;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use hmac::{Hmac, Mac};
use reqwest::blocking::Client;
use reqwest::Url;
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use zip::ZipArchive;

type HmacSha256 = Hmac<Sha256>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntimeStatus {
    bundled_runtime_path: String,
    install_runtime_path: String,
    bundled_version: String,
    installed_version: String,
    update_available: bool,
    initialized: bool,
    runtime_ready: bool,
    marker_path: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntimeActionResult {
    ok: bool,
    action: String,
    message: String,
    log: String,
    status: DesktopRuntimeStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopManifestCheckResult {
    ok: bool,
    manifest_url: String,
    key_id: String,
    signature_alg: String,
    signature_verified: bool,
    artifact_url: String,
    artifact_sha256: String,
    version: String,
    channel: String,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn env_bool(name: &str, default_value: bool) -> bool {
    match std::env::var(name) {
        Ok(raw) => {
            let lower = raw.trim().to_lowercase();
            if lower.is_empty() {
                default_value
            } else {
                matches!(lower.as_str(), "1" | "true" | "yes" | "on")
            }
        }
        Err(_) => default_value,
    }
}

fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn read_trimmed(path: &Path) -> String {
    fs::read_to_string(path)
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| String::new())
}

fn parse_version(v: &str) -> Vec<u64> {
    v.trim_start_matches('v')
        .split('.')
        .map(|part| {
            let numeric: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
            numeric.parse::<u64>().unwrap_or(0)
        })
        .collect()
}

fn version_gt(a: &str, b: &str) -> bool {
    let pa = parse_version(a);
    let pb = parse_version(b);
    let max_len = pa.len().max(pb.len());
    for idx in 0..max_len {
        let av = *pa.get(idx).unwrap_or(&0);
        let bv = *pb.get(idx).unwrap_or(&0);
        if av > bv {
            return true;
        }
        if av < bv {
            return false;
        }
    }
    false
}

fn find_bundled_runtime_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(value) = std::env::var("DRAGON_RUNTIME_DIR") {
        let from_env = PathBuf::from(value);
        if from_env.exists() {
            return Some(from_env);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("runtime");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let candidates = vec![
            cwd.join("runtime"),
            cwd.join("../runtime"),
            cwd.join("../../runtime"),
            cwd.join("apps/desktop-client/runtime"),
        ];
        for candidate in candidates {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    None
}

fn install_runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("app_data_dir unavailable: {err}"))?;
    let runtime_dir = app_data.join("dragon-runtime");
    fs::create_dir_all(&runtime_dir).map_err(|err| format!("create runtime dir failed: {err}"))?;
    Ok(runtime_dir)
}

fn marker_path(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join(".onboarded.json")
}

fn runtime_has_core_files(runtime_dir: &Path) -> bool {
    runtime_dir.join("dragon").exists()
        && runtime_dir.join("edge_agent.py").exists()
        && runtime_dir.join("VERSION").exists()
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Err(format!("source not found: {}", src.display()));
    }
    fs::create_dir_all(dst).map_err(|err| format!("create {} failed: {err}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|err| format!("read {} failed: {err}", src.display()))? {
        let entry = entry.map_err(|err| format!("read dir entry failed: {err}"))?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("create parent {} failed: {err}", parent.display()))?;
            }
            fs::copy(&path, &target)
                .map_err(|err| format!("copy {} -> {} failed: {err}", path.display(), target.display()))?;
        }
    }
    Ok(())
}

fn reset_dir(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path).map_err(|err| format!("remove {} failed: {err}", path.display()))?;
    }
    fs::create_dir_all(path).map_err(|err| format!("create {} failed: {err}", path.display()))
}

fn write_marker(runtime_dir: &Path, action: &str, channel: &str) -> Result<(), String> {
    let marker = serde_json::json!({
        "last_action": action,
        "channel": channel,
        "ts": now_epoch_seconds()
    });
    let marker_file = marker_path(runtime_dir);
    fs::write(
        &marker_file,
        serde_json::to_vec_pretty(&marker).map_err(|err| format!("serialize marker failed: {err}"))?,
    )
    .map_err(|err| format!("write marker failed: {err}"))?;
    Ok(())
}

fn build_runtime_status(app: &tauri::AppHandle) -> Result<DesktopRuntimeStatus, String> {
    let bundled_dir = find_bundled_runtime_dir(app);
    let install_dir = install_runtime_dir(app)?;

    let bundled_runtime_path = bundled_dir
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "".to_string());
    let install_runtime_path = install_dir.display().to_string();
    let bundled_version = bundled_dir
        .as_ref()
        .map(|d| read_trimmed(&d.join("VERSION")))
        .unwrap_or_default();
    let installed_version = read_trimmed(&install_dir.join("VERSION"));
    let marker = marker_path(&install_dir);
    let initialized = marker.exists();
    let runtime_ready = runtime_has_core_files(&install_dir);
    let update_available = !bundled_version.is_empty()
        && !installed_version.is_empty()
        && version_gt(&bundled_version, &installed_version);

    let message = if bundled_runtime_path.is_empty() {
        "No bundled runtime resource found. Run runtime:sync first.".to_string()
    } else if !runtime_ready {
        "Bundled runtime is present but local runtime is not initialized.".to_string()
    } else if update_available {
        "New runtime version available. Click update.".to_string()
    } else {
        "Runtime status healthy.".to_string()
    };

    Ok(DesktopRuntimeStatus {
        bundled_runtime_path,
        install_runtime_path,
        bundled_version,
        installed_version,
        update_available,
        initialized,
        runtime_ready,
        marker_path: marker.display().to_string(),
        message,
    })
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted = BTreeMap::new();
            for (k, v) in map {
                sorted.insert(k.clone(), canonicalize(v));
            }
            let mut out = Map::new();
            for (k, v) in sorted {
                out.insert(k, v);
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(canonicalize).collect()),
        _ => value.clone(),
    }
}

fn sha256_hex_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn parse_keys_map(raw: &str) -> Result<Map<String, Value>, String> {
    if raw.trim().is_empty() {
        return Ok(Map::new());
    }
    let parsed: Value = serde_json::from_str(raw).map_err(|err| format!("keys json invalid: {err}"))?;
    match parsed {
        Value::Object(map) => Ok(map),
        _ => Err("keys json must be object".to_string()),
    }
}

fn extract_signature_fields(manifest: &Value) -> (String, String, String) {
    let mut key_id = manifest
        .get("keyId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if key_id.is_empty() {
        key_id = manifest
            .get("key_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
    }

    let mut alg = manifest
        .get("signature_alg")
        .and_then(Value::as_str)
        .unwrap_or("hmac-sha256")
        .to_string();

    let mut sig = manifest
        .get("signature")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if let Some(sig_obj) = manifest.get("signature") {
        if let Some(obj) = sig_obj.as_object() {
            if let Some(v) = obj.get("value").and_then(Value::as_str) {
                sig = v.to_string();
            }
            if let Some(a) = obj.get("alg").and_then(Value::as_str) {
                alg = a.to_string();
            }
            if let Some(k) = obj.get("keyId").and_then(Value::as_str) {
                key_id = k.to_string();
            }
        }
    }

    if key_id.trim().is_empty() {
        key_id = std::env::var("DESKTOP_UPDATE_DEFAULT_KEY_ID")
            .or_else(|_| std::env::var("DRAGON_UPDATE_DEFAULT_KEY_ID"))
            .unwrap_or_else(|_| "default".to_string());
    }

    (key_id, alg.to_lowercase(), sig)
}

fn verify_manifest_signature(
    manifest: &Value,
    require_signature: bool,
    keys: &Map<String, Value>,
) -> Result<(bool, String, String), String> {
    let (key_id, alg, sig_b64) = extract_signature_fields(manifest);
    if sig_b64.trim().is_empty() {
        if require_signature {
            return Err("signature missing".to_string());
        }
        return Ok((false, key_id, alg));
    }

    let key_raw = keys
        .get(&key_id)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("keyId not found: {key_id}"))?
        .to_string();

    if !matches!(alg.as_str(), "hmac-sha256" | "hmac_sha256") {
        return Err(format!("unsupported signature algorithm: {alg}"));
    }

    let mut payload = manifest.clone();
    if let Some(obj) = payload.as_object_mut() {
        obj.remove("signature");
        obj.remove("signature_alg");
        obj.remove("keyId");
        obj.remove("key_id");
    }
    let canonical_payload = canonicalize(&payload);
    let payload_bytes = serde_json::to_vec(&canonical_payload)
        .map_err(|err| format!("canonicalize payload failed: {err}"))?;

    let mut secret = key_raw;
    if secret.starts_with("hmac:") {
        secret = secret.split_at(5).1.to_string();
    }

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|err| format!("hmac init failed: {err}"))?;
    mac.update(&payload_bytes);
    let expected = mac.finalize().into_bytes().to_vec();
    let actual = STANDARD
        .decode(sig_b64.trim().as_bytes())
        .map_err(|err| format!("signature base64 invalid: {err}"))?;

    if expected != actual {
        return Err("signature verify failed".to_string());
    }

    Ok((true, key_id, alg))
}

fn load_manifest(manifest_url: &str) -> Result<Value, String> {
    if manifest_url.starts_with("http://") || manifest_url.starts_with("https://") {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|err| format!("http client init failed: {err}"))?;
        let body = client
            .get(manifest_url)
            .send()
            .and_then(|resp| resp.error_for_status())
            .map_err(|err| format!("manifest fetch failed: {err}"))?
            .text()
            .map_err(|err| format!("manifest read failed: {err}"))?;
        serde_json::from_str(&body).map_err(|err| format!("manifest json invalid: {err}"))
    } else {
        let text = fs::read_to_string(manifest_url)
            .map_err(|err| format!("manifest file read failed: {err}"))?;
        serde_json::from_str(&text).map_err(|err| format!("manifest json invalid: {err}"))
    }
}

fn resolve_artifact_url(manifest: &Value, manifest_url: &str) -> Result<String, String> {
    let artifact = manifest.get("artifact").and_then(Value::as_object).cloned().unwrap_or_default();
    let raw = artifact
        .get("url")
        .and_then(Value::as_str)
        .or_else(|| manifest.get("download_url").and_then(Value::as_str))
        .unwrap_or("")
        .trim()
        .to_string();

    if raw.is_empty() {
        return Err("artifact.url missing in manifest".to_string());
    }

    if raw.starts_with("http://") || raw.starts_with("https://") {
        return Ok(raw);
    }

    if manifest_url.starts_with("http://") || manifest_url.starts_with("https://") {
        let base = Url::parse(manifest_url).map_err(|err| format!("manifest url parse failed: {err}"))?;
        let joined = base.join(&raw).map_err(|err| format!("artifact url join failed: {err}"))?;
        return Ok(joined.to_string());
    }

    let base_path = PathBuf::from(manifest_url)
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "manifest path parent resolve failed".to_string())?;
    Ok(base_path.join(raw).to_string_lossy().to_string())
}

fn read_artifact_bytes(artifact_url: &str) -> Result<Vec<u8>, String> {
    if artifact_url.starts_with("http://") || artifact_url.starts_with("https://") {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|err| format!("http client init failed: {err}"))?;
        let bytes = client
            .get(artifact_url)
            .send()
            .and_then(|resp| resp.error_for_status())
            .map_err(|err| format!("artifact fetch failed: {err}"))?
            .bytes()
            .map_err(|err| format!("artifact read failed: {err}"))?;
        Ok(bytes.to_vec())
    } else {
        let path = PathBuf::from(artifact_url);
        fs::read(path).map_err(|err| format!("artifact file read failed: {err}"))
    }
}

fn extract_zip_to_dir(bytes: &[u8], target_dir: &Path) -> Result<(), String> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut archive = ZipArchive::new(cursor).map_err(|err| format!("zip parse failed: {err}"))?;
    for idx in 0..archive.len() {
        let mut file = archive
            .by_index(idx)
            .map_err(|err| format!("zip entry read failed: {err}"))?;

        let enclosed = file
            .enclosed_name()
            .ok_or_else(|| "zip contains unsafe path".to_string())?
            .to_path_buf();
        let out_path = target_dir.join(enclosed);

        if file.name().ends_with('/') {
            fs::create_dir_all(&out_path)
                .map_err(|err| format!("create dir {} failed: {err}", out_path.display()))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("create parent {} failed: {err}", parent.display()))?;
        }

        let mut out_file = fs::File::create(&out_path)
            .map_err(|err| format!("create file {} failed: {err}", out_path.display()))?;
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)
            .map_err(|err| format!("read zip entry failed: {err}"))?;
        out_file
            .write_all(&buffer)
            .map_err(|err| format!("write file {} failed: {err}", out_path.display()))?;
    }
    Ok(())
}

fn apply_artifact_to_runtime(
    install_dir: &Path,
    artifact_url: &str,
    artifact_bytes: &[u8],
) -> Result<String, String> {
    let lower = artifact_url.to_lowercase();

    if lower.ends_with(".zip") {
        let parent = install_dir
            .parent()
            .ok_or_else(|| "install dir parent missing".to_string())?;
        let tmp_dir = parent.join(format!("dragon-runtime.tmp.{}", now_epoch_seconds()));
        reset_dir(&tmp_dir)?;
        extract_zip_to_dir(artifact_bytes, &tmp_dir)?;

        if !runtime_has_core_files(&tmp_dir) {
            return Err("zip artifact extracted but required runtime files are missing".to_string());
        }

        reset_dir(install_dir)?;
        copy_dir_recursive(&tmp_dir, install_dir)?;
        let _ = fs::remove_dir_all(tmp_dir);
        return Ok("zip_runtime_applied".to_string());
    }

    if lower.ends_with("version") || Path::new(&lower).extension().is_none() {
        fs::create_dir_all(install_dir).map_err(|err| format!("create install dir failed: {err}"))?;
        fs::write(install_dir.join("VERSION"), artifact_bytes)
            .map_err(|err| format!("write VERSION failed: {err}"))?;
        return Ok("version_file_applied".to_string());
    }

    let cache_dir = install_dir.join("updates-cache");
    fs::create_dir_all(&cache_dir).map_err(|err| format!("create updates-cache failed: {err}"))?;
    let file_name = Path::new(artifact_url)
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("artifact.bin");
    let out = cache_dir.join(file_name);
    fs::write(&out, artifact_bytes).map_err(|err| format!("cache artifact failed: {err}"))?;
    Ok(format!("artifact_cached:{}", out.display()))
}

fn extract_artifact_sha(manifest: &Value) -> String {
    manifest
        .get("artifact")
        .and_then(Value::as_object)
        .and_then(|obj| obj.get("sha256"))
        .and_then(Value::as_str)
        .or_else(|| manifest.get("sha256").and_then(Value::as_str))
        .unwrap_or("")
        .trim()
        .to_lowercase()
}

fn default_manifest_url(app: &tauri::AppHandle, channel: &str) -> Result<String, String> {
    if let Ok(v) = std::env::var("DESKTOP_UPDATE_MANIFEST_URL") {
        if !v.trim().is_empty() {
            return Ok(v);
        }
    }
    if let Ok(v) = std::env::var("DRAGON_UPDATE_MANIFEST_URL") {
        if !v.trim().is_empty() {
            return Ok(v);
        }
    }

    if let Some(bundled) = find_bundled_runtime_dir(app) {
        let path = bundled.join("updates").join(format!("{channel}.json"));
        if path.exists() {
            return Ok(path.display().to_string());
        }
    }

    let install = install_runtime_dir(app)?;
    let installed_manifest = install.join("updates").join(format!("{channel}.json"));
    if installed_manifest.exists() {
        return Ok(installed_manifest.display().to_string());
    }

    Err("manifest url not configured and no local manifest found".to_string())
}

#[tauri::command]
fn desktop_runtime_status(app: tauri::AppHandle) -> Result<DesktopRuntimeStatus, String> {
    build_runtime_status(&app)
}

#[tauri::command]
fn desktop_runtime_init(app: tauri::AppHandle) -> Result<DesktopRuntimeActionResult, String> {
    let bundled = find_bundled_runtime_dir(&app)
        .ok_or_else(|| "No bundled runtime found. Run runtime:sync first.".to_string())?;
    let install = install_runtime_dir(&app)?;

    reset_dir(&install)?;
    copy_dir_recursive(&bundled, &install)?;
    write_marker(&install, "init", "stable")?;

    let status = build_runtime_status(&app)?;
    Ok(DesktopRuntimeActionResult {
        ok: true,
        action: "init".to_string(),
        message: "Runtime initialized.".to_string(),
        log: format!("bundled={} -> install={}", bundled.display(), install.display()),
        status,
    })
}

#[tauri::command]
fn desktop_runtime_manifest_check(
    app: tauri::AppHandle,
    channel: Option<String>,
    manifest_url: Option<String>,
    require_signature: Option<bool>,
    keys_json: Option<String>,
) -> Result<DesktopManifestCheckResult, String> {
    let target_channel = channel.unwrap_or_else(|| "stable".to_string());
    let manifest_uri = manifest_url.unwrap_or(default_manifest_url(&app, &target_channel)?);
    let manifest = load_manifest(&manifest_uri)?;
    let require_sig = require_signature.unwrap_or(env_bool("DESKTOP_UPDATE_REQUIRE_SIGNATURE", true));

    let env_keys = std::env::var("DESKTOP_UPDATE_KEYS_JSON")
        .or_else(|_| std::env::var("DRAGON_UPDATE_KEYS_JSON"))
        .unwrap_or_else(|_| "{}".to_string());
    let key_source = keys_json.unwrap_or(env_keys);
    let keys_map = parse_keys_map(&key_source)?;

    let (verified, key_id, sig_alg) = verify_manifest_signature(&manifest, require_sig, &keys_map)?;
    let artifact_url = resolve_artifact_url(&manifest, &manifest_uri)?;
    let artifact_sha = extract_artifact_sha(&manifest);
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let channel_value = manifest
        .get("channel")
        .and_then(Value::as_str)
        .unwrap_or(&target_channel)
        .to_string();

    Ok(DesktopManifestCheckResult {
        ok: true,
        manifest_url: manifest_uri,
        key_id,
        signature_alg: sig_alg,
        signature_verified: verified,
        artifact_url,
        artifact_sha256: artifact_sha,
        version,
        channel: channel_value,
    })
}

#[tauri::command]
fn desktop_runtime_update(
    app: tauri::AppHandle,
    channel: Option<String>,
    manifest_url: Option<String>,
    require_signature: Option<bool>,
    keys_json: Option<String>,
) -> Result<DesktopRuntimeActionResult, String> {
    let target_channel = channel.unwrap_or_else(|| "stable".to_string());
    let before = build_runtime_status(&app)?;
    let install = install_runtime_dir(&app)?;

    let manifest_uri = manifest_url.unwrap_or(default_manifest_url(&app, &target_channel)?);
    let manifest = load_manifest(&manifest_uri)?;

    let require_sig = require_signature.unwrap_or(env_bool("DESKTOP_UPDATE_REQUIRE_SIGNATURE", true));
    let env_keys = std::env::var("DESKTOP_UPDATE_KEYS_JSON")
        .or_else(|_| std::env::var("DRAGON_UPDATE_KEYS_JSON"))
        .unwrap_or_else(|_| "{}".to_string());
    let key_source = keys_json.unwrap_or(env_keys);
    let keys_map = parse_keys_map(&key_source)?;
    let (_verified, key_id, sig_alg) = verify_manifest_signature(&manifest, require_sig, &keys_map)?;

    let manifest_version = manifest
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if !manifest_version.is_empty() && !before.installed_version.is_empty() {
        if !version_gt(&manifest_version, &before.installed_version) {
            let status = build_runtime_status(&app)?;
            return Ok(DesktopRuntimeActionResult {
                ok: true,
                action: "update".to_string(),
                message: "Already on latest runtime version.".to_string(),
                log: format!(
                    "manifest={} version={} installed={} keyId={} alg={}",
                    manifest_uri, manifest_version, before.installed_version, key_id, sig_alg
                ),
                status,
            });
        }
    }

    let artifact_url = resolve_artifact_url(&manifest, &manifest_uri)?;
    let artifact_bytes = read_artifact_bytes(&artifact_url)?;
    let actual_sha = sha256_hex_bytes(&artifact_bytes);
    let expect_sha = extract_artifact_sha(&manifest);
    if !expect_sha.is_empty() && expect_sha != actual_sha {
        return Err(format!(
            "sha256 mismatch: expect={} actual={}",
            expect_sha, actual_sha
        ));
    }

    let apply_msg = apply_artifact_to_runtime(&install, &artifact_url, &artifact_bytes)?;
    if !runtime_has_core_files(&install) {
        return Err("runtime update finished but core files missing".to_string());
    }

    write_marker(&install, "update", &target_channel)?;
    let status = build_runtime_status(&app)?;

    let log = format!(
        "manifest={}\nversion={}\nartifact={}\nsha256={}\nkeyId={}\nalg={}\napply={}",
        manifest_uri,
        manifest_version,
        artifact_url,
        actual_sha,
        key_id,
        sig_alg,
        apply_msg
    );

    Ok(DesktopRuntimeActionResult {
        ok: true,
        action: "update".to_string(),
        message: "Runtime updated with signed manifest verification.".to_string(),
        log,
        status,
    })
}

#[cfg(not(mobile))]
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::TrayIconBuilder,
    };

    let show_item = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "完全退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(move |app_handle, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app_handle.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => app_handle.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            visual_automation::capture_screen_base64,
            visual_automation::execute_input,
            mcp_tools::mcp_tool_publish_video,
            mcp_tools::mcp_tool_read_screen_context,
            desktop_runtime_status,
            desktop_runtime_init,
            desktop_runtime_manifest_check,
            desktop_runtime_update
        ])
        .setup(|app| {
            #[cfg(not(mobile))]
            setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
