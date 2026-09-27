"""
Scrapes candidates across identified musical archetypes, downloads fresh songs,
extracts audio embeddings, and scores tracks with the trained preference classifier.
"""

import argparse
import csv
import json
from pathlib import Path
import re
import shutil
from typing import Any

import joblib
from muq import MuQMuLan
from sklearn.preprocessing import normalize
import torch
import torchaudio
import yt_dlp

# Curated queries targeting taste archetypes
CURATED_QUERIES = [
    # 1. British Garage Indie & Post-Punk Revival
    ("British Garage Indie", "ytsearch6:The Reytons official audio"),
    ("British Garage Indie", "ytsearch6:Inhaler band official audio"),
    ("British Garage Indie", "ytsearch6:Circa Waves official audio"),
    ("British Garage Indie", "ytsearch6:The Snuts official audio"),
    ("British Garage Indie", "ytsearch6:Wunderhorse official audio"),
    # 2. Electronic Rock & Dark Alt-Rock / Dark Pop
    ("Electronic Rock", "ytsearch6:Des Rocs official audio"),
    ("Electronic Rock", "ytsearch6:Dead Poet Society official audio"),
    ("Electronic Rock", "ytsearch6:Cleopatrick official audio"),
    ("Electronic Rock", "ytsearch6:Yonaka official audio"),
    ("Electronic Rock", "ytsearch6:Royal Blood official audio"),
    ("Electronic Rock", "ytsearch6:Nothing But Thieves official audio"),
    ("Electronic Rock", "ytsearch6:Barns Courtney official audio"),
    # 3. Drift Phonk & Dark Wave / Synthwave
    ("Drift Phonk & Dark Wave", "ytsearch6:Kordhell official audio"),
    ("Drift Phonk & Dark Wave", "ytsearch6:Pharmacist phonk official audio"),
    ("Drift Phonk & Dark Wave", "ytsearch6:SXID official audio"),
    ("Drift Phonk & Dark Wave", "ytsearch6:pastel ghost official audio"),
    ("Drift Phonk & Dark Wave", "ytsearch6:Narvent official audio"),
    ("Drift Phonk & Dark Wave", "ytsearch6:Ghostface Playa official audio"),
    # 4. Dark Electronic / Slap House / Bass
    ("Dark Slap House & Bass", "ytsearch6:Besomorph official audio"),
    ("Dark Slap House & Bass", "ytsearch6:Neoni official audio"),
    ("Dark Slap House & Bass", "ytsearch6:Rompasso official audio"),
    ("Dark Slap House & Bass", "ytsearch6:Two Feet official audio"),
    # 5. Indie Noir & Moody Melancholy Alt
    ("Indie Noir & Moody Alt", "ytsearch6:Foals official audio"),
    ("Indie Noir & Moody Alt", "ytsearch6:KALEO official audio"),
    ("Indie Noir & Moody Alt", "ytsearch6:Mansionair official audio"),
    ("Indie Noir & Moody Alt", "ytsearch6:Matt Maeson official audio"),
]

FILTER_REGEX = re.compile(
    r"(live|concert|tour|reaction|react|interview|behind the scenes|full album|"
    r"compilation|hour|mix|cover|tutorial|podcast|review|karaoke|mashup|unreleased leak)",
    re.IGNORECASE,
)


def clean_str(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]", "", s).lower()


def load_existing_signatures() -> set[str]:
    signatures = set()
    script_dir = Path(__file__).resolve().parent
    root_dir = script_dir.parent
    candidate_dirs = [
        Path("kolo.0.data/pos"),
        Path("kolo.0.data/downloads/OLD"),
        Path("kolo.0.data/neg"),
        root_dir / "kolo.0.data/pos",
        root_dir / "kolo.0.data/downloads/OLD",
        root_dir / "kolo.0.data/neg",
    ]
    for dir_path in candidate_dirs:
        if dir_path.exists():
            for f in dir_path.glob("*.mp3"):
                stem = f.stem
                stem = re.sub(r"\[[a-zA-Z0-9_-]{11}\]", "", stem)
                signatures.add(clean_str(stem))
    print(f"Loaded {len(signatures)} existing track signatures for deduplication.")
    return signatures


