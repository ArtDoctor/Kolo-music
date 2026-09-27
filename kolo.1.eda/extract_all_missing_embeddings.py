"""Update MuQ-MuLan embedding caches for the main audio partitions."""

import argparse
import json
from pathlib import Path
import time
from typing import Any

from muq import MuQMuLan
import numpy as np
import torch
import torchaudio
from tqdm import tqdm

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".flac", ".ogg", ".webm", ".aac", ".opus"}


def load_and_resample_audio(file_path: Path, target_sr: int, device: str) -> tuple[torch.Tensor, float]:
    """Load mono audio on ``device`` and return it with its duration."""
    try:
        wav, sr = torchaudio.load(str(file_path))
        if wav.shape[0] > 1:
            wav = wav.mean(dim=0, keepdim=True)
        if sr != target_sr:
            wav = torchaudio.functional.resample(wav.to(device), sr, target_sr)
        else:
            wav = wav.to(device)
        dur = float(wav.shape[1] / target_sr)
        return wav, dur
    except Exception:
        import librosa

        y, _ = librosa.load(str(file_path), sr=target_sr, mono=True)
        wav = torch.tensor(y, dtype=torch.float32).unsqueeze(0).to(device)
        dur = float(len(y) / target_sr)
        return wav, dur


def extract_track_embedding(mulan: MuQMuLan, wav: torch.Tensor, device: str) -> list[float]:
    """Extract one embedding, processing unusually long files in batches."""
    target_sr = mulan.sr
    clip_samples = int(target_sr * mulan.clip_secs)
    total_samples = wav.shape[1]

    if total_samples <= clip_samples * 30:
        with torch.no_grad():
            emb = mulan(wav, parallel_processing=True)
        return [round(float(v), 6) for v in emb.squeeze(0).cpu().numpy()]

    all_clips = mulan._get_all_clips(wav.squeeze(0))
    latents = []
    chunk_size = 20
    with torch.no_grad():
        for i in range(0, len(all_clips), chunk_size):
            batch = all_clips[i:i + chunk_size].to(device)
            clip_latents = mulan.mulan_module.get_audio_latents(batch)
            latents.append(clip_latents)
    all_latents = torch.cat(latents, dim=0)
    emb = all_latents.mean(dim=0)
    return [round(float(v), 6) for v in emb.cpu().numpy()]


def save_subset_cache(output_json: Path, output_npz: Path, records: dict[str, Any]):
    """Saves checkpoint to JSON and compressed NPZ."""
    output_json.parent.mkdir(parents=True, exist_ok=True)
    temp_json = output_json.with_suffix(".tmp.json")
    json_obj = {
        "model": "OpenMuQ/MuQ-MuLan-large",
        "embedding_dim": 512,
        "count": len(records),
        "tracks": list(records.values()),
    }
    with open(temp_json, "w", encoding="utf-8") as f:
        json.dump(json_obj, f, indent=2)
    temp_json.replace(output_json)

    if output_npz and records:
        output_npz.parent.mkdir(parents=True, exist_ok=True)
        temp_npz = output_npz.with_suffix(".tmp.npz")
        sorted_items = sorted(records.values(), key=lambda x: x["file"])
        filenames = np.array([x["file"] for x in sorted_items])
        durations = np.array([x["duration"] for x in sorted_items], dtype=np.float32)
        embeddings = np.array([x["embedding"] for x in sorted_items], dtype=np.float32)
        np.savez_compressed(temp_npz, filenames=filenames, durations=durations, embeddings=embeddings)
        temp_npz.replace(output_npz)


