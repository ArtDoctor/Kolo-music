"""Estimate star ratings for tracks the rating model has not scored yet.

A track without a MuQ-MuLan vector is embedded first and added to the master
index, so the next training run can use it as well. Each estimate is written to
``.kolo/ai_ratings.json`` as soon as it is ready.
"""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import time
from typing import Any, Callable

import joblib
import numpy as np

from library_storage import store_lock

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
from kolo_rating_model import ai_rating_entry  # noqa: E402

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".flac", ".wav", ".ogg", ".aac", ".opus", ".webm"}
LIBRARY_FOLDERS = ("imported", "discovery", "downloads", "pos", "neg", "playlists")
MASTER_FLUSH_EVERY = 10

Vectors = dict[str, tuple[np.ndarray, float]]
Emit = Callable[[dict[str, Any]], None]


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{os.getpid()}.tmp.json")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def has_estimate(entry: Any) -> bool:
    return isinstance(entry, dict) and isinstance(entry.get("rating"), (int, float))


def store_estimate(ai_path: Path, track_id: str, entry: dict[str, Any]) -> None:
    """Add one estimate, re-reading the store so parallel writers keep their entries."""
    with store_lock(ai_path):
        store = read_json(ai_path)
        ratings = store.get("ratings")
        if not isinstance(ratings, dict):
            ratings = {}
            store["ratings"] = ratings
        ratings[track_id] = entry
        store.setdefault("version", "3.0")
        store["total_scored"] = len(ratings)
        store["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write_json_atomic(ai_path, store)


def load_master(master_path: Path) -> Vectors:
    if not master_path.exists():
        return {}
    with np.load(master_path) as data:
        durations = data["durations"] if "durations" in data else np.zeros(len(data["ids"]), dtype=np.float32)
        return {
            str(track_id): (embedding, float(duration))
            for track_id, embedding, duration in zip(data["ids"], data["embeddings"], durations)
        }


def merge_into_master(master_path: Path, new_vectors: Vectors) -> None:
    """Add vectors to the master index, keeping whatever was written meanwhile."""
    if not new_vectors:
        return
    with store_lock(master_path):
        records = load_master(master_path)
        records.update(new_vectors)
        ids = sorted(records)
        temporary = master_path.with_suffix(f".{os.getpid()}.tmp.npz")
        np.savez_compressed(
            temporary,
            ids=np.asarray(ids),
            embeddings=np.asarray([records[item][0] for item in ids], dtype=np.float32),
            durations=np.asarray([records[item][1] for item in ids], dtype=np.float32),
        )
        temporary.replace(master_path)


def audio_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix.lower() in AUDIO_EXTENSIONS else []
    if not path.is_dir():
        return []
    return sorted(item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in AUDIO_EXTENSIONS)


def requested_tracks(data_root: Path, args: argparse.Namespace) -> dict[str, Path]:
    """Map the requested track IDs to audio files inside the data root."""
    if args.ids_stdin:
        ids = json.loads(sys.stdin.read() or "[]")
        if not isinstance(ids, list):
            raise ValueError("Expected a JSON array of track IDs on stdin")
        candidates = [data_root / str(track_id) for track_id in ids]
    elif args.paths:
        candidates = [item for value in args.paths for item in audio_files(Path(value).resolve())]
    else:
        candidates = [item for folder in LIBRARY_FOLDERS for item in audio_files(data_root / folder)]

    tracks: dict[str, Path] = {}
    for candidate in candidates:
        path = candidate.resolve()
        try:
            track_id = path.relative_to(data_root).as_posix()
        except ValueError:
            print(f"Skipping file outside data root: {candidate}", file=sys.stderr)
            continue
        if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS:
            tracks[track_id] = path
    return tracks


def load_encoder(device: str | None) -> Callable[[Path], tuple[np.ndarray, float]]:
    """Load MuQ-MuLan and return a function that embeds one audio file."""
    # Imported here so tracks that already have vectors are scored without torch.
    import torch
    from muq import MuQMuLan

    helpers_path = REPO_ROOT / "kolo.1.eda" / "extract_all_missing_embeddings.py"
    spec = importlib.util.spec_from_file_location("kolo_embedding_helpers", helpers_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load embedding helpers")
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)

    resolved_device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large").to(resolved_device).eval()

    def embed(path: Path) -> tuple[np.ndarray, float]:
        wav, duration = helpers.load_and_resample_audio(path, mulan.sr, resolved_device)
        embedding = helpers.extract_track_embedding(mulan, wav, resolved_device)
        return np.asarray(embedding, dtype=np.float32), round(duration, 2)

    return embed


def rate(
    data_root: Path,
    model_path: Path,
    tracks: dict[str, Path],
    force: bool,
    device: str | None,
    emit: Emit,
) -> int:
    ai_path = data_root / ".kolo" / "ai_ratings.json"
    master_path = data_root / ".kolo" / "all_embeddings.npz"

    scored = read_json(ai_path).get("ratings")
    scored = scored if isinstance(scored, dict) else {}
    pending = [track_id for track_id in tracks if force or not has_estimate(scored.get(track_id))]
    skipped = len(tracks) - len(pending)

    vectors = load_master(master_path) if pending else {}
    # Tracks that only need the regressor come first: they finish instantly.
    pending.sort(key=lambda track_id: track_id not in vectors)
    need_audio = sum(track_id not in vectors for track_id in pending)
    emit({"type": "init", "total": len(pending), "skipped": skipped, "needEmbedding": need_audio})
    if not pending:
        emit({"type": "done", "total": 0, "rated": 0, "failed": 0, "skipped": skipped})
        return 0

    if not model_path.exists():
        raise FileNotFoundError(f"No trained rating model at {model_path}. Run ./kolo.2.ml/train.sh first.")
    bundle = joblib.load(model_path)
    model = bundle["model"]
    expected_dim = bundle.get("embedding_dim")

    embed: Callable[[Path], tuple[np.ndarray, float]] | None = None
    new_vectors: Vectors = {}
    rated = 0
    failed = 0
    try:
        for index, track_id in enumerate(pending, 1):
            label = tracks[track_id].stem
            emit({"type": "start", "track": label, "trackId": track_id})
            event: dict[str, Any] = {"type": "progress", "current": index, "total": len(pending), "track": label}
            try:
                if track_id in vectors:
                    embedding = np.asarray(vectors[track_id][0], dtype=np.float32)
                else:
                    if embed is None:
                        emit({"type": "stage", "stage": "loading-encoder"})
                        embed = load_encoder(device)
                    embedding, duration = embed(tracks[track_id])
                    new_vectors[track_id] = (embedding, duration)
                if expected_dim and embedding.shape[0] != expected_dim:
                    raise ValueError(f"Expected a {expected_dim}-dim vector, got {embedding.shape[0]}")
                entry = ai_rating_entry(float(model.predict_rating(embedding.reshape(1, -1))[0]))
                store_estimate(ai_path, track_id, entry)
                rated += 1
                event.update({"success": True, "rating": entry["rating"]})
            except Exception as error:
                # One unreadable file must not stop the rest of the playlist.
                new_vectors.pop(track_id, None)
                failed += 1
                event.update({"success": False, "error": str(error) or type(error).__name__})
            emit({**event, "trackId": track_id, "rated": rated, "failed": failed})
            if len(new_vectors) >= MASTER_FLUSH_EVERY:
                merge_into_master(master_path, new_vectors)
                new_vectors = {}
    finally:
        # Also reached when the app cancels the run, so finished vectors are kept.
        merge_into_master(master_path, new_vectors)

    emit({"type": "done", "total": len(pending), "rated": rated, "failed": failed, "skipped": skipped})
    return rated


def main() -> None:
    parser = argparse.ArgumentParser(description="Estimate ratings for tracks the model has not scored yet")
    parser.add_argument("paths", nargs="*", help="Files or folders to rate (default: the whole library)")
    parser.add_argument(
        "--data-root",
        default=os.environ.get("KOLO_DATA_DIR") or str(REPO_ROOT / "kolo.0.data"),
    )
    parser.add_argument("--model", default=str(REPO_ROOT / "models" / "vibe_rating_model.joblib"))
    parser.add_argument("--ids-stdin", action="store_true", help="Read a JSON array of track IDs from stdin")
    parser.add_argument("--force", action="store_true", help="Estimate again even if a track already has a rating")
    parser.add_argument("--device", default=None, help="Torch device for embedding (default: cuda if available)")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON progress stream to stdout")
    args = parser.parse_args()

    def emit(event: dict[str, Any]) -> None:
        if args.json:
            print(json.dumps(event), flush=True)
        elif event["type"] == "init":
            print(f"Tracks to rate: {event['total']} ({event['needEmbedding']} need an embedding)", flush=True)
        elif event["type"] == "stage":
            print("Loading MuQ-MuLan...", flush=True)
        elif event["type"] == "progress":
            outcome = f"{event['rating']:.1f} stars" if event["success"] else f"failed: {event['error']}"
            print(f"[{event['current']}/{event['total']}] {outcome} | {event['track']}", flush=True)
        elif event["type"] == "done":
            print(f"Rated {event['rated']} tracks, {event['failed']} failed, {event['skipped']} already rated")

    def stop(signum: int, _frame: Any) -> None:
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, stop)

    try:
        data_root = Path(args.data_root).resolve()
        tracks = requested_tracks(data_root, args)
        rate(data_root, Path(args.model), tracks, args.force, args.device, emit)
    except Exception as error:
        if not args.json:
            raise
        emit({"type": "error", "error": str(error)})
        sys.exit(1)


if __name__ == "__main__":
    main()
