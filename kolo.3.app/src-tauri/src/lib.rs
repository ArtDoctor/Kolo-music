use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "m4a", "flac", "wav", "ogg", "aac", "opus", "webm"];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistRecord {
    id: String,
    name: String,
    count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackRecord {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    source_path: String,
    playlist_id: String,
    rating: Option<f32>,
    ai_rating: Option<f32>,
    liked: bool,
    vibe_score: Option<f32>,
    mtime: Option<f64>,
    artwork_url: Option<String>,
    cluster: Option<i32>,
    genre: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibrarySnapshot {
    data_root: String,
    playlists: Vec<PlaylistRecord>,
    tracks: Vec<TrackRecord>,
}

#[derive(Default, Deserialize, Serialize)]
struct RatingStore {
    ratings: HashMap<String, f32>,
}

fn data_root() -> PathBuf {
    if let Ok(path) = env::var("KOLO_DATA_DIR") {
        return PathBuf::from(path);
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("src-tauri must be inside the Kolo repository")
        .join("kolo.0.data")
}

fn state_dir(root: &Path) -> PathBuf {
    root.join(".kolo")
}

fn ratings_path(root: &Path) -> PathBuf {
    state_dir(root).join("ratings.json")
}

fn read_ratings(root: &Path) -> RatingStore {
    fs::read_to_string(ratings_path(root))
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

#[derive(Default, Deserialize)]
struct AiRatingItem {
    rating: Option<f32>,
    vibe_score: Option<f32>,
    #[serde(rename = "vibeScore")]
    vibe_score_camel: Option<f32>,
}

#[derive(Default, Deserialize)]
struct AiRatingsStore {
    ratings: HashMap<String, AiRatingItem>,
}

fn ai_ratings_path(root: &Path) -> PathBuf {
    state_dir(root).join("ai_ratings.json")
}

fn read_ai_ratings(root: &Path) -> AiRatingsStore {
    fs::read_to_string(ai_ratings_path(root))
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("invalid state path")?)
        .map_err(|error| error.to_string())?;
    let json = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    // Windows cannot rename over an existing file; write through there instead.
    #[cfg(windows)]
    {
        fs::write(path, json).map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
        fs::write(&temporary, json).map_err(|error| error.to_string())?;
        fs::rename(temporary, path).map_err(|error| error.to_string())
    }
}

fn read_json<T: serde::de::DeserializeOwned + Default>(path: &Path) -> T {
    fs::read_to_string(path)
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

fn likes_path(root: &Path) -> PathBuf {
    state_dir(root).join("likes.json")
}
fn names_path(root: &Path) -> PathBuf {
    state_dir(root).join("playlists.json")
}

fn playlist_definitions(root: &Path) -> Vec<(String, String, PathBuf)> {
    let mut definitions = vec![
        ("pos".into(), "Phone music".into(), root.join("pos")),
        (
            "old".into(),
            "Old playlist".into(),
            root.join("downloads").join("OLD"),
        ),
        (
            "discovery".into(),
            "Discovery".into(),
            root.join("discovery"),
        ),
        ("imported".into(), "Imports".into(), root.join("imported")),
        ("negative".into(), "Not my vibe".into(), root.join("neg")),
    ];
    let names: HashMap<String, String> = read_json(&names_path(root));
    if let Ok(entries) = fs::read_dir(root.join("playlists")) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let slug = entry.file_name().to_string_lossy().to_string();
                if slug
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '-')
                {
                    definitions.push((
                        format!("custom:{slug}"),
                        names.get(&slug).cloned().unwrap_or(slug),
                        entry.path(),
                    ));
                }
            }
        }
    }
    definitions
}

fn playlist_folder(root: &Path, id: &str) -> Result<PathBuf, String> {
    playlist_definitions(root)
        .into_iter()
        .find(|(key, _, _)| key == id)
        .map(|(_, _, path)| path)
        .ok_or_else(|| "Unknown playlist".into())
}

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| AUDIO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn metadata_from_filename(path: &Path) -> (String, String) {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Unknown track")
        .replace('_', " ");

    if let Some((artist, title)) = stem.split_once(" - ") {
        (title.trim().to_string(), artist.trim().to_string())
    } else {
        (stem.trim().to_string(), "Unknown artist".to_string())
    }
}

