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

# Candidates sourced from the YouTube radio mixes of four recent favourites; acceptance is
# strictly based on the downloaded audio score from the retrained model. An optional third
# element pins the exact YouTube ID, which skips the search (remix and slowed cuts differ).
CANDIDATES: list[tuple[str, ...]] = [
    # YouTube radio neighbours of KIRXSHA — CELESTIAL (Tiktok Version)
    ("Navjaxx", "Shattered Love", "eTRGbzZbpjA"),
    ("stellar", "Divinity", "Pp8EN1m6cxI"),
    ("Frequency", "My Defender", "G2EuZyZaHCA"),
    ("KIRXSHA", "Anxiety (Super Slowed)", "Sra2kZNzP9M"),
    ("KEIRU", "FEEL YOU (Slowed)", "AbBySX3PUBw"),
    ("ICYKILLXH", "Withme (Slowed)", "4liWtXBjVbY"),
    ("SPACYBOI", "Pure", "F0wxWh1ciGk"),
    ("ANTXRES", "we touch", "o4gOmPcfVy0"),
    ("Lithe", "Like We Wrote (MYSTIK Remix)", "nWXvOF2dlNY"),
    ("MRJay & LOSTMANE", "Control", "k25oapTBDvA"),
    ("onFlame", "Running out of time 2", "clclgsuoyGQ"),
    ("Notan Nigres", "Mirage", "5gcb94jhG1I"),
    ("Alkazareno", "You know you lie", "zznCi8soU2Y"),
    ("skyfall beats", "Y2K", "P_jAG-gvB9E"),
    ("KIRXSHA", "Glacial", "iEu53GtRDrs"),
    ("nashi", "COSMO 2", "y9USvuyrFIY"),
    ("KIRXSHA", "Heartless (Slowed)", "Uzk3hJp13o4"),
    ("Beneath My Shade", "Y2K Dreams (Ultra Slowed)", "gReGzfgLkTw"),
    ("LONOWN", "starly (Slowed)", "VkyNqGsfJdM"),
    ("KoruSe", "Two Different Worlds (Ultra Slowed)", "3Ia1ZEmNMfk"),
    ("stxrless", "Bloom", "sIelvuVM6lg"),
    ("skaviński", "kyoto", "_OZk3cfTa58"),
    ("Sappheiros", "Need", "d8GM927wjSc"),
    ("VLNRKS", "Stay (feat. Devilish Trio)", "ZYBB9QYb1oo"),
    ("Clara La San", "Feel Good (97Kickstvr Remix)", "p2B6bFpozLw"),
    ("Planet V", "GARROTE.", "TXBHlOGMIQ4"),
    ("KTrek", "Aquaa", "EzwuBJ39YEU"),
    ("Irokz", "EEYUH! (Irokz Remix Super Slowed)", "E-I03EOxskY"),
    ("Irokz", "Goodbye", "IYp9g7j25hI"),
    ("neony", "she said nothing", "4kUM52ZBowY"),
    ("Echelon & YourTears", "Rapture", "L32w-PZrySg"),
    ("LIZΔRD", "INSONAMIA Slowed + Reverb", "3brVA5w-aLQ"),
    ("Adi T", "ECLIPSE", "2i5rhrVkqMA"),
    ("CYREX x Ax3S", "OVERDRIVE", "BTk66-Nd_kw"),
    ("SPACYBOI", "Not Alone", "rHEYtdhRwr4"),
    ("barnacle boi", "Trust", "wPs2IHTjBA4"),
    ("SAVVS", "ATMOSPHERE", "OSauD2vxFWk"),
    ("MXTHI3V", "Shadows Of The Past (Slowed & Reverb)", "jdUa9b1dte0"),
    ("Downtown Binary", "Simulation", "RN22aZfAsz4"),
    ("Mr.Kitty", "Hold Me Down", "XmgBCXsVDjA"),
    ("KIRXSHA", "HILARIOUS (Slowed)", "a7dKfb_GUCg"),
    ("teefnbl", "alright (slowed + reverb)", "zaCXH6upWRI"),
    ("akiaura", "Deathwish (Slowed)", "VQqANlXN2P0"),
    ("LXRY PXNK", "Now", "r-rrsvH0cCw"),
    ("LONOWN", "glamorgeddon (Slowed)", "Ekv9FYSqkEI"),
    ("riserayss", "jessie (Slowed)", "-K2Q1lD4Fn4"),
    ("VOKTUM", "Devil", "fERaHM9P-vw"),
    ("CYREX x QUERKY", "TIMELAPSE", "kY4uAUZ0RrQ"),
    ("SUKA.", "NO REPLY (Extended)", "VHsWN55F19E"),
    ("dnvn", "Instinct", "i_mkHfW_pZg"),
    ("TFXXII", "Arise (Slowed)", "bMP6nc2-IgE"),
    ("MXTHI3V", "Inner Strength (Ultra-Speed-Up)", "D-hLVJgjpQw"),
    ("VXLLAIN", "Amber Skies (Sped Up)", "KCFVG2YpBUc"),
    ("KREZUS", "Skins (Slowed + Reverb)", "ET6Hn_iADIs"),
    ("KIRXSHA", "Legacy", "vLbMb82ELvA"),
    ("LONOWN, asenssia", "ADDICTION (slowed)", "NFQuN-LTaO0"),
    ("LXRY PXNK", "Drive 3", "Z3-oVlXSD5U"),
    ("VXSTLV", "NIGHT RIDE", "a8VXj32KDGY"),
    ("KREZUS", "Skins 2 (MUCO Rework)", "9li7HqC10xc"),
    ("excape.", "TAKE ME THERE", "CPznmfSbAiE"),
    ("LONOWN", "worry (ultra slowed)", "lCKU-tI-upI"),
    ("skyfall beats", "acies (slowed + reverb)", "JvKFaog_s2w"),
    # YouTube radio neighbours of FMLYBND — Letting Go
    ("FMLYBND", "I Need You", "SudUoEzCRs4"),
    ("FMLYBND", "Phoenix", "40HfH8kUfGw"),
    ("FMLYBND", "Space & Time", "66kMFNGGeBs"),
    ("FMLYBND", "Come Alive", "1uoTlFjUPgc"),
    ("FMLYBND", "Euphoria", "AjsAVli6-Fw"),
    ("Polock", "Everlasting", "quoEU0TYfsE"),
    ("Saint Raymond", "Wild Heart", "tphXkLwjDL8"),
    ("The Griswolds", "16 Years", "FbUlnknufos"),
    ("FMLYBND", "Electricity (Rush)", "2nNVk92S-i0"),
    ("FMLYBND", "Out of Touch", "LmuYY0OIprs"),
    ("FMLYBND", "Hearts on Fire", "wAK6MFtE6CQ"),
    ("Le Matos", "La Mer Des Possibilités", "iZjomSRzxN4"),
    ("GUNSHIP", "Tech Noir (Carpenter Brut Remix)", "vDjNTeynUPY"),
    ("FMLYBND", "OH (Original Mix)", "MFdoR2XZ1ps"),
    ("The Mountains", "The Valleys", "O8lpAOre_-8"),
    ("FMLYBND", "Land of the Rising Sun", "R1ZxMBpAsnk"),
    ("Magic Man", "Tonight", "Wp_S_8VG96Q"),
    ("Parade of Lights", "Feeling Electric", "kKdlDOGJJRw"),
    ("Olympic Ayres", "Magic", "666y56PpwoQ"),
    ("The Chevin", "Champion", "RpCGNzbMM3U"),
    ("FMLYBND", "Westside", "mV-wW9cRBqc"),
    ("FMLYBND", "Fame", "IxQ3dWx9YQc"),
    ("FMLYBND", "Wasting My Time", "8Jyl882kydI"),
    ("FMLYBND", "Young Wild", "hfFksxlw5Z8"),
    ("Prides", "Out Of The Blue", "nMyN7Of7M80"),
    ("BANNERS", "Shine A Light", "Vvyo5WatfyA"),
    ("Mansionair", "Violet City", "QyqXxqzuCLY"),
    ("Saint Motel", "Move", "kYlZybEDxA8"),
    ("FMLYBND", "Nightmare", "ekOpCcwQ2Dk"),
    ("FMLYBND", "2014", "6142WkN0KP0"),
    ("FMLYBND", "Air", "9QzqY8TLEZE"),
    ("FMLYBND", "Gold Necklace", "55tsr4dbO00"),
    ("Jungle", "Busy Earnin'", "BcsfftwLUf0"),
    # YouTube radio neighbours of NKY & Lilyisthatyou — RELAX
    ("Shift K3Y", "On My Mind", "1d-hEcoqtYw"),
    ("ARLO", "Take Me Away", "YRjLUQgGV-o"),
    ("it's murph", "World On Fire", "2TQIdcY20mo"),
    ("ARLO", "Besides You (feat. Emi Grace)", "sazy99IoUas"),
    ("Release", "Energy", "Ium6DqVkcvg"),
    ("Hans Glader", "Real", "6s3-N3TnWKw"),
    ("informal.", "porto", "YQL4cEnk7b8"),
    ("Levity", "Postman", "DQ9Ekw_Nfi4"),
    ("NKY", "Shadow of the Moon", "nmSQwCM9iSM"),
    ("Sunday Scaries, Emi Grace", "Back To You", "AyOxq1gscDE"),
    ("Higgo x piri", "Think Twice", "u8cu-QHEbx8"),
    ("ARLO", "Alexus", "8AAyJGWgN98"),
    ("Alex Andre", "thanks, my day is ruined (feat. Clearcast)", "pn-g7rkZdyM"),
    ("ARLO", "Don't Give Up On Us (feat. Emi Grace)", "Ro8xbIPHV78"),
    ("ARLO", "Nothing But You", "ZFAUGALsprM"),
    ("Lilyisthatyou", "HARD TO LOVE", "6OXfAKJhszY"),
    ("Lilyisthatyou", "Bad Energy", "YRopzxNJqGc"),
    ("Lilyisthatyou", "Superstar", "PMUGvQ22tDU"),
    ("SORROW", "Anybody Else but U", "fWFR-87Ak1o"),
    ("Fabich, Pastel, Jafunk", "Ecstasy (feat. Liska)", "9xId-lGvhc4"),
    ("Distant Matter", "Flow", "TpVQQnlu7u8"),
    ("BKAYE & Lilyisthatyou", "Broke My Rules", "mfYGbfipuO4"),
    ("Klingande & Shaun Farrugia", "Feelings for You", "bEcdE2-chNo"),
    ("Oberg & WESTIN", "Paradise", "mn_cH_rdcEs"),
    ("AKN", "NEEDED ME.", "NlcHXGYtPqo"),
    ("Łaszewo", "SPEND THE WEEK", "u_z6hCvwk20"),
    ("Gxngar", "Say My Name", "18ey6Fu99qw"),
    ("Alex Mills & Guz", "Chemistry", "eX_RA-pfCvM"),
    ("ARLO", "No More", "60mdIyzL0Ss"),
    ("Higgo", "Don't Wanna Be Talking", "7B242fNQZUE"),
    ("VØJ, Maikubi & AlienBlaze", "CXLD HEART", "8QG7-dmeDLU"),
    ("Ninajirachi", "London Song", "mra_6tIHLYg"),
    ("Starjunk 95", "Belden Towers", "wTy72EPLXGU"),
    ("Boris Way", "The Fall", "Tzq-deTqi8A"),
    ("Boris Way", "Save Me feat. Justin Jesso (Bonaar Remix)", "zgYlwhLhN20"),
    ("Adventure Club & Coleman Hell", "Move", "w9nkBT6MiiQ"),
    ("Cash Cash & lovelytheband", "When I Got You", "EB-XiTn2X_U"),
    ("Lilyisthatyou", "Anxiety", "BNwH_G-snf0"),
    ("Jonas Apollo & Jayms", "Whisperin' (Original Mix)", "PejbElFG0JA"),
    ("Snakehips & EARTHGANG", "Been a Minute... (feat. Sinéad Harnett)", "hPe44LLzmGM"),
    ("DAMIANO x The Prince Karma", "Alone", "7JV5QpTvAAQ"),
    ("Dipha Barus & Jinan Laetitia", "BATARA", "A12FNUFm6UI"),
    ("Todiefor", "in my room", "oMNLm3F3hiQ"),
    ("JAKK RINSE", "TOO MUCH", "wQ5kl-0o_1k"),
    ("Łaszewo", "3am", "Oc5H8P6myac"),
    ("Gravagerz x Kiki Wera", "Pool", "A6XQmLHeav0"),
    ("ARLO", "Full Moon Eyes", "XfyVZi90S5U"),
    ("Daniel Allan", "Bet You Didn't Need", "NNRSjXLkrrU"),
    ("AshZone", "take a picture (ft. Alyzée)", "I-19Ssx_AGE"),
    ("Faul & Wad, 4Rain, Anlly Marín", "Flores Blancas", "hyE9sj4rtIc"),
    ("Snakehips & EARTHGANG", "GLIMMER.", "Bq8tAdgP2HU"),
    ("Young Franco, EARTHGANG", "Lose Control (Mr. Belt & Wezol Remix)", "GBYOAk0x7Mg"),
    ("OPR", "Frog (feat. Liv Grace)", "fwOsJ_7BS4U"),
    ("Oberg & WESTIN", "Give Me Love", "JmnQ7OPcr64"),
    ("Fcukers", "Butterflies", "FdMNAxdzmcY"),
    ("Young Franco, piri & MC DT", "Going On", "5iMcCq4T-so"),
    ("nephillm", "i always let me down", "iMIaA-rEKhw"),
    ("D A N N Y", "TAKE ME", "2YcPf0a4n0Q"),
    ("Starjunk 95", "State Your Name", "Ow9h3q-7Zho"),
    ("Starjunk 95", "Spectra Ocean Dream Circuit", "r7cx-Vf9J-0"),
    ("veggi", "YOU & I", "x7CzX0aiY8A"),
    ("Alyzée", "Luxury", "79l-9EdofRY"),
    ("Lilyisthatyou", "SIREN", "AKx9QosJPGc"),
    ("Lilyisthatyou", "DANCE", "4Lqr-DcMiT8"),
    ("Metric", "Help I'm Alive (BYNX Rework)", "4TLA9zSbUBA"),
    ("jigitz", "tell you straight", "JOfdYKGVnzA"),
    ("Yung Bae & GUDFELLA", "pillowtalk", "nRojrcuBnRc"),
    ("Peyruis", "Blue Eyes", "qALdl-VHgV0"),
    ("Starjunk 95", "Can Ya Bump It", "ji69ldzsBJ8"),
    ("dudzinnnmusic", "I Don’t Kneel", "1Z7UjMjXMns"),
    ("Lilyisthatyou", "EVERYTHING CHANGES", "R3szWyyDsig"),
    ("Lilyisthatyou", "Heart of Darkness", "2IV2P3e4QYs"),
    ("Lilyisthatyou", "Spiral", "67SYsWUHg1Y"),
    # YouTube radio neighbours of Battle Tapes — Sweatshop Boys
    ("Battle Tapes", "Brand New", "oHx9ldWYcyI"),
    ("Battle Tapes", "Made", "1j1pD21L1l8"),
    ("Battle Tapes", "Valley People", "L3JNoQU5hOw"),
    ("Battle Tapes", "Graveyard Shift", "-NJd9XacQ2o"),
    ("Battle Tapes", "Sleepwalker", "NCqh2jJT4AU"),
    ("Battle Tapes", "Talk Anymore", "8vRGUTTxSUI"),
    ("Battle Tapes", "Solid Gold", "FV6x4DeP9wQ"),
    ("Battle Tapes", "One Night in Burbank", "Bt4cNAR8bIc"),
    ("Battle Tapes", "If Only", "DDsZSGe5jVs"),
    ("Battle Tapes", "Perish the Thought", "Y804v6SC6_E"),
    ("Battle Tapes", "Rhyme or Reason", "iOSfZKY8EZ0"),
    ("Battle Tapes", "Private Dancer", "cGlYhgdhkI4"),
    ("Battle Tapes", "Mulholland", "3m8yVz7e9OQ"),
    ("Battle Tapes", "Sleepwalker Pt. II", "0vNyP95lF5g"),
    ("Battle Tapes", "Passive Attack", "KF45h2wgllY"),
    ("Nine Inch Nails", "As Alive As You Need Me To Be", "dNTwvW7Py7M"),
    ("Battle Tapes", "Syntax", "F8nINz6GSZs"),
    ("Coyote Kisses", "Six Shooter", "Y2shDoIBJIs"),
    ("Childish Gambino", "Sweatpants (Battle Tapes Remix)", "nzgA8AU4Vms"),
    ("Battle Tapes", "Back in the Game", "4QipOfqmstc"),
    ("Battle Tapes", "Dreamboat (PXLTR)", "ZOx9odFKyqA"),
    ("Kauf", "When You're Out", "HCoUFdWoAMs"),
    ("Tony Castles", "Heart in the Pipes (KAUF Remix)", "jNzZIlVuuxY"),
    ("Neon Indian", "Change Of Coast", "u9wWQVjinJk"),
    ("Nite Jewel", "Nowhere To Go", "jE3i24CvY-M"),
    ("Ken Ashcorp", "Absolute Territory", "kFZKgf5WG0g"),
    ("Royal Blood", "Trouble’s Coming", "6YrraK36JaE"),
    ("Royal Blood", "Oblivion", "2j9yF87S1ig"),
    ("Death From Above 1979", "Freeze Me", "auZHjtVTDI0"),
    ("Nothing But Thieves", "Futureproof", "p5ufrKv7TTM"),
    ("Des Rocs", "This Land (Theme from Borderlands 4)", "49jF1yVu5Js"),
    ("The Listros", "Wolf Like Me", "lGCfZvg_xl8"),
    ("SIAMÉS", "The Wolf", "lX44CAz-JhU"),
    ("Mystery Skulls", "Hellbent", "X79sXBYYgIQ"),
    ("Age of Consent", "Colours", "nXLK2ufVfFc"),
    ("Age of Consent", "Heartbreak", "h-QhQaGVS-o"),
    ("Uh Huh Her", "Time (Battle Tapes Remix)", "_JT7uBc84gU"),
    ("Yeasayer", "Don't Come Close", "d4KOfBx_XPM"),
    ("CRX", "Broken Bones", "qgEwsQ0Uj8w"),
    ("Des Rocs", "The Way It Has to Be", "mhd4EmMUiwI"),
    ("Ken Ashcorp", "Touch Fluffy Tail", "4nyHPIcbn88"),
    ("Paper Idol", "CNTRL", "UKoto5QQIPw"),
    ("BIG DATA", "Big Dater", "MlYK9UybOxs"),
    ("Dan Croll", "From Nowhere (Baardsen Remix)", "6Fna2ZMO9VA"),
    ("Helmet", "LA Water (Battle Tapes Remix)", "TU0wj5LOPA4"),
    ("Royal Blood", "Typhoons", "SxovibU0kEE"),
    ("Mystery Skulls", "Ghost", "N92J4mlrRSc"),
    ("Thomas Azier", "Ghostcity", "t9dz8pcd_P8"),
    ("Joywave", "Destruction", "TA5kvZ9aqDI"),
    ("BIG DATA", "Get Some Freedom", "T3oMrQsRrKc"),
    ("SAINT MOTEL", "A Good Song Never Dies", "s29fcv5E52Y"),
    ("POWERS", "Beat Of My Drum", "mlAzsqBfsA4"),
    ("I DONT KNOW HOW BUT THEY FOUND ME", "Do It All The Time", "Lpyz1j16J0E"),
    ("BIG DATA", "Dangerous", "-a7qdQLu244"),
    ("Balu Brigada", "Backseat", "pHDrrEN_NS8"),
    ("Muse", "Supermassive Black Hole", "N-_mHedypEU"),
    ("Friends in Tokyo", "Call Me Devil", "S2Doxtmwhhs"),
    ("Battle Tapes", "If Only (The Anix Remix)", "Ox065fjyhKc"),
    ("The Darcys", "The River", "U2lHbvPEtk8"),
    ("Franz Ferdinand", "Take Me Out", "Ijk4j-r7qPA"),
    ("The Delta Riggs", "Money", "5IXKnpwyVTM"),
]

BLOCKED_TITLE_WORDS = re.compile(
    r"\b(live|reaction|interview|cover|karaoke|tutorial|full album)\b",
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


def pinned_video(youtube_id: str) -> dict[str, Any]:
    return {"youtube_id": youtube_id, "source_url": f"https://www.youtube.com/watch?v={youtube_id}"}


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
    for artist, title, *pinned in CANDIDATES[: args.limit]:
        base = {"artist": artist, "title": title}
        if is_existing(artist, title, names):
            results.append({**base, "status": "already in library"})
            print(f"[-] Existing: {artist} - {title}")
            continue
        try:
            found = pinned_video(pinned[0]) if pinned else search_youtube(artist, title)
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
