"""Measure track loudness and cache playback gains for the player."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

from library_storage import store_lock

TARGET_LUFS = -14.0
MAX_BOOST_DB = 12.0
MAX_ANALYSIS_SECONDS = 1200
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".flac", ".wav", ".ogg", ".aac", ".opus", ".webm"}
LIBRARY_FOLDERS = ("imported", "discovery", "downloads", "pos", "neg", "playlists")
DEFAULT_WORKERS = min(4, os.cpu_count() or 1)


def gain_for(lufs: float) -> float:
    """Return the linear gain that brings a track to the target loudness.

    Loud tracks are attenuated and quiet tracks are boosted. The boost is capped
    so near-silent files are not amplified into noise.
    """
    gain_db = min(TARGET_LUFS - lufs, MAX_BOOST_DB)
    return round(10.0 ** (gain_db / 20.0), 3)


def measure_lufs(path: Path) -> float | None:
    """Return the integrated loudness of a track, or None on failure.

    Songs are measured in full. Only the start of multi-hour mixes is analysed
    so one huge file cannot stall a scan.
    """
    command = [
        "ffmpeg",
        "-nostats",
        "-t",
        str(MAX_ANALYSIS_SECONDS),
        "-i",
        str(path),
        "-af",
        "ebur128",
        "-f",
        "null",
        "-",
    ]
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        print(f"Could not measure {path}: {error}", file=sys.stderr)
        return None

    if result.returncode != 0:
        print(f"FFmpeg could not measure {path}", file=sys.stderr)
        return None
    stderr = result.stderr.decode("utf-8", errors="replace")
    summary = stderr.rsplit("Summary:", maxsplit=1)[-1]
    match = re.search(r"I:\s+([-\d.]+)\s+LUFS", summary)
    if not match:
        print(f"Could not read an EBU R128 result for {path}", file=sys.stderr)
        return None

    return float(match.group(1))


def read_store(path: Path) -> dict[str, dict[str, Any]]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def write_store(path: Path, store: dict[str, dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{os.getpid()}.tmp.json")
    temporary.write_text(json.dumps(store, indent=2), encoding="utf-8")
    temporary.replace(path)


def has_measurement(entry: Any) -> bool:
    return isinstance(entry, dict) and isinstance(entry.get("lufs"), (int, float))


def merge_into_store(path: Path, measured: dict[str, float]) -> None:
    """Add measurements to the store and refresh every gain.

    The store is re-read first so scans running at the same time keep each
    other's entries, and gains are recomputed from the stored loudness so a
    changed target applies without measuring the audio again.
    """
    with store_lock(path):
        store = read_store(path)
        for track_id, lufs in measured.items():
            store[track_id] = {"lufs": lufs}
        for entry in store.values():
            if has_measurement(entry):
                entry["gain"] = gain_for(entry["lufs"])
        write_store(path, store)


def audio_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix.lower() in AUDIO_EXTENSIONS else []
    if not path.is_dir():
        return []
    return sorted(
        item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in AUDIO_EXTENSIONS
    )


def default_files(data_root: Path) -> list[Path]:
    files: list[Path] = []
    for folder in LIBRARY_FOLDERS:
        files.extend(audio_files(data_root / folder))
    return files


def scan(
    data_root: Path,
    target: Path | None = None,
    force: bool = False,
    workers: int = DEFAULT_WORKERS,
) -> int:
    loudness_path = data_root / ".kolo" / "loudness.json"
    store = read_store(loudness_path)
    files = audio_files(target) if target is not None else default_files(data_root)

    pending: dict[str, Path] = {}
    root = data_root.resolve()
    for path in files:
        try:
            track_id = path.resolve().relative_to(root).as_posix()
        except ValueError:
            print(f"Skipping file outside data root: {path}", file=sys.stderr)
            continue
        if force or not has_measurement(store.get(track_id)):
            pending[track_id] = path

    updated = 0
    measured: dict[str, float] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        results = zip(pending, pool.map(measure_lufs, pending.values()))
        for track_id, lufs in results:
            if lufs is None:
                continue
            measured[track_id] = lufs
            updated += 1
            if len(measured) >= 50:
                merge_into_store(loudness_path, measured)
                measured = {}

    merge_into_store(loudness_path, measured)
    print(f"Updated {updated} of {len(pending)} unmeasured tracks in {loudness_path}")
    return updated


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Cache EBU R128 loudness values for Kolo audio")
    parser.add_argument("path", nargs="?", help="Optional file or directory to scan")
    parser.add_argument(
        "--data-root",
        default=os.environ.get("KOLO_DATA_DIR") or str(repo_root / "kolo.0.data"),
    )
    parser.add_argument("--force", action="store_true", help="Measure tracks again even if they are cached")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="Parallel FFmpeg processes")
    args = parser.parse_args()

    data_root = Path(args.data_root).resolve()
    target = Path(args.path).resolve() if args.path else None
    scan(data_root, target, force=args.force, workers=args.workers)


if __name__ == "__main__":
    main()
