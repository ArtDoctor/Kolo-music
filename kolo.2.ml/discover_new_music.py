"""Search candidate tracks, score them, and retain predictions above a threshold.

Candidates are searched on YouTube, checked against every existing library
filename and YouTube ID, downloaded to a temporary staging folder, embedded
with MuQ-MuLan, and scored by the current personal rating model. Only tracks
whose continuous prediction rounds to at least 4 stars are retained in the
custom "AI Discoveries" app playlist.
"""

import argparse
import importlib.util
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import joblib
import mlflow
import numpy as np
import torch
import yt_dlp
from muq import MuQMuLan

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Curated search seeds; acceptance is based on the downloaded audio score.
CANDIDATES = [
    ("Muse", "Assassin"),
    ("The Strokes", "Reptilia"),
    ("Them Crooked Vultures", "Elephants"),
    ("Queens of the Stone Age", "Song for the Dead"),
    ("Bloc Party", "Helicopter"),
    ("Miles Kane", "Come Closer"),
    ("The Last Shadow Puppets", "Dracula Teeth"),
    ("The Last Shadow Puppets", "Pattern"),
    ("The Hives", "Two-Timing Touch and Broken Bones"),
    ("Kiasmos", "Jarred"),
    ("Max Cooper", "Lovesong"),
    ("David August", "Last Day"),
    ("Janus Rasmussen", "April"),
    ("Grandbrothers", "Famara Dust"),
    ("Kollektiv Turmstrasse", "Schwindelig"),
    ("DARKSIDE", "Golden Arrow"),
    ("Moderat", "Bad Kingdom"),
    ("Apparat", "Goodbye"),
    ("Bob Moses", "Tearing Me Up"),
    ("Gidge", "New Light"),
    ("Portishead", "The Rip"),
    ("Agnes Obel", "The Curse"),
    ("The Black Keys", "Howlin' for You"),
    ("Trentemøller", "Take Me Into Your Skin"),
    ("Rival Consoles", "Recovery"),
    ("The Anix", "CRAWL"),
    ("The Anix", "Your Lies Are Like Fire"),
    ("I Will Never Be the Same", "Forces"),
    ("I Will Never Be the Same", "Skyhunter"),
    ("I Will Never Be the Same", "Fantasy"),
    ("MISSIO", "I See You"),
    ("Nouveau Arcade", "Guns & Candy"),
    ("Nouveau Arcade", "Gaslight"),
    ("Cyan Kicks", "Gasoline"),
]

BLOCKED_TITLE_WORDS = re.compile(
    r"\b(live|reaction|interview|cover|karaoke|tutorial|full album|sped up|slowed)\b",
    re.I,
)
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".flac", ".ogg", ".webm", ".aac", ".opus"}