fn normalized_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn scan_folder(
    root: &Path,
    folder: &Path,
    playlist_id: &str,
    playlist_name: &str,
    ratings: &RatingStore,
    likes: &HashSet<String>,
    ai_ratings: &AiRatingsStore,
) -> Vec<TrackRecord> {
    let mut paths: Vec<PathBuf> = fs::read_dir(folder)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_audio(path))
        .collect();

    paths.sort_by_key(|path| {
        path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase()
    });

    paths
        .into_iter()
        .map(|path| {
            let id = normalized_relative(root, &path);
            let (title, artist) = metadata_from_filename(&path);
            let mtime = fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64() * 1000.0);
            let ai_item = ai_ratings.ratings.get(&id);
            let vibe = ai_item.and_then(|item| item.vibe_score.or(item.vibe_score_camel));
            let ai_rate = ai_item.and_then(|item| item.rating);

            TrackRecord {
                rating: ratings.ratings.get(&id).copied(),
                ai_rating: ai_rate,
                liked: likes.contains(&id),
                id,
                title,
                artist,
                album: playlist_name.to_string(),
                duration: 0.0,
                source_path: path.to_string_lossy().to_string(),
                playlist_id: playlist_id.to_string(),
                vibe_score: vibe,
                mtime,
                artwork_url: None,
                cluster: None,
                genre: None,
            }
        })
        .collect()
}

#[tauri::command]
fn scan_library() -> Result<LibrarySnapshot, String> {
    let root = data_root();
    fs::create_dir_all(root.join("imported")).map_err(|error| error.to_string())?;
    let ratings = read_ratings(&root);
    let ai_ratings = read_ai_ratings(&root);
    let likes: HashSet<String> = read_json(&likes_path(&root));
    let definitions = playlist_definitions(&root);

    let mut tracks = Vec::new();
    let mut playlists = Vec::new();
    for (id, name, folder) in definitions {
        let folder_tracks = scan_folder(&root, &folder, &id, &name, &ratings, &likes, &ai_ratings);
        playlists.push(PlaylistRecord {
            id,
            name,
            count: folder_tracks.len(),
        });
        tracks.extend(folder_tracks);
    }

    let liked_count = tracks.iter().filter(|track| track.liked).count();
    playlists.insert(
        0,
        PlaylistRecord {
            id: "liked".to_string(),
            name: "Liked songs".to_string(),
            count: liked_count,
        },
    );

    Ok(LibrarySnapshot {
        data_root: root.to_string_lossy().to_string(),
        playlists,
        tracks,
    })
}

#[tauri::command]
fn set_track_rating(track_id: String, rating: Option<f32>) -> Result<(), String> {
    let root = data_root();
    let mut store = read_ratings(&root);

    match rating {
        Some(value) if (0.5..=5.0).contains(&value) => {
            let rounded = (value * 2.0).round() / 2.0;
            store.ratings.insert(track_id, rounded);
        }
        Some(_) => return Err("rating must be between 0.5 and 5.0".to_string()),
        None => {
            store.ratings.remove(&track_id);
        }
    }

    write_json(&ratings_path(&root), &store)
}

#[tauri::command]
fn import_tracks(paths: Vec<String>, playlist_id: String) -> Result<usize, String> {
    let root = data_root();
    let destination = playlist_folder(&root, &playlist_id)?;
    fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    let mut imported = 0;

    for source_value in paths {
        let source = PathBuf::from(source_value);
        if !source.is_file() || !is_audio(&source) {
            continue;
        }

        let Some(original_name) = source.file_name() else {
            continue;
        };
        let mut target = destination.join(original_name);
        let stem = source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("track");
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("mp3");
        let mut suffix = 2;
        while target.exists() {
            target = destination.join(format!("{stem} ({suffix}).{extension}"));
            suffix += 1;
        }

        fs::copy(&source, target).map_err(|error| error.to_string())?;
        imported += 1;
    }

    Ok(imported)
}

