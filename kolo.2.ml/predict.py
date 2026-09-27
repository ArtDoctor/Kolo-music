"""
Inference tool for Kolo.
Scores audio against the personal music preference model (0.5 to 5.0 stars).
"""

import argparse
import csv
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import joblib
from muq import MuQMuLan
from sklearn.preprocessing import normalize
import torch
import torchaudio

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def load_model(model_path: Path):
    if not model_path.exists():
        raise FileNotFoundError(f"Trained model not found at {model_path}. Run training first.")
    return joblib.load(model_path)


def load_audio(path: Path, target_sr: int = 24000) -> torch.Tensor:
    """Loads audio file and resamples to target_sr mono tensor."""
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


def download_youtube_audio(url: str, temp_dir: Path) -> Path:
    """Downloads audio from a YouTube link to a temporary mp3 file."""
    output_template = str(temp_dir / "%(title)s [%(id)s].%(ext)s")
    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "-x",
        "--audio-format",
        "mp3",
        "--no-playlist",
        "-o",
        output_template,
        url,
    ]
    node_bin = shutil.which("node")
    if node_bin:
        cmd.extend(["--js-runtimes", f"node:{node_bin}"])

    print(f"Downloading audio from: {url}...")
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)

    mp3s = list(temp_dir.glob("*.mp3"))
    if not mp3s:
        raise RuntimeError("Failed to download audio from YouTube.")
    return mp3s[0]


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


def score_file(audio_path: Path, mulan, classifier_bundle, device):
    wav = load_audio(audio_path, target_sr=mulan.sr).to(device)
    with torch.no_grad():
        emb = mulan(wav, parallel_processing=False)
    emb_np = emb.squeeze(0).cpu().numpy().reshape(1, -1)

    if classifier_bundle.get("l2_normalize", True):
        emb_np = normalize(emb_np, norm="l2")

    clf = classifier_bundle["model"]
    if hasattr(clf, "predict_rating"):
        rating = float(clf.predict_rating(emb_np)[0])
        prob = float(clf.predict_vibe_score(emb_np)[0])
    elif hasattr(clf, "predict_proba"):
        prob = float(clf.predict_proba(emb_np)[0, 1])
        rating = 0.5 + 4.5 * prob
    else:
        prob = float(clf.predict(emb_np)[0])
        rating = 0.5 + 4.5 * prob

    return rating, prob


def main():
    parser = argparse.ArgumentParser(description="Predict if a song matches personal preference.")
    parser.add_argument("--input", type=str, default=None, help="Path to single audio file.")
    parser.add_argument("--url", type=str, default=None, help="YouTube link to score.")
    parser.add_argument("--dir", type=str, default=None, help="Directory of audio files to rank.")
    parser.add_argument("--model", type=str, default="models/vibe_classifier.joblib", help="Path to trained model.")
    parser.add_argument("--save-csv", type=str, default=None, help="Optional CSV path to save ranked results.")
    args = parser.parse_args()

    if not any([args.input, args.url, args.dir]):
        parser.print_help()
        sys.exit(1)

    model_path = Path(args.model)
    if not model_path.exists():
        script_dir = Path(__file__).resolve().parent
        if (script_dir / args.model).exists():
            model_path = script_dir / args.model
        elif (script_dir.parent / args.model).exists():
            model_path = script_dir.parent / args.model
    bundle = load_model(model_path)
    print(f"Loaded model: {bundle.get('model_name', 'Custom')} (trained on 512-dim MuQ-MuLan embeddings)")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading MuQ-MuLan encoder on {device}...")
    mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large").to(device).eval()

    if args.input:
        fpath = Path(args.input)
        if not fpath.exists():
            print(f"File not found: {fpath}")
            sys.exit(1)
        rating, score = score_file(fpath, mulan, bundle, device)
        print("\n" + "=" * 65)
        print(f"Track: {fpath.name}")
        print(f"Rating: {rating:.2f} / 5.0 stars")
        print(f"Vibe Score: {render_vibe_meter(score)}")
        print("=" * 65)

    elif args.url:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            audio_f = download_youtube_audio(args.url, tmp_path)
            rating, score = score_file(audio_f, mulan, bundle, device)
            print("\n" + "=" * 65)
            print(f"Track: {audio_f.stem}")
            print(f"Rating: {rating:.2f} / 5.0 stars")
            print(f"Vibe Score: {render_vibe_meter(score)}")
            print("=" * 65)

    elif args.dir:
        folder = Path(args.dir)
        exts = [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".opus", ".webm"]
        files = sorted([f for f in folder.iterdir() if f.suffix.lower() in exts])
        print(f"\nScoring {len(files)} files in {folder}...")

        results = []
        for i, f in enumerate(files):
            try:
                rating, sc = score_file(f, mulan, bundle, device)
                results.append((f.name, rating, sc))
                print(f"  [{i+1:>3}/{len(files)}] {rating:.2f} stars | {render_vibe_meter(sc):<30} | {f.name}")
            except Exception as e:
                print(f"Error on {f.name}: {e}")

        results.sort(key=lambda x: -x[1])
        print("\n" + "=" * 95)
        print(f"{'Rank':<5} | {'Rating':<10} | {'Vibe Score':<30} | {'Track Name'}")
        print("=" * 95)
        for rank, (name, rating, sc) in enumerate(results, 1):
            print(f"#{rank:<4} | {rating:>5.2f} stars | {render_vibe_meter(sc):<30} | {name}")
        print("=" * 95)

        if args.save_csv:
            csv_path = Path(args.save_csv)
            with open(csv_path, "w", newline="", encoding="utf-8") as f_csv:
                writer = csv.writer(f_csv)
                writer.writerow(["Rank", "Track", "Rating", "Vibe_Score_Pct", "Vibe_Score_Raw", "Vibe_Category"])
                for rank, (name, rating, sc) in enumerate(results, 1):
                    pct = sc * 100
                    if pct >= 75:
                        tag = "STRONG MATCH"
                    elif pct >= 50:
                        tag = "LIKELY MATCH"
                    elif pct >= 30:
                        tag = "BORDERLINE"
                    else:
                        tag = "LOW MATCH"
                    writer.writerow([rank, name, f"{rating:.2f}", f"{pct:.1f}%", f"{sc:.4f}", tag])
            print(f"\nSaved ranked results to: {csv_path}")


if __name__ == "__main__":
    main()
