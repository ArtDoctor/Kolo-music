"""Download Spotify track matches with yt-dlp and write basic ID3 tags."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import glob
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import threading
import uuid

import yt_dlp
from mutagen.id3 import ID3, TIT2, TPE1
from mutagen.mp3 import MP3
from SpotipyFree import Spotify


def sanitize_filename(name: str) -> str:
    """Sanitize string for safe filenames across Linux/Windows."""
    sanitized = re.sub(r'[\\/*?:"<>|]', "", name)
    return sanitized.strip()


def slugify(text: str) -> str:
    """Convert text into a safe folder/id slug."""
    slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return slug or "playlist"


def fetch_spotify_info(url: str):
    """
    Fetch title and tracklist for a Spotify playlist, album, or track URL.
    Returns: (title: str, tracks: list[dict], kind: str)
    """
    s = Spotify()
    parsed = url.strip()

    if "/track/" in parsed:
        tr = s.track(parsed)
        title = tr.get("name", "Unknown Track")
        artists = ", ".join(a["name"] for a in tr.get("artists", []))
        return f"{artists} - {title}", [tr], "track"

    if "/album/" in parsed:
        alb = s.album(parsed)
        alb_name = alb.get("name", "Album")
        res = s.album_tracks(parsed)
        items = res.get("items", [])
        while res.get("next"):
            try:
                res = s.next(res)
                items.extend(res.get("items", []))
            except Exception:
                break
        valid_tracks = [it for it in items if it.get("name")]
        return alb_name, valid_tracks, "album"

    # Default to playlist
    title = "Discover Weekly" if "37i9dQZEVXc" in parsed else "Spotify Playlist"
    try:
        pl_info = s.playlist(parsed)
        if pl_info and pl_info.get("name"):
            title = pl_info.get("name")
    except Exception:
        pass

    res = s.playlist_items(parsed)
    items = res.get("items", [])
    while res.get("next"):
        try:
            res = s.next(res)
            items.extend(res.get("items", []))
        except Exception:
            break

    valid_tracks = [it["track"] for it in items if it.get("track") and it["track"].get("name")]
    return title, valid_tracks, "playlist"


def tag_clean_metadata(file_path: str, title: str, artist: str):
    """Ensure clean title and artist ID3 tags are preserved."""
    try:
        audio = MP3(file_path, ID3=ID3)
        if audio.tags is None:
            audio.add_tags()
        tags = audio.tags
        if tags is not None:
            tags.add(TIT2(encoding=3, text=title))
            tags.add(TPE1(encoding=3, text=artist))
            audio.save()
    except Exception:
        pass


def download_track(track_info: dict, output_dir: str, bitrate: str = "320", staging_dir: str | None = None) -> bool:
    """Download a single track using yt-dlp, extract MP3, and embed cover artwork.

    Partial files are kept in ``staging_dir`` so the player never lists them.
    """
    title = track_info["name"]
    artists = ", ".join(a["name"] for a in track_info.get("artists", []))

    filename = sanitize_filename(f"{artists} - {title}") + ".mp3"
    target_path = os.path.join(output_dir, filename)

    if os.path.exists(target_path):
        return True

    unique_id = uuid.uuid4().hex[:8]
    tmp_out = os.path.join(staging_dir or output_dir, f"tmp_{unique_id}_{sanitize_filename(title)[:30]}")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": f"{tmp_out}.%(ext)s",
        "writethumbnail": True,
        "noprogress": True,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": bitrate,
            },
            {
                "key": "EmbedThumbnail",
            },
            {
                "key": "FFmpegMetadata",
            },
        ],
        "postprocessor_args": {
            "ExtractAudio": ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
        },
        "quiet": True,
        "no_warnings": True,
    }

    # Primary query with quotes to avoid mismatched artists/songs, followed by fallback queries
    search_queries = [
        f'ytsearch1:"{title}" "{artists}" audio',
        f'ytsearch1:"{title}" "{artists}"',
        f"ytsearch1:{artists} - {title} audio",
        f"ytsearch1:{artists} - {title}",
    ]

    try:
        success = False
        for query in search_queries:
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([query])

                downloaded_mp3 = f"{tmp_out}.mp3"
                if not os.path.exists(downloaded_mp3):
                    for ext in [".mp3", ".m4a", ".opus", ".webm"]:
                        cand = f"{tmp_out}{ext}"
                        if os.path.exists(cand):
                            downloaded_mp3 = cand
                            break

                if os.path.exists(downloaded_mp3):
                    tag_clean_metadata(downloaded_mp3, title, artists)
                    shutil.move(downloaded_mp3, target_path)

                    # Cache artwork into .kolo/artwork if present
                    try:
                        import hashlib
                        data_root = resolve_data_root()
                        rel_path = os.path.relpath(target_path, data_root).replace("\\", "/")
                        h = hashlib.sha1(rel_path.encode("utf-8")).hexdigest()
                        art_dir = data_root / ".kolo" / "artwork"
                        art_dir.mkdir(parents=True, exist_ok=True)
                        target_art = art_dir / f"{h}.jpg"
                        if not target_art.exists():
                            import mutagen
                            m = mutagen.File(target_path)
                            if m and hasattr(m, "tags") and m.tags:
                                for k in m.tags.keys():
                                    if k.startswith("APIC") and getattr(m.tags[k], "data", None):
                                        with open(target_art, "wb") as afp:
                                            afp.write(m.tags[k].data)
                                        break
                    except Exception:
                        pass

                    success = True
                    break
            except Exception:
                continue

        return success

    finally:
        # Clean up any leftover temporary files (thumbnails, partial downloads)
        for leftover in glob.glob(f"{tmp_out}*"):
            try:
                if os.path.isfile(leftover):
                    os.remove(leftover)
            except OSError:
                pass


def resolve_data_root() -> Path:
    override = os.environ.get("KOLO_DATA_DIR")
    if override:
        return Path(override)
    script_dir = Path(__file__).resolve().parent
    repo_dir = script_dir.parent
    candidate = repo_dir / "kolo.0.data"
    if candidate.exists():
        return candidate
    cwd_candidate = Path("kolo.0.data")
    if cwd_candidate.exists():
        return cwd_candidate
    return Path("kolo.0.data")


def resolve_destination(
    data_root: Path,
    playlist_name: str,
    playlist_id: str | None,
    create_playlist: bool,
    custom_output: str | None,
) -> tuple[Path, str, str]:
    if custom_output:
        return Path(custom_output), "custom:output", playlist_name

    if playlist_id:
        if playlist_id == "pos":
            return data_root / "pos", "pos", "Main playlist"
        if playlist_id == "old":
            return data_root / "downloads" / "OLD", "old", "Old playlist"
        if playlist_id == "discovery":
            return data_root / "discovery", "discovery", "Discovery"
        if playlist_id == "imported":
            return data_root / "imported", "imported", "Imported"
        if playlist_id == "negative":
            return data_root / "neg", "negative", "Not my vibe"
        if playlist_id.startswith("custom:"):
            slug = playlist_id[7:]
            return data_root / "playlists" / slug, playlist_id, playlist_name

    # Without a target ID, use a folder based on the Spotify collection name.
    slug = slugify(playlist_name)
    folder = data_root / "playlists" / slug
    if create_playlist and folder.exists():
        slug = f"{slug}-{uuid.uuid4().hex[:8]}"
        folder = data_root / "playlists" / slug
    folder.mkdir(parents=True, exist_ok=True)

    # Register in .kolo/playlists.json
    names_file = data_root / ".kolo" / "playlists.json"
    names_file.parent.mkdir(parents=True, exist_ok=True)
    names = {}
    if names_file.exists():
        try:
            with open(names_file, "r", encoding="utf-8") as f:
                names = json.load(f)
        except Exception:
            names = {}
    names[slug] = playlist_name
    with open(names_file, "w", encoding="utf-8") as f:
        json.dump(names, f, indent=2, ensure_ascii=False)

    return folder, f"custom:{slug}", playlist_name


def emit_json(data: dict):
    print(json.dumps(data), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Download songs from a Spotify playlist, album, or track")
    parser.add_argument("--url", default="https://open.spotify.com/playlist/37i9dQZEVXcOour5t7D6qU", help="Spotify URL")
    parser.add_argument(
        "--count",
        type=int,
        default=100,
        help="Number of latest songs to download (default: 100). Ignored if --all is set.",
    )
    parser.add_argument("--all", action="store_true", help="Download every track instead of the latest --count tracks")
    parser.add_argument("--workers", type=int, default=4, help="Number of concurrent download workers (default: 4)")
    parser.add_argument("--output", default=None, help="Explicit output directory")
    parser.add_argument(
        "--playlist-id",
        default=None,
        help="Target Kolo playlist ID (e.g. discovery, imported, custom:slug)",
    )
    parser.add_argument("--playlist-name", default=None, help="Custom playlist display name")
    parser.add_argument("--create-playlist", action="store_true", help="Always create a new named playlist in Kolo")
    parser.add_argument("--bitrate", default="320", help="Audio bitrate (default: 320)")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON progress stream to stdout")
    args = parser.parse_args()

    data_root = resolve_data_root()

    try:
        fetched_title, tracks, kind = fetch_spotify_info(args.url)
    except Exception as error:
        if not args.json:
            raise
        print(f"Spotify lookup failed: {error!r}", file=sys.stderr)
        emit_json({"type": "error", "error": "Could not read that Spotify link. Check that it is public."})
        sys.exit(1)
    display_name = args.playlist_name or fetched_title or "Spotify Playlist"

    target_dir, resolved_id, resolved_name = resolve_destination(
        data_root=data_root,
        playlist_name=display_name,
        playlist_id=args.playlist_id,
        create_playlist=args.create_playlist,
        custom_output=args.output,
    )

    os.makedirs(target_dir, exist_ok=True)
    total = len(tracks)

    if total == 0:
        if args.json:
            emit_json({"type": "error", "error": "No tracks found at Spotify URL"})
        else:
            print("No songs found. Exiting.")
        sys.exit(0)

    if args.all or args.count >= total or args.count <= 0:
        target_tracks = tracks
    else:
        target_tracks = tracks[-args.count:]

    # Separate into already existing and to-download
    existing_files = set(os.listdir(target_dir))
    to_download = []
    already_present = 0

    for track in target_tracks:
        title = track.get("name", "")
        artists = ", ".join(a["name"] for a in track.get("artists", []))
        filename = sanitize_filename(f"{artists} - {title}") + ".mp3"
        if filename in existing_files:
            already_present += 1
        else:
            to_download.append(track)

    if args.json:
        emit_json({
            "type": "init",
            "title": fetched_title,
            "playlistName": resolved_name,
            "playlistId": resolved_id,
            "targetDir": str(target_dir),
            "total": len(target_tracks),
            "alreadyPresent": already_present,
            "toDownload": len(to_download),
        })
    else:
        print(f"Playlist: {resolved_name} ({resolved_id})")
        print(f"Selected tracks: {len(target_tracks)}")
        print(f"Already downloaded: {already_present}")
        print(f"Remaining to download: {len(to_download)} to '{target_dir}'")
        print(f"Workers: {args.workers}\n")

    if not to_download:
        if args.json:
            emit_json({
                "type": "done",
                "playlistName": resolved_name,
                "playlistId": resolved_id,
                "targetDir": str(target_dir),
                "total": len(target_tracks),
                "downloaded": 0,
                "existing": already_present,
                "failed": 0,
            })
        else:
            print("All tracks already downloaded!")
        sys.exit(0)

    success_count = 0
    fail_count = 0
    total_needed = len(to_download)
    counter_lock = threading.Lock()

    staging_dir = data_root / ".kolo" / "tmp" / f"spotify-{os.getpid()}"
    staging_dir.mkdir(parents=True, exist_ok=True)

    def stop(signum, _frame):
        # Worker threads cannot be interrupted, so leave without waiting for them.
        shutil.rmtree(staging_dir, ignore_errors=True)
        os._exit(128 + signum)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def process_item(item_idx, track_item):
        nonlocal success_count, fail_count
        title = track_item.get("name", "")
        artists = ", ".join(a["name"] for a in track_item.get("artists", []))
        track_str = f"{artists} - {title}"

        if args.json:
            with counter_lock:
                emit_json({"type": "start", "track": track_str})
        ok = download_track(track_item, str(target_dir), args.bitrate, str(staging_dir))
        with counter_lock:
            if ok:
                success_count += 1
            else:
                fail_count += 1
            curr = success_count + fail_count
            pct = (curr / total_needed) * 100

            if args.json:
                emit_json({
                    "type": "progress",
                    "current": curr,
                    "total": total_needed,
                    "downloaded": success_count,
                    "failed": fail_count,
                    "track": track_str,
                    "success": ok,
                    "percent": round(pct, 1),
                })
            else:
                status = "[Done]" if ok else "[Fail]"
                print(f"[{curr}/{total_needed}] ({pct:.1f}%) {status} {track_str}", flush=True)
        return ok

    try:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = [executor.submit(process_item, index, track) for index, track in enumerate(to_download, 1)]
            for future in as_completed(futures):
                future.result()
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)

    if args.json:
        emit_json({
            "type": "done",
            "playlistName": resolved_name,
            "playlistId": resolved_id,
            "targetDir": str(target_dir),
            "total": len(target_tracks),
            "downloaded": success_count,
            "existing": already_present,
            "failed": fail_count,
        })
    else:
        print("\nDownload finished")
        print(f"Downloaded: {success_count}/{total_needed}")
        if fail_count > 0:
            print(f"Failed: {fail_count}")
        print(f"Files in destination: {len(os.listdir(target_dir))}")
        print(f"Saved to: {os.path.abspath(target_dir)}")


if __name__ == "__main__":
    main()
