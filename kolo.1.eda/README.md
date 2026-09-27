# Embedding and cluster analysis

This directory contains the scripts used to represent and inspect the audio library.

## Workflow

1. `extract_all_missing_embeddings.py` finds uncached audio and produces 512-dimensional MuQ-MuLan vectors.
2. The partition caches are combined into `kolo.0.data/.kolo/all_embeddings.npz`.
3. `regenerate_clusters_and_viz.py` mean-centers the vectors, fits six K-means clusters, and computes t-SNE and UMAP projections.
4. The script writes cluster metadata, static plots, and the Plotly visualization used by the player.

Run the workflow from the repository root:

```bash
./kolo.1.eda/run_eda.sh
```

The embedding step is resumable. Use `--skip-master` when testing extraction without rebuilding the combined index.

## Scripts

| Script | Purpose |
| --- | --- |
| `extract_embeddings.py` | Extract one directory into a named JSON/NPZ cache |
| `extract_all_missing_embeddings.py` | Update the main library partitions and combined index |
| `regenerate_clusters_and_viz.py` | Refit clusters and regenerate plots and interactive HTML |
| `benchmark_mulan.py` | Measure encoder load time, throughput, and GPU memory on sample files |

Generated plots are stored in `res/`. The cluster labels are hand-written descriptions of one fitted library and should not be treated as ground-truth genres.

See [docs/vibe_analysis.md](docs/vibe_analysis.md) for the current interpretation of the projection.
