# Data workspace

`kolo.0.data` is Kolo's local workspace. It holds the audio library, generated embeddings, and application state used by the player and training scripts.

The repository contains only this documentation and empty directory placeholders. Audio files, personal ratings, model outputs, and caches are excluded by `.gitignore`.

## Directories

- `pos/`: original liked-song collection
- `neg/`: contrast set used by the binary classifier benchmark
- `downloads/OLD/`: archived downloads
- `discovery/`: downloaded candidates
- `imported/`: files imported through the player
- `playlists/`: user-created playlist folders
- `.kolo/`: generated state, including ratings, likes, embeddings, clusters, artwork, and loudness measurements

MuQ-MuLan embeddings have 512 values per track. The combined lookup used by the training and visualization scripts is `.kolo/all_embeddings.npz`.

See [docs/data_spec.md](docs/data_spec.md) for file schemas and canonical track IDs.
