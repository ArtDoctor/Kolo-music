"""Measure MuQ-MuLan load time and embedding throughput on sample tracks."""

from pathlib import Path
import time

import librosa
from muq import MuQMuLan
import torch


def benchmark():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Benchmark device: {device}")

    started = time.perf_counter()
    mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large").to(device).eval()
    loaded = time.perf_counter()
    print(f"MuQ-MuLan loaded in {loaded - started:.2f}s")
    print(f"Model sample rate: {mulan.sr} Hz, clip duration: {mulan.clip_secs}s")
    if torch.cuda.is_available():
        vram_alloc = torch.cuda.memory_allocated() / (1024**2)
        vram_res = torch.cuda.memory_reserved() / (1024**2)
        print(f"VRAM allocated: {vram_alloc:.1f} MB, reserved: {vram_res:.1f} MB")

    pos_dir = Path("kolo.0.data/pos")
    if not pos_dir.exists():
        pos_dir = Path(__file__).resolve().parent.parent / "kolo.0.data/pos"
    supported = {".mp3", ".m4a", ".wav", ".flac", ".ogg", ".webm"}
    test_files = sorted(
        path for path in pos_dir.iterdir() if path.is_file() and path.suffix.lower() in supported
    )[:4]
    if not test_files:
        raise RuntimeError(f"No audio files found in {pos_dir}")

    # Warm up the selected device before timing individual tracks.
    dummy = torch.randn(1, 24000 * 10, device=device)
    with torch.no_grad():
        _ = mulan(dummy)
    if torch.cuda.is_available():
        torch.cuda.synchronize()

    results = []
    print("\n" + "=" * 80)
    header = (
        f"{'Filename':<38} | {'Audio Dur':<10} | {'Load Time':<10} | "
        f"{'GPU Inf':<10} | {'Total':<8} | {'RTF':<8}"
    )
    print(header)
    print("=" * 80)

    for f in test_files:
        if not f.exists():
            continue

        t_load_start = time.perf_counter()
        wav, sr = librosa.load(str(f), sr=mulan.sr, mono=True)
        t_load_end = time.perf_counter()
        load_time = t_load_end - t_load_start
        audio_dur = len(wav) / mulan.sr

        wav_tensor = torch.tensor(wav, dtype=torch.float32).unsqueeze(0).to(device)
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        t_inf_start = time.perf_counter()
        with torch.no_grad():
            emb = mulan(wav_tensor, parallel_processing=True)
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        t_inf_end = time.perf_counter()
        inf_time = t_inf_end - t_inf_start

        total_time = load_time + inf_time
        rtf = audio_dur / total_time

        results.append({
            "file": f.name,
            "duration": audio_dur,
            "load_time": load_time,
            "inf_time": inf_time,
            "total_time": total_time,
            "rtf": rtf,
            "emb_shape": tuple(emb.shape),
        })

        name_display = f.name[:36] + ".." if len(f.name) > 36 else f.name
        row = (
            f"{name_display:<38} | {audio_dur:7.1f}s   | {load_time:8.3f}s | "
            f"{inf_time:8.3f}s | {total_time:6.3f}s | {rtf:6.1f}x"
        )
        print(row)

    print("=" * 80)

    if not results:
        return

    total_audio = sum(r["duration"] for r in results)
    total_proc = sum(r["total_time"] for r in results)
    avg_speed = total_audio / total_proc

    avg_song_dur = 180.0
    avg_song_proc = avg_song_dur / avg_speed

    print(f"\nEmbedding Vector Shape: {results[0]['emb_shape']} (512 dimensions)")
    print(f"Average Processing Speed: {avg_speed:.1f}x faster than real-time")
    print(f"Average 3-minute song takes: ~{avg_song_proc:.2f} seconds total")
    if torch.cuda.is_available():
        print(f"Peak VRAM during inference: {torch.cuda.max_memory_allocated() / (1024**2):.1f} MB")


if __name__ == "__main__":
    benchmark()
