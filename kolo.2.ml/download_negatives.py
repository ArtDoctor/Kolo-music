"""Collect contrast samples for the legacy binary classifier benchmark."""

import argparse
from pathlib import Path
import shutil
import subprocess
import sys

SEARCH_PRESETS = {
    "billboard_hot_100": "ytsearch{count}:billboard hot 100 official music video",
    "modern_country": "ytsearch{count}:modern country hits official music video",
    "latin_reggaeton": "ytsearch{count}:reggaeton hits official music video",
    "kpop_hits": "ytsearch{count}:kpop hits official music video",
    "eurodance_schlager": "ytsearch{count}:schlager hits official music video",
    "mainstream_radio_pop": "ytsearch{count}:pop radio hits official music video",
    "dance_edm_hits": "ytsearch{count}:club dance edm hits official audio",
    "disney_broadway_pop": "ytsearch{count}:disney soundtrack hits official audio",
    "russian_pop": "ytsearch{count}:поп хиты официальный клип",
    "afrobeats_hits": "ytsearch{count}:afrobeats hits official music video",
    "global_viral_hits": "ytsearch{count}:viral hits official music video",
    "modern_chanson_pop": "ytsearch{count}:modern chanson pop official music video",
}


def get_node_path() -> str | None:
    """Find node path if available to satisfy yt-dlp JS runtime."""
    return shutil.which("node")


def download_query(query: str, count: int, output_dir: Path) -> None:
    """Download songs matching query into output_dir."""
    output_dir.mkdir(parents=True, exist_ok=True)
    formatted_query = query.format(count=count) if "{count}" in query else query

    print(f"\nFetching {count} tracks for: '{formatted_query}'")

    filter_expr = (
        "duration >= 60 & duration <= 600 & "
        "title !~= '(?i)(news|awards|interview|react|recap|review|speech|teaser|countdown|chart history)'"
    )

    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "5",
        "--no-playlist",
        "--ignore-errors",
        "--no-overwrites",
        "--match-filter",
        filter_expr,
        "--output",
        str(output_dir / "%(title)s [%(id)s].%(ext)s"),
    ]

    node_path = get_node_path()
    if node_path:
        cmd.extend(["--js-runtimes", f"node:{node_path}"])

    cmd.append(formatted_query)

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Warning: yt-dlp process returned error code {e.returncode}")


def main():
    parser = argparse.ArgumentParser(description="Download contrast samples for the binary benchmark.")
    parser.add_argument(
        "--preset",
        choices=list(SEARCH_PRESETS.keys()) + ["all_balanced"],
        default="all_balanced",
        help="Preset category to download. 'all_balanced' pulls a mix across all presets.",
    )
    parser.add_argument("--count", type=int, default=50, help="Number of songs per preset (default: 50).")
    parser.add_argument(
        "--custom",
        type=str,
        default=None,
        help="Custom search query (e.g. 'ytsearch50:Top 40 Pop 2023') or playlist URL.",
    )
    parser.add_argument(
        "--outdir",
        type=str,
        default="kolo.0.data/neg",
        help="Output directory (default: kolo.0.data/neg).",
    )

    args = parser.parse_args()
    outdir = Path(args.outdir)

    if args.custom:
        download_query(args.custom, args.count, outdir)
    elif args.preset == "all_balanced":
        per_preset = max(10, args.count // len(SEARCH_PRESETS))
        print(f"Balanced download across {len(SEARCH_PRESETS)} presets (~{per_preset} songs each):")
        for name, query in SEARCH_PRESETS.items():
            print(f"--> Preset: {name}")
            download_query(query, per_preset, outdir)
    else:
        download_query(SEARCH_PRESETS[args.preset], args.count, outdir)

    downloaded = list(outdir.glob("*.mp3")) + list(outdir.glob("*.m4a"))
    print(f"\nDone. Total tracks currently in {outdir}: {len(downloaded)}")


if __name__ == "__main__":
    main()
