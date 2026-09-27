"""
Extracts fixed-size 512-dim embedding vectors from audio files using MuQ-MuLan.
Designed to be gentle on system resources (throttled GPU usage, low VRAM, resumable).

Outputs:
  - JSON format (e.g. data/pos_embeddings.json)
  - NPZ format (e.g. data/pos_embeddings.npz)
"""

import argparse
import json
from pathlib import Path
import sys
import time

from muq import MuQMuLan
import numpy as np
import torch
import torchaudio
from tqdm import tqdm


def load_audio(path: Path, target_sr: int = 24000) -> torch.Tensor:
    """Loads and resamples audio to target_sr mono tensor of shape (1, T)."""
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


def main():
    parser = argparse.ArgumentParser(description="Extract MuQ-MuLan audio embeddings.")
    parser.add_argument("--input-dir", type=str, default="kolo.0.data/pos", help="Directory of audio files")
    parser.add_argument(
        "--output-json",
        type=str,
        default="kolo.0.data/pos_embeddings.json",
        help="Path for JSON output",
    )
    parser.add_argument(
        "--output-npz",
        type=str,
        default="kolo.0.data/pos_embeddings.npz",
        help="Path for NPZ output",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cuda" if torch.cuda.is_available() else "cpu",
        help="Device (cuda/cpu)",
    )
    parser.add_argument(
        "--throttle-sec",
        type=float,
        default=0.05,
        help="Sleep duration between tracks to keep GPU cool",
    )
    parser.add_argument("--checkpoint-every", type=int, default=50, help="Save progress every N tracks")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    if not input_dir.exists():
        script_dir = Path(__file__).resolve().parent
        if (script_dir / args.input_dir).exists():
            input_dir = script_dir / args.input_dir
        elif (script_dir.parent / args.input_dir).exists():
            input_dir = script_dir.parent / args.input_dir

    if not input_dir.exists():
        print(f"Error: input directory {input_dir} not found.")
        sys.exit(1)

    audio_files = sorted([
        p for p in input_dir.iterdir()
        if p.is_file() and p.suffix.lower() in [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".webm"]
    ])
    total_files = len(audio_files)
    print(f"Found {total_files} audio files in {input_dir}")

    # Resume capability: load existing JSON if present
    processed = {}
    json_path = Path(args.output_json)
    if json_path.exists():
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data.get("tracks", []):
                    processed[item["file"]] = item
            print(f"Resuming: found {len(processed)} already processed tracks in {json_path}")
        except Exception as e:
            print(f"Warning: could not parse existing JSON ({e}), starting fresh.")

    # Load Model
    print(f"Loading OpenMuQ/MuQ-MuLan-large on {args.device}...")
    mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large").to(args.device).eval()
    print(f"Model loaded. Model sample rate: {mulan.sr} Hz")

    def save_checkpoint(records):
        json_obj = {
            "model": "OpenMuQ/MuQ-MuLan-large",
            "embedding_dim": 512,
            "count": len(records),
            "tracks": list(records.values()),
        }
        temp_json = json_path.with_suffix(".tmp.json")
        with open(temp_json, "w", encoding="utf-8") as f:
            json.dump(json_obj, f)
        temp_json.replace(json_path)

        if args.output_npz and len(records) > 0:
            npz_path = Path(args.output_npz)
            temp_npz = npz_path.with_suffix(".tmp.npz")
            sorted_items = sorted(records.values(), key=lambda x: x["file"])
            filenames = np.array([x["file"] for x in sorted_items])
            durations = np.array([x["duration"] for x in sorted_items], dtype=np.float32)
            embeddings = np.array([x["embedding"] for x in sorted_items], dtype=np.float32)
            np.savez_compressed(temp_npz, filenames=filenames, durations=durations, embeddings=embeddings)
            temp_npz.replace(npz_path)

    start_time = time.time()
    skipped_count = 0
    new_count = 0

    pbar = tqdm(audio_files, desc="Extracting embeddings", unit="track")
    for idx, p in enumerate(pbar):
        if p.name in processed:
            skipped_count += 1
            continue

        try:
            wav = load_audio(p, target_sr=mulan.sr)
            dur = float(wav.shape[1] / mulan.sr)

            wav = wav.to(args.device)
            with torch.no_grad():
                emb = mulan(wav, parallel_processing=False)

            emb_list = [round(float(v), 6) for v in emb.squeeze(0).cpu().numpy()]

            processed[p.name] = {
                "file": p.name,
                "duration": round(dur, 2),
                "embedding": emb_list,
            }
            new_count += 1

            if args.throttle_sec > 0:
                time.sleep(args.throttle_sec)

        except Exception as e:
            print(f"\nError processing {p.name}: {e}")

        if new_count > 0 and new_count % args.checkpoint_every == 0:
            save_checkpoint(processed)

    save_checkpoint(processed)
    elapsed = time.time() - start_time
    print(f"\nExtraction complete in {elapsed:.1f}s.")
    print(f"Total tracks: {len(processed)} ({new_count} newly processed, {skipped_count} skipped).")
    print(f"Saved JSON to: {args.output_json}")
    if args.output_npz:
        print(f"Saved NPZ to:  {args.output_npz}")


if __name__ == "__main__":
    main()