def search_candidates(
    existing_sigs: set[str],
    max_per_genre: int = 8,
    total_target: int = 40,
) -> list[dict[str, Any]]:
    genre_counts: dict[str, int] = {}
    selected_candidates: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    ydl_opts: dict[str, Any] = {
        "extract_flat": True,
        "quiet": True,
        "skip_download": True,
    }

    node_path = shutil.which("node")
    if node_path:
        ydl_opts["js_runtimes"] = {"node": {"path": node_path}}

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for genre, query in CURATED_QUERIES:
            if len(selected_candidates) >= total_target:
                break
            if genre_counts.get(genre, 0) >= max_per_genre:
                continue

            try:
                res = ydl.extract_info(query, download=False)
                if not res or "entries" not in res:
                    continue

                for entry in res["entries"]:
                    if len(selected_candidates) >= total_target:
                        break
                    if genre_counts.get(genre, 0) >= max_per_genre:
                        break

                    video_id = entry.get("id")
                    title = entry.get("title", "")
                    duration = entry.get("duration")

                    if not video_id or video_id in seen_ids:
                        continue
                    if duration and (duration < 75 or duration > 360):
                        continue
                    if FILTER_REGEX.search(title):
                        continue

                    cleaned = clean_str(title)
                    is_dupe = any(sig in cleaned or cleaned in sig for sig in existing_sigs if len(sig) > 8)
                    if is_dupe:
                        continue

                    seen_ids.add(video_id)
                    genre_counts[genre] = genre_counts.get(genre, 0) + 1
                    selected_candidates.append({
                        "id": video_id,
                        "title": title,
                        "genre": genre,
                        "url": f"https://www.youtube.com/watch?v={video_id}",
                        "duration": duration or 0,
                    })
                    print(f"  Queued: [{genre}] {title} ({duration}s)")
            except Exception as e:
                print(f"Search error for {query}: {e}")

    print(f"\nTotal new candidate songs selected: {len(selected_candidates)}")
    return selected_candidates


