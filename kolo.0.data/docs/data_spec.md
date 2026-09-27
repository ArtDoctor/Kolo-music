# Data and metadata formats

## Audio partitions

| Path | Use |
| --- | --- |
| `pos/` | Initial liked-song collection |
| `neg/` | Contrast examples for the binary classifier benchmark |
| `downloads/OLD/` | Archived downloads |
| `discovery/` | Candidate tracks downloaded by discovery scripts |
| `imported/` | Files copied into Kolo through the player |
| `playlists/<slug>/` | User-created playlists |

Supported extensions are MP3, M4A, FLAC, WAV, OGG, AAC, Opus, and WebM. A track's canonical ID is its forward-slash-separated path relative to `kolo.0.data`, for example `imported/Artist - Track.mp3`.

## Embeddings

`extract_all_missing_embeddings.py` maintains partition caches in the data root:

- `<partition>_embeddings.json` stores resumable extraction records.
- `<partition>_embeddings.npz` stores `filenames`, `durations`, and a float32 `embeddings` matrix.
- `.kolo/all_embeddings.npz` combines the partitions into arrays named `ids`, `durations`, and `embeddings`.

Embeddings are produced by `OpenMuQ/MuQ-MuLan-large` from mono audio resampled to 24 kHz. Each vector has 512 float32 values.

## Application state

All state files below live in `.kolo/` and are generated locally.

### `ratings.json`

```json
{
  "ratings": {
    "imported/Artist - Track.mp3": 4.5
  }
}
```

Ratings range from 0.5 to 5.0 in half-star increments.

### `likes.json`

A JSON array of canonical track IDs.

### `playlists.json`

Maps custom playlist directory slugs to display names.

### `ai_ratings.json`

Stores the latest displayed rating, raw regression output, normalized score, and category for each embedded track.

### `clusters.json`

Contains the cluster definitions and the cluster ID, label, and color assigned to each track.

### `loudness.json`

Maps track IDs to measured integrated loudness (`lufs`) and a playback `gain`. The scanner only attenuates loud tracks; it does not boost quiet tracks.

### `artwork/`

Contains extracted cover images. Filenames are SHA-1 hashes of canonical track IDs so the web and desktop backends can find the same image.
