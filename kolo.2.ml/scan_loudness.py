"""Measure track loudness and cache attenuation gains for the player."""

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

TARGET_LUFS = -14.0
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".flac", ".wav", ".ogg", ".webm"}
LIBRARY_FOLDERS = ("imported", "discovery", "downloads", "pos", "playlists")


def measure_lufs(path: Path) -> dict[str, float]:
    """Return integrated loudness and a gain that never boosts the source."""
    command = [
        "ffmpeg",
        "-nostats",
        "-i",
        str(path),
        "-t",
        "90",
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
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        print(f"Could not measure {path}: {error}", file=sys.stderr)
        return {"lufs": TARGET_LUFS, "gain": 1.0}

    stderr = result.stderr.decode("utf-8", errors="replace")
    summary = stderr.rsplit("Summary:", maxsplit=1)[-1]
    match = re.search(r"I:\s+([-\d.]+)\s+LUFS", summary)
    if not match:
        print(f"Could not read an EBU R128 result for {path}", file=sys.stderr)
        return {"lufs": TARGET_LUFS, "gain": 1.0}

    lufs = float(match.group(1))
    gain = min(1.0, round(10.0 ** ((TARGET_LUFS - lufs) / 20.0), 3))
    return {"lufs": lufs, "gain": gain}


def read_store(path: Path) -> dict[str, dict[str, Any]]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def write_store(path: Path, store: dict[str, dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp.json")
    temporary.write_text(json.dumps(store, indent=2), encoding="utf-8")
    temporary.replace(path)


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


def scan(data_root: Path, target: Path | None = None) -> int:
    loudness_path = data_root / ".kolo" / "loudness.json"
    store = read_store(loudness_path)
    files = audio_files(target) if target is not None else default_files(data_root)

    updated = 0
    root = data_root.resolve()
    for path in files:
        try:
            track_id = path.resolve().relative_to(root).as_posix()
        except ValueError:
            print(f"Skipping file outside data root: {path}", file=sys.stderr)
            continue
        if store.get(track_id, {}).get("gain") is not None:
            continue
        store[track_id] = measure_lufs(path)
        updated += 1
        if updated % 20 == 0:
            write_store(loudness_path, store)

    write_store(loudness_path, store)
    print(f"Updated {updated} tracks in {loudness_path}")
    return updated


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Cache EBU R128 loudness values for Kolo audio")
    parser.add_argument("path", nargs="?", help="Optional file or directory to scan")
    parser.add_argument("--data-root", default=str(repo_root / "kolo.0.data"))
    args = parser.parse_args()

    data_root = Path(args.data_root).resolve()
    target = Path(args.path).resolve() if args.path else None
    scan(data_root, target)


if __name__ == "__main__":
    main()