#[tauri::command]
fn set_track_liked(track_id: String, liked: bool) -> Result<(), String> {
    if !scan_library()?
        .tracks
        .iter()
        .any(|track| track.id == track_id)
    {
        return Err("Unknown track".into());
    }
    let root = data_root();
    let mut likes: HashSet<String> = read_json(&likes_path(&root));
    if liked {
        likes.insert(track_id);
    } else {
        likes.remove(&track_id);
    }
    write_json(&likes_path(&root), &likes)
}

#[tauri::command]
fn create_playlist(name: String) -> Result<PlaylistRecord, String> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 60
        || !name
            .chars()
            .all(|c| c.is_alphanumeric() || c == ' ' || c == '_' || c == '-')
    {
        return Err("Use a short playlist name with letters, numbers, spaces or hyphens".into());
    }
    let root = data_root();
    let slug = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let id = format!("{}-{suffix}", slug.trim_matches('-'));
    fs::create_dir_all(root.join("playlists").join(&id)).map_err(|e| e.to_string())?;
    let mut names: HashMap<String, String> = read_json(&names_path(&root));
    names.insert(id.clone(), name.to_string());
    write_json(&names_path(&root), &names)?;
    Ok(PlaylistRecord {
        id: format!("custom:{id}"),
        name: name.to_string(),
        count: 0,
    })
}

#[tauri::command]
async fn download_youtube(playlist_id: String, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid YouTube URL")?;
    if parsed.scheme() != "https"
        || !matches!(
            parsed.host_str(),
            Some(
                "youtube.com"
                    | "www.youtube.com"
                    | "music.youtube.com"
                    | "youtu.be"
                    | "www.youtu.be"
            )
        )
    {
        return Err("Only HTTPS YouTube links can be downloaded".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = data_root();
        let folder = playlist_folder(&root, &playlist_id)?;
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let default_binary = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join(".venv")
            .join("bin")
            .join("yt-dlp");
        let binary = env::var("KOLO_YT_DLP").unwrap_or_else(|_| {
            if default_binary.exists() {
                default_binary.to_string_lossy().to_string()
            } else {
                "yt-dlp".into()
            }
        });
        let output = Command::new(binary)
            .args([
                "--no-playlist",
                "--restrict-filenames",
                "-x",
                "--audio-format",
                "mp3",
                "--audio-quality",
                "0",
                "--postprocessor-args",
                "ExtractAudio:-af loudnorm=I=-16:TP=-1.5:LRA=11",
                "-o",
            ])
            .arg(folder.join("%(title)s-%(id)s.%(ext)s"))
            .arg(url)
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(600)
                .collect())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn download_spotify(
    url: String,
    playlist_id: Option<String>,
    playlist_name: Option<String>,
    create_playlist: Option<bool>,
) -> Result<String, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid Spotify URL")?;
    if parsed.scheme() != "https" || !matches!(parsed.host_str(), Some("open.spotify.com")) {
        return Err("Only HTTPS open.spotify.com links can be downloaded".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = data_root();
        let repo_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");
        let default_python = repo_dir.join(".venv").join("bin").join("python");
        let python = env::var("KOLO_PYTHON").unwrap_or_else(|_| {
            if default_python.exists() {
                default_python.to_string_lossy().to_string()
            } else {
                "python3".into()
            }
        });
        let script = repo_dir
            .join("kolo.2.ml")
            .join("download_playlist_latest.py");

        let mut cmd = Command::new(python);
        cmd.arg(script)
            .arg("--url")
            .arg(&url)
            .arg("--json")
            .arg("--all");
        cmd.env("KOLO_DATA_DIR", &root);

        if let Some(id) = playlist_id {
            cmd.arg("--playlist-id").arg(id);
        }
        if let Some(name) = playlist_name {
            cmd.arg("--playlist-name").arg(name);
        }
        if create_playlist.unwrap_or(true) {
            cmd.arg("--create-playlist");
        }

        let output = cmd.output().map_err(|e| e.to_string())?;
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            Ok(stdout.lines().last().unwrap_or("").to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(600)
                .collect())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_library,
            set_track_rating,
            import_tracks,
            set_track_liked,
            create_playlist,
            download_youtube,
            download_spotify
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Kolo");
}