def process_directory(
    mulan: MuQMuLan,
    input_dir: Path,
    output_json: Path,
    output_npz: Path,
    device: str,
    checkpoint_every: int = 20,
) -> dict[str, Any]:
    """Extracts embeddings for all audio files in a directory."""
    if not input_dir.exists():
        print(f"Directory {input_dir} does not exist, skipping.")
        return {}

    audio_files = sorted([
        p for p in input_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in AUDIO_EXTENSIONS and not p.name.startswith(".")
    ])

    print(f"\nProcessing '{input_dir.name}' ({len(audio_files)} tracks found)...")

    records = {}
    if output_json.exists():
        try:
            with open(output_json, "r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data.get("tracks", []):
                    records[item["file"]] = item
            print(f"Resumed: {len(records)}/{len(audio_files)} already processed.")
        except Exception as e:
            print(f"Warning reading {output_json}: {e}")

    new_count = 0
    pbar = tqdm(audio_files, desc=f"Embedding {input_dir.name}", unit="track")
    for file_path in pbar:
        rel_key = file_path.name
        if rel_key in records:
            continue

        try:
            wav, dur = load_and_resample_audio(file_path, mulan.sr, device)
            emb = extract_track_embedding(mulan, wav, device)
            records[rel_key] = {
                "file": rel_key,
                "path": str(file_path.relative_to(input_dir)),
                "duration": round(dur, 2),
                "embedding": emb,
            }
            new_count += 1

            if new_count % checkpoint_every == 0:
                save_subset_cache(output_json, output_npz, records)
        except Exception as e:
            print(f"\nError processing {file_path.name}: {e}")

    save_subset_cache(output_json, output_npz, records)
    print(f"Finished {input_dir.name}: {len(records)} total tracks cached.")
    return records


def consolidate_master_embeddings(data_root: Path):
    """Combine partition caches into the canonical track-ID lookup."""
    print("\nConsolidating all embeddings into master lookup index...")
    id_map = {}

    subsets = [
        ("pos_embeddings.npz", "pos"),
        ("neg_embeddings.npz", "neg"),
        ("downloads_embeddings.npz", "downloads/OLD"),
        ("discovery_embeddings.npz", "discovery"),
        ("imported_embeddings.npz", "imported"),
    ]

    for npz_name, relative_folder in subsets:
        npz_path = data_root / npz_name
        if not npz_path.exists():
            continue
        try:
            data = np.load(str(npz_path))
            filenames = data["filenames"]
            embeddings = data["embeddings"]
            durations = data.get("durations", np.zeros(len(filenames), dtype=np.float32))

            for fn, emb, dur in zip(filenames, embeddings, durations):
                track_id = f"{relative_folder}/{fn}"
                id_map[track_id] = {
                    "embedding": emb,
                    "duration": float(dur),
                }
            print(f"  Loaded {len(filenames)} vectors from {npz_name}")
        except Exception as e:
            print(f"  Failed to read {npz_name}: {e}")

    if not id_map:
        print("No embeddings found to consolidate.")
        return

    out_dir = data_root / ".kolo"
    out_dir.mkdir(parents=True, exist_ok=True)
    master_npz = out_dir / "all_embeddings.npz"

    if master_npz.exists():
        try:
            existing = np.load(str(master_npz))
            existing_durations = existing.get("durations", np.zeros(len(existing["ids"]), dtype=np.float32))
            preserved = 0
            for track_id, embedding, duration in zip(existing["ids"], existing["embeddings"], existing_durations):
                track_id = str(track_id)
                if track_id.startswith("playlists/") and (data_root / track_id).is_file() and track_id not in id_map:
                    id_map[track_id] = {"embedding": embedding, "duration": float(duration)}
                    preserved += 1
            if preserved:
                print(f"  Preserved {preserved} custom-playlist vectors from the master index")
        except Exception as e:
            print(f"  Could not preserve custom-playlist vectors: {e}")

    sorted_ids = sorted(id_map.keys())
    id_array = np.array(sorted_ids)
    emb_array = np.array([id_map[i]["embedding"] for i in sorted_ids], dtype=np.float32)
    dur_array = np.array([id_map[i]["duration"] for i in sorted_ids], dtype=np.float32)

    temp_npz = master_npz.with_suffix(".tmp.npz")
    np.savez_compressed(temp_npz, ids=id_array, embeddings=emb_array, durations=dur_array)
    temp_npz.replace(master_npz)
    print(f"Saved master index with {len(id_array)} vectors to {master_npz}")


def main():
    parser = argparse.ArgumentParser(description="Extract embeddings for all missing tracks.")
    parser.add_argument("--data-root", type=str, default="kolo.0.data", help="Root data folder")
    parser.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--skip-master", action="store_true", help="Skip consolidating master index")
    args = parser.parse_args()

    data_root = Path(args.data_root).resolve()
    print(f"Data root: {data_root}")
    device_label = torch.cuda.get_device_name(0) if args.device == "cuda" else "CPU"
    print(f"Using device: {args.device} ({device_label})")

    print("Loading MuQ-MuLan model...")
    t0 = time.time()
    mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large").to(args.device).eval()
    print(f"Loaded MuQ-MuLan in {time.time() - t0:.2f}s (Sample Rate: {mulan.sr} Hz)")

    downloads_dir = data_root / "downloads" / "OLD"
    process_directory(
        mulan=mulan,
        input_dir=downloads_dir,
        output_json=data_root / "downloads_embeddings.json",
        output_npz=data_root / "downloads_embeddings.npz",
        device=args.device,
    )

    discovery_dir = data_root / "discovery"
    process_directory(
        mulan=mulan,
        input_dir=discovery_dir,
        output_json=data_root / "discovery_embeddings.json",
        output_npz=data_root / "discovery_embeddings.npz",
        device=args.device,
    )

    imported_dir = data_root / "imported"
    process_directory(
        mulan=mulan,
        input_dir=imported_dir,
        output_json=data_root / "imported_embeddings.json",
        output_npz=data_root / "imported_embeddings.npz",
        device=args.device,
    )

    if not args.skip_master:
        consolidate_master_embeddings(data_root)

    print("\nEmbedding extraction complete")


if __name__ == "__main__":
    main()
