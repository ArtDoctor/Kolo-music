"""Download saved Spotify tracks through spotdl."""

import argparse
import os
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description="Download Spotify Liked Songs using spotdl")
    parser.add_argument("--client-id", default=os.getenv("SPOTIPY_CLIENT_ID"), help="Spotify App Client ID")
    parser.add_argument(
        "--client-secret",
        default=os.getenv("SPOTIPY_CLIENT_SECRET"),
        help="Spotify App Client Secret",
    )
    parser.add_argument(
        "--output",
        default="kolo.0.data/pos/{artists} - {title}.{output-ext}",
        help="Output directory and format template",
    )
    parser.add_argument(
        "--format",
        default="mp3",
        choices=["mp3", "flac", "m4a", "ogg", "opus"],
        help="Audio format (default: mp3)",
    )
    parser.add_argument("--bitrate", default="320k", help="Audio bitrate (default: 320k)")
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Use headless auth (prints auth URL instead of opening browser)",
    )
    args = parser.parse_args()

    if not args.client_id or not args.client_secret:
        print("\nSpotify Client ID and Client Secret are required to access Liked Songs.")
        print("\nQuick setup:")
        print("  1. Visit: https://developer.spotify.com/dashboard")
        print("  2. Create an App with redirect URI: http://127.0.0.1:9900/")
        print("  3. Pass credentials via arguments or environment variables:")
        print("     export SPOTIPY_CLIENT_ID=\"...\"")
        print("     export SPOTIPY_CLIENT_SECRET=\"...\"\n")
        sys.exit(1)

    out_dir = os.path.dirname(args.output)
    if out_dir and not any(char in out_dir for char in "{}"):
        os.makedirs(out_dir, exist_ok=True)

    cmd = [
        sys.executable,
        "-m",
        "spotdl",
        "download",
        "saved",
        "--user-auth",
        "--client-id",
        args.client_id,
        "--client-secret",
        args.client_secret,
        "--audio",
        "youtube-music",
        "youtube",
        "soundcloud",
        "--format",
        args.format,
        "--bitrate",
        args.bitrate,
        "--output",
        args.output,
    ]

    if args.headless:
        cmd.append("--headless")

    print("\nStarting spotdl for 'Liked Songs'...")
    print(f"Destination: {args.output}")
    print(f"Format: {args.format} ({args.bitrate})")

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        sys.exit(e.returncode)
    except KeyboardInterrupt:
        print("\nDownload aborted by user.")


if __name__ == "__main__":
    main()
