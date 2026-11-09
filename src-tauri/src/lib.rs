// RoniTube Downloader — Rust backend
// All downloading is done by the yt-dlp binary (bundled sidecar, a copy the
// app downloaded on first run, or yt-dlp from the system PATH — in that order).
// ffmpeg is used by yt-dlp to merge video+audio and to extract MP3 audio.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct AppState {
    jobs: Mutex<HashMap<String, Child>>,
    cancelled: Mutex<HashSet<String>>,
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    id: String,
    status: String,
    percent: f64,
    speed: String,
    eta: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// ---------------------------------------------------------------------------
// Binary lookup
// ---------------------------------------------------------------------------

fn exe_name(base: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// Look for a tool binary: 1) next to the app executable (bundled sidecar),
/// 2) in the app-data "bin" folder (downloaded by the app), 3) on the PATH.
fn find_binary(app: &AppHandle, base: &str) -> Option<PathBuf> {
    let name = exe_name(base);
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(&name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    if let Ok(data) = app.path().app_data_dir() {
        let p = data.join("bin").join(&name);
        if p.exists() {
            return Some(p);
        }
    }
    // PATH fallback: just hand the bare name to Command.
    let probe = Command::new(&name).arg("--version").output();
    if let Ok(out) = probe {
        if out.status.success() || !out.stdout.is_empty() {
            return Some(PathBuf::from(name));
        }
    }
    None
}

fn ytdlp(app: &AppHandle) -> Result<PathBuf, String> {
    find_binary(app, "yt-dlp")
        .ok_or_else(|| "yt-dlp not found. Use the \"Install yt-dlp\" button or install yt-dlp on your system PATH.".to_string())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn fmt_size(bytes: f64) -> String {
    if bytes <= 0.0 {
        return "—".to_string();
    }
    let units = ["B", "KB", "MB", "GB"];
    let mut v = bytes;
    let mut i = 0;
    while v >= 1024.0 && i < units.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    format!("{:.1} {}", v, units[i])
}

fn fnum(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}

fn run_ytdlp_json_once(app: &AppHandle, args: &[&str]) -> Result<Value, String> {
    let bin = ytdlp(app)?;
    let out = Command::new(&bin)
        .args(args)
        .output()
        .map_err(|e| format!("Could not run yt-dlp: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let tail: String = err.lines().rev().take(3).collect::<Vec<_>>().join(" ");
        return Err(format!("yt-dlp error: {tail}"));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("Could not read video info: {e}"))
}

/// Run yt-dlp for metadata. If YouTube blocks the default client on this
/// network (the common "Sign in to confirm you're not a bot" error), retry
/// once with alternate player clients — this fixes fetching on many IPs.
fn run_ytdlp_json(app: &AppHandle, args: &[&str]) -> Result<Value, String> {
    match run_ytdlp_json_once(app, args) {
        Ok(v) => Ok(v),
        Err(first_err) => {
            let mut retry: Vec<&str> = args.to_vec();
            retry.push("--extractor-args");
            retry.push("youtube:player_client=web_safari,ios,android_vr,tv");
            retry.push("--ignore-no-formats-error");
            run_ytdlp_json_once(app, &retry).map_err(|_| {
                format!("{first_err} Tip: if YouTube keeps blocking, try again later or from a different network.")
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn tools_status(app: AppHandle) -> Value {
    let yt = find_binary(&app, "yt-dlp");
    let ff = find_binary(&app, "ffmpeg");
    let version = yt.as_ref().and_then(|p| {
        Command::new(p)
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            })
    });
    json!({
        "yt_dlp": yt.is_some(),
        "ffmpeg": ff.is_some(),
        "version": version,
    })
}

#[tauri::command]
fn default_download_dir(app: AppHandle) -> String {
    app.path()
        .download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Download the official yt-dlp binary into the app-data folder (first-run setup).
#[tauri::command]
async fn download_ytdlp(app: AppHandle) -> Result<String, String> {
    let asset = if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else {
        "yt-dlp_linux"
    };
    let url = format!("https://github.com/yt-dlp/yt-dlp/releases/latest/download/{asset}");
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bin");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(exe_name("yt-dlp"));
    let status = Command::new("curl")
        .args(["-L", "-o"])
        .arg(&dest)
        .arg(&url)
        .status()
        .map_err(|e| format!("curl failed: {e}"))?;
    if !status.success() {
        return Err("Downloading yt-dlp failed — check your internet connection.".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    }
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_info(app: AppHandle, url: String) -> Result<Value, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Please paste a YouTube link first.".to_string());
    }
    let looks_playlist = url.contains("list=") || url.contains("/playlist");

    if looks_playlist {
        let data = run_ytdlp_json(
            &app,
            &[
                "--dump-single-json",
                "--flat-playlist",
                "--yes-playlist",
                "--no-warnings",
                &url,
            ],
        )?;
        if data.get("_type").and_then(|v| v.as_str()) == Some("playlist") {
            let empty = Vec::new();
            let raw = data
                .get("entries")
                .and_then(|v| v.as_array())
                .unwrap_or(&empty);
            let mut entries = Vec::new();
            let mut first_thumb = String::new();
            for e in raw {
                let id = e
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if id.is_empty() {
                    continue;
                }
                let video_url = e
                    .get("url")
                    .and_then(|v| v.as_str())
                    .filter(|u| u.starts_with("http"))
                    .map(|u| u.to_string())
                    .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={id}"));
                let thumb = e
                    .get("thumbnails")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.last())
                    .and_then(|t| t.get("url"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if first_thumb.is_empty() && !thumb.is_empty() {
                    first_thumb = thumb.clone();
                }
                entries.push(json!({
                    "id": id,
                    "title": e.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled video"),
                    "duration": fnum(e, "duration"),
                    "url": video_url,
                    "thumbnail": thumb,
                }));
            }
            return Ok(json!({
                "kind": "playlist",
                "title": data.get("title").and_then(|v| v.as_str()).unwrap_or("Playlist"),
                "thumbnail": first_thumb,
                "entries": entries,
            }));
        }
        // Not actually a playlist — fall through and treat as a single video.
    }

    let data = run_ytdlp_json(
        &app,
        &["--dump-single-json", "--no-playlist", "--no-warnings", &url],
    )?;

    let empty = Vec::new();
    let formats = data
        .get("formats")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);

    // Best audio size (used to estimate merged video sizes).
    let mut best_audio_size = 0.0f64;
    // Audio-only options.
    let mut audio_map: BTreeMap<i64, Value> = BTreeMap::new();
    for f in formats {
        let acodec = f.get("acodec").and_then(|v| v.as_str()).unwrap_or("none");
        let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
        if acodec == "none" {
            continue;
        }
        let size = fnum(f, "filesize")
            .or_else(|| fnum(f, "filesize_approx"))
            .unwrap_or(0.0);
        if vcodec == "none" {
            if size > best_audio_size {
                best_audio_size = size;
            }
            let abr = fnum(f, "abr").unwrap_or(0.0).round() as i64;
            if abr > 0 {
                let ext = f.get("ext").and_then(|v| v.as_str()).unwrap_or("");
                audio_map.insert(
                    abr,
                    json!({
                        "format_id": f.get("format_id").and_then(|v| v.as_str()).unwrap_or(""),
                        "label": format!("Audio • {} kbps ({})", abr, ext),
                        "size_text": fmt_size(size),
                    }),
                );
            }
        }
    }
    // Highest bitrate first, at most 4 choices.
    let audio_options: Vec<Value> = audio_map.values().rev().take(4).cloned().collect();

    // Video options grouped by height (keep the largest/best per height).
    let mut by_height: BTreeMap<i64, (f64, bool)> = BTreeMap::new();
    for f in formats {
        let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
        if vcodec == "none" {
            continue;
        }
        let height = match fnum(f, "height") {
            Some(h) if h > 0.0 => h as i64,
            _ => continue,
        };
        let acodec = f.get("acodec").and_then(|v| v.as_str()).unwrap_or("none");
        let exact = fnum(f, "filesize");
        let size_v = exact.or_else(|| fnum(f, "filesize_approx")).unwrap_or(0.0);
        let total = if acodec == "none" {
            size_v + best_audio_size
        } else {
            size_v
        };
        let approx = exact.is_none();
        let entry = by_height.entry(height).or_insert((0.0, true));
        if total >= entry.0 {
            *entry = (total, approx);
        }
    }
    let mut video_options = Vec::new();
    for (h, (size, approx)) in by_height.iter().rev() {
        let tag = if *h >= 2160 {
            " (4K)"
        } else if *h >= 1440 {
            " (2K)"
        } else if *h >= 1080 {
            " (Full HD)"
        } else if *h >= 720 {
            " (HD)"
        } else {
            ""
        };
        video_options.push(json!({
            "height": h,
            "label": format!("{}p{}", h, tag),
            "size_text": fmt_size(*size),
            "approx": approx,
        }));
    }

    Ok(json!({
        "kind": "video",
        "title": data.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled video"),
        "thumbnail": data.get("thumbnail").and_then(|v| v.as_str()).unwrap_or(""),
        "duration": fnum(&data, "duration"),
        "uploader": data.get("uploader").and_then(|v| v.as_str()).unwrap_or(""),
        "video_options": video_options,
        "audio_options": audio_options,
    }))
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    url: String,
    mode: String,
    height: Option<u32>,
    format_id: Option<String>,
    audio_quality: Option<String>,
    out_dir: String,
) -> Result<(), String> {
    let bin = ytdlp(&app)?;
    let mut args: Vec<String> = vec![
        "--newline".into(),
        "--no-warnings".into(),
        "--no-playlist".into(),
        "--progress-template".into(),
        "download:TUBEGRAB|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s"
            .into(),
        "-o".into(),
        format!(
            "{}/%(title)s.%(ext)s",
            out_dir.trim_end_matches(['/', '\\'])
        ),
    ];
    if let Some(ff) = find_binary(&app, "ffmpeg") {
        args.push("--ffmpeg-location".into());
        args.push(ff.to_string_lossy().to_string());
    }
    if mode == "audio" {
        if let Some(fid) = format_id {
            args.push("-f".into());
            args.push(fid);
        } else {
            args.push("-f".into());
            args.push("bestaudio/best".into());
        }
        args.push("-x".into());
        args.push("--audio-format".into());
        args.push("mp3".into());
        args.push("--audio-quality".into());
        args.push(match audio_quality {
            Some(q) => format!("{q}K"),
            None => "0".into(),
        });
    } else {
        let h = height.unwrap_or(720);
        args.push("-f".into());
        args.push(format!(
            "bestvideo[height<={h}]+bestaudio/best[height<={h}]/best"
        ));
        args.push("--merge-output-format".into());
        args.push("mp4".into());
    }
    args.push(url);

    let mut child = Command::new(&bin)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start download: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    state.jobs.lock().unwrap().insert(job_id.clone(), child);

    let app2 = app.clone();
    let id2 = job_id.clone();
    std::thread::spawn(move || {
        let mut last_error = String::new();
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };
                if let Some(rest) = line.strip_prefix("TUBEGRAB|") {
                    let parts: Vec<&str> = rest.split('|').collect();
                    let percent = parts
                        .first()
                        .map(|s| {
                            s.trim()
                                .trim_end_matches('%')
                                .trim()
                                .parse::<f64>()
                                .unwrap_or(0.0)
                        })
                        .unwrap_or(0.0);
                    let _ = app2.emit(
                        "download-progress",
                        ProgressPayload {
                            id: id2.clone(),
                            status: "downloading".into(),
                            percent,
                            speed: parts
                                .get(1)
                                .map(|s| s.trim().to_string())
                                .unwrap_or_default(),
                            eta: parts
                                .get(2)
                                .map(|s| s.trim().to_string())
                                .unwrap_or_default(),
                            error: None,
                        },
                    );
                } else if line.contains("[Merger]")
                    || line.contains("[ExtractAudio]")
                    || line.contains("Post-process")
                {
                    let _ = app2.emit(
                        "download-progress",
                        ProgressPayload {
                            id: id2.clone(),
                            status: "processing".into(),
                            percent: 100.0,
                            speed: String::new(),
                            eta: String::new(),
                            error: None,
                        },
                    );
                }
            }
        }
        if let Some(err) = stderr {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if line.contains("ERROR") {
                    last_error = line.clone();
                }
            }
        }
        // Wait for the child and report the final state.
        let state_ref = app2.state::<AppState>();
        let mut child_opt = state_ref.jobs.lock().unwrap().remove(&id2);
        let success = match child_opt.as_mut() {
            Some(c) => c.wait().map(|s| s.success()).unwrap_or(false),
            None => false,
        };
        let was_cancelled = state_ref.cancelled.lock().unwrap().remove(&id2);
        let (status, error) = if was_cancelled {
            ("cancelled", None)
        } else if success {
            ("done", None)
        } else {
            (
                "error",
                Some(if last_error.is_empty() {
                    "Download failed".to_string()
                } else {
                    last_error
                }),
            )
        };
        let _ = app2.emit(
            "download-progress",
            ProgressPayload {
                id: id2.clone(),
                status: status.into(),
                percent: if success { 100.0 } else { 0.0 },
                speed: String::new(),
                eta: String::new(),
                error,
            },
        );
    });

    Ok(())
}

#[tauri::command]
fn cancel_download(state: State<'_, AppState>, job_id: String) -> Result<(), String> {
    state.cancelled.lock().unwrap().insert(job_id.clone());
    if let Some(mut child) = state.jobs.lock().unwrap().remove(&job_id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            tools_status,
            default_download_dir,
            download_ytdlp,
            get_info,
            start_download,
            cancel_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running RoniTube Downloader");
}