def download_audio(candidates: list[dict[str, Any]], output_dir: Path) -> list[dict[str, Any]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    downloaded_tracks: list[dict[str, Any]] = []
    node_path = shutil.which("node")

    for i, c in enumerate(candidates, 1):
        target_template = str(output_dir / "%(title)s [%(id)s].%(ext)s")
        ydl_opts: dict[str, Any] = {
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
            "outtmpl": target_template,
            "quiet": True,
            "no_warnings": True,
        }
        if node_path:
            ydl_opts["js_runtimes"] = {"node": {"path": node_path}}

        print(f"  [{i:>2}/{len(candidates)}] Downloading: {c['title']}...")
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([c["url"]])

            matches = list(output_dir.glob(f"*{c['id']}*.mp3"))
            if matches:
                c["local_path"] = str(matches[0])
                downloaded_tracks.append(c)
            else:
                print(f"    Failed to find downloaded mp3 for {c['id']}")
        except Exception as e:
            print(f"    Download failed for {c['title']}: {e}")

    print(f"\nSuccessfully downloaded {len(downloaded_tracks)} tracks into {output_dir}")
    return downloaded_tracks


def load_audio(path: Path, target_sr: int = 24000) -> torch.Tensor:
    try:
        wav, sr = torchaudio.load(str(path))
        if sr != target_sr:
            resampler = torchaudio.transforms.Resample(sr, target_sr)
            wav = resampler(wav)
        if wav.shape[0] > 1:
            wav = torch.mean(wav, dim=0, keepdim=True)
        return wav
    except Exception:
        import librosa

        y, _ = librosa.load(str(path), sr=target_sr, mono=True)
        return torch.tensor(y, dtype=torch.float32).unsqueeze(0)


def render_vibe_meter(score: float, width: int = 20) -> str:
    filled = int(round(score * width))
    bar = "=" * filled + "-" * (width - filled)
    pct = score * 100
    if pct >= 75:
        tag = "STRONG MATCH"
    elif pct >= 50:
        tag = "LIKELY MATCH"
    elif pct >= 30:
        tag = "BORDERLINE"
    else:
        tag = "LOW MATCH"
    return f"[{bar}] {pct:5.1f}% | {tag}"


def run_predictions(tracks: list[dict[str, Any]], model_path: Path) -> list[dict[str, Any]]:
    bundle = joblib.load(model_path)
    clf = bundle["model"]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"\nLoading MuQ-MuLan encoder on {device}...")
    mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large").to(device).eval()

    print(f"Scoring {len(tracks)} tracks with preference classifier...")
    for i, t in enumerate(tracks, 1):
        fpath = Path(t["local_path"])
        try:
            wav = load_audio(fpath, target_sr=mulan.sr).to(device)
            with torch.no_grad():
                emb = mulan(wav, parallel_processing=False)
            emb_np = emb.squeeze(0).cpu().numpy().reshape(1, -1)
            emb_np = normalize(emb_np, norm="l2")

            if hasattr(clf, "predict_proba"):
                prob = float(clf.predict_proba(emb_np)[0, 1])
            else:
                prob = float(clf.predict(emb_np)[0])

            t["vibe_score"] = prob
            pct = prob * 100
            if pct >= 75:
                tag = "STRONG MATCH"
            elif pct >= 50:
                tag = "LIKELY MATCH"
            elif pct >= 30:
                tag = "BORDERLINE"
            else:
                tag = "LOW MATCH"
            t["category"] = tag

            print(f"  [{i:>2}/{len(tracks)}] {render_vibe_meter(prob):<30} | {t['title'][:40]}")
        except Exception as e:
            print(f"  Failed to score {fpath.name}: {e}")
            t["vibe_score"] = 0.0
            t["category"] = "ERROR"

    tracks.sort(key=lambda x: -x["vibe_score"])
    return tracks


def main():
    parser = argparse.ArgumentParser(description="Scrape and discover new music based on user vibe.")
    parser.add_argument("--count", type=int, default=40, help="Target number of candidate songs (default: 40)")
    parser.add_argument("--outdir", type=str, default="kolo.0.data/discovery", help="Directory to store downloads")
    parser.add_argument("--model", type=str, default="models/vibe_classifier.joblib", help="Path to trained model")
    args = parser.parse_args()

    out_dir = Path(args.outdir)
    out_dir.mkdir(parents=True, exist_ok=True)

    existing_sigs = load_existing_signatures()
    candidates = search_candidates(existing_sigs, max_per_genre=10, total_target=args.count)

    if not candidates:
        print("No candidates found.")
        return

    downloaded = download_audio(candidates, out_dir)
    if not downloaded:
        print("No tracks downloaded.")
        return

    scored_tracks = run_predictions(downloaded, Path(args.model))

    # Save results to JSON and CSV
    json_path = out_dir / "discovery_results.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(scored_tracks, f, indent=2)

    csv_path = out_dir / "discovery_results.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Rank", "Title", "Genre_Archetype", "Vibe_Score_Pct", "Category", "YouTube_URL", "Filename"])
        for rank, t in enumerate(scored_tracks, 1):
            writer.writerow([
                rank,
                t["title"],
                t["genre"],
                f"{t['vibe_score']*100:.1f}%",
                t["category"],
                t["url"],
                Path(t["local_path"]).name,
            ])

    print(f"\nResults saved to:\n  - {csv_path}\n  - {json_path}")

    # Print summary leaderboard
    print("\n" + "=" * 95)
    print(f"{'Rank':<5} | {'Vibe Score':<30} | {'Genre':<22} | {'Track Title'}")
    print("=" * 95)
    for rank, t in enumerate(scored_tracks, 1):
        print(f"#{rank:<4} | {render_vibe_meter(t['vibe_score']):<30} | {t['genre']:<22} | {t['title'][:32]}")
    print("=" * 95)


if __name__ == "__main__":
    main()