def signature(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def existing_signatures(data_root: Path) -> tuple[set[str], set[str]]:
    names: set[str] = set()
    youtube_ids: set[str] = set()
    for path in data_root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        names.add(signature(path.stem))
        youtube_ids.update(re.findall(r"\[([A-Za-z0-9_-]{11})\]", path.stem))
    return names, youtube_ids


def is_existing(artist: str, title: str, names: set[str]) -> bool:
    wanted = signature(f"{artist} {title}")
    title_only = signature(title)
    return any(
        wanted == known
        or (len(wanted) > 10 and wanted in known)
        or (len(known) > 10 and known in wanted)
        or (len(title_only) > 8 and title_only in known and signature(artist) in known)
        for known in names
    )


def search_youtube(artist: str, title: str) -> dict[str, Any] | None:
    options = {"extract_flat": True, "quiet": True, "no_warnings": True, "skip_download": True, "playlistend": 4}
    query = f"ytsearch4:{artist} {title} official audio"
    with yt_dlp.YoutubeDL(options) as ydl:
        result = ydl.extract_info(query, download=False)
    for entry in (result or {}).get("entries", []):
        duration = entry.get("duration") or 0
        candidate_title = entry.get("title") or ""
        if not entry.get("id") or BLOCKED_TITLE_WORDS.search(candidate_title):
            continue
        if duration and not 75 <= duration <= 420:
            continue
        return {
            "youtube_id": entry["id"],
            "youtube_title": candidate_title,
            "source_url": f"https://www.youtube.com/watch?v={entry['id']}",
            "duration": duration,
        }
    return None


def download(search: dict[str, Any], staging: Path) -> Path | None:
    output = str(staging / f"%(title)s [{search['youtube_id']}].%(ext)s")
    options = {
        "format": "bestaudio/best",
        "outtmpl": output,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
        "postprocessor_args": {"ExtractAudio": ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]},
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        ydl.download([search["source_url"]])
    marker = f"[{search['youtube_id']}]"
    matches = [path for path in staging.glob("*.mp3") if marker in path.name]
    return matches[0] if matches else None


def load_embedding_helpers():
    path = REPO_ROOT / "kolo.1.eda" / "extract_all_missing_embeddings.py"
    spec = importlib.util.spec_from_file_location("kolo_embedding_helpers", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load embedding helpers")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.load_and_resample_audio, module.extract_track_embedding


def update_master(data_root: Path, accepted: list[dict[str, Any]]):
    master_path = data_root / ".kolo" / "all_embeddings.npz"
    current = np.load(master_path)
    records = {
        str(track_id): (embedding, float(duration))
        for track_id, embedding, duration in zip(current["ids"], current["embeddings"], current["durations"])
    }
    for item in accepted:
        records[item["track_id"]] = (
            np.asarray(item["embedding"], dtype=np.float32),
            item["duration"],
        )
    ids = sorted(records)
    temporary = master_path.with_suffix(".tmp.npz")
    np.savez_compressed(
        temporary,
        ids=np.asarray(ids),
        embeddings=np.asarray([records[item][0] for item in ids], dtype=np.float32),
        durations=np.asarray([records[item][1] for item in ids], dtype=np.float32),
    )
    temporary.replace(master_path)


def update_app_state(data_root: Path, accepted: list[dict[str, Any]], playlist_slug: str):
    state = data_root / ".kolo"
    names_path = state / "playlists.json"
    try:
        names = json.loads(names_path.read_text(encoding="utf-8"))
    except Exception:
        names = {}
    names[playlist_slug] = "AI Discoveries"
    names_path.write_text(json.dumps(names, indent=2, ensure_ascii=False), encoding="utf-8")

    ai_path = state / "ai_ratings.json"
    try:
        ai = json.loads(ai_path.read_text(encoding="utf-8"))
    except Exception:
        ai = {"version": "3.0", "ratings": {}}
    ratings = ai.setdefault("ratings", {})
    for item in accepted:
        raw = item["raw_rating"]
        ratings[item["track_id"]] = {
            "rating": item["ai_rating"],
            "rawRating": raw,
            "vibeScore": round((raw - 0.5) / 4.5, 3),
            "category": "strong recommendation" if item["ai_rating"] == 4 else "absolute favorite candidate",
        }
    ai["total_scored"] = len(ratings)
    ai["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    ai_path.write_text(json.dumps(ai, indent=2, ensure_ascii=False), encoding="utf-8")


def write_reports(data_root: Path, all_results: list[dict[str, Any]], accepted: list[dict[str, Any]]):
    omitted_fields = {"embedding", "local_path"}

    def report_item(item: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in item.items() if key not in omitted_fields}

    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "method": "YouTube candidate search followed by MuQ-MuLan audio scoring; existing library excluded",
        "threshold": "continuous score >= 3.75, rounded to a 4.0+ half-star label",
        "tested": len([item for item in all_results if item.get("raw_rating") is not None]),
        "accepted": len(accepted),
        "recommendations": [report_item(item) for item in accepted],
        "all_candidates": [report_item(item) for item in all_results],
    }
    json_path = data_root / ".kolo" / "new_music_discovery.json"
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    intro = (
        "These are newly searched tracks that were not present in the library before this run. "
        "Candidates were downloaded temporarily and audio-scored; only estimates rounding to 4★+ "
        "were kept in the app's **AI Discoveries** playlist."
    )
    lines = [
        "# New Music Discovery Report",
        "",
        intro,
        "",
        f"- Audio candidates scored: **{payload['tested']}**",
        f"- New 4★+ tracks retained: **{len(accepted)}**",
        "",
        "| Track | AI rating | Raw | Source |",
        "|---|---:|---:|---|",
    ]
    for item in accepted:
        label = f"{item['artist']} — {item['title']}".replace("|", "\\|")
        lines.append(
            f"| {label} | {item['ai_rating']:.1f} | {item['raw_rating']:.2f} | [YouTube]({item['source_url']}) |"
        )
    disclaimer = (
        "The raw model is conservative and regresses toward the middle; "
        "half-star labels follow the app's scale and the accepted ±0.5-star uncertainty."
    )
    lines += ["", disclaimer, ""]
    docs_dir = REPO_ROOT / "kolo.2.ml" / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    report_text = "\n".join(lines)
    (docs_dir / "new_music_report.md").write_text(report_text, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", default="kolo.0.data")
    parser.add_argument("--model", default="models/vibe_rating_model.joblib")
    parser.add_argument("--limit", type=int, default=len(CANDIDATES))
    parser.add_argument("--threshold", type=float, default=3.75)
    args = parser.parse_args()

    data_root = Path(args.data_root)
    if not data_root.is_absolute():
        data_root = (REPO_ROOT / data_root).resolve()

    model_path = Path(args.model)
    if not model_path.is_absolute():
        model_path = (REPO_ROOT / model_path).resolve()
    playlist_slug = "ai-discoveries"
    playlist_dir = data_root / "playlists" / playlist_slug
    staging = data_root / ".kolo" / "discovery-staging"
    staging.mkdir(parents=True, exist_ok=True)
    playlist_dir.mkdir(parents=True, exist_ok=True)

    names, youtube_ids = existing_signatures(data_root)
    selected = []
    results: list[dict[str, Any]] = []
    print(f"[*] Checking {min(args.limit, len(CANDIDATES))} candidates against {len(names)} existing tracks")
    for artist, title in CANDIDATES[: args.limit]:
        base = {"artist": artist, "title": title}
        if is_existing(artist, title, names):
            results.append({**base, "status": "already in library"})
            print(f"[-] Existing: {artist} - {title}")
            continue
        try:
            found = search_youtube(artist, title)
            if not found:
                results.append({**base, "status": "no suitable search result"})
                continue
            if found["youtube_id"] in youtube_ids:
                results.append({**base, **found, "status": "already in library"})
                continue
            path = download(found, staging)
            if path is None:
                results.append({**base, **found, "status": "download failed"})
                continue
            item = {**base, **found, "status": "downloaded", "local_path": str(path)}
            selected.append(item)
            results.append(item)
            print(f"[+] Downloaded: {artist} - {title}")
        except Exception as error:
            results.append({**base, "status": "error", "error": str(error)[:300]})
            print(f"[!] {artist} - {title}: {error}")

    if not selected:
        write_reports(data_root, results, [])
        print("[!] No new audio was downloaded")
        return

    bundle = joblib.load(model_path)
    model = bundle["model"]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[*] Loading MuQ-MuLan on {device} to score {len(selected)} genuinely new tracks")
    mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large").to(device).eval()
    load_audio, extract_embedding = load_embedding_helpers()

    accepted = []
    for index, item in enumerate(selected, 1):
        path = Path(item["local_path"])
        try:
            wav, duration = load_audio(path, mulan.sr, device)
            embedding = np.asarray(extract_embedding(mulan, wav, device), dtype=np.float32)
            raw = float(model.predict_rating(embedding.reshape(1, -1))[0])
            displayed = round(raw * 2) / 2
            item.update({"duration": round(duration, 2), "raw_rating": round(raw, 2), "ai_rating": displayed})
            if raw >= args.threshold:
                destination = playlist_dir / path.name
                shutil.move(path, destination)
                item["local_path"] = str(destination)
                item["track_id"] = str(destination.relative_to(data_root)).replace("\\", "/")
                item["embedding"] = embedding
                item["status"] = "accepted"
                accepted.append(item)
                print(f"[✓] {index:>2}/{len(selected)} {raw:.2f}★ KEEP  {item['artist']} - {item['title']}")
            else:
                path.unlink(missing_ok=True)
                item["status"] = "below 4-star threshold"
                print(f"[ ] {index:>2}/{len(selected)} {raw:.2f}★ reject {item['artist']} - {item['title']}")
        except Exception as error:
            path.unlink(missing_ok=True)
            item.update({"status": "scoring error", "error": str(error)[:300]})
            print(f"[!] Scoring failed: {item['artist']} - {item['title']}: {error}")

    if accepted:
        update_master(data_root, accepted)
        update_app_state(data_root, accepted, playlist_slug)
    write_reports(data_root, results, accepted)
    shutil.rmtree(staging, ignore_errors=True)
    print(f"[✓] Added {len(accepted)} new recommendations to the AI Discoveries playlist")

    try:
        tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", f"sqlite:///{REPO_ROOT}/mlruns.db")
        mlflow.set_tracking_uri(tracking_uri)
        mlflow.set_experiment("kolo-music-discovery")
        with mlflow.start_run(run_name=f"discovery_{time.strftime('%Y%m%d_%H%M%S')}"):
            mlflow.log_params({
                "threshold": args.threshold,
                "tested_candidates": len(selected),
                "limit": args.limit,
            })
            mlflow.log_metrics({
                "candidates_tested": len(selected),
                "retained_count": len(accepted),
                "retention_rate": len(accepted) / max(1, len(selected)),
            })
            report_file = REPO_ROOT / "kolo.2.ml" / "docs" / "new_music_report.md"
            if report_file.exists():
                mlflow.log_artifact(str(report_file))
        print("[+] Logged discovery metrics and report to MLflow (mlruns/)")
    except Exception as e:
        print(f"[!] Warning: MLflow tracking failed: {e}")


if __name__ == "__main__":
    main()
