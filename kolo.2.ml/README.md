# Preference models and discovery tools

This directory contains Kolo's model training, inference, and download utilities. The scripts operate on the embeddings and state in `kolo.0.data`; trained models and MLflow runs are generated locally and excluded from Git.

## Models

### Star-rating regressor

`train_rating_model.py` trains several regressors with five-fold shuffled cross-validation and saves the selected voting ensemble (RBF SVR plus Extra Trees). Only explicit 0.5–5.0 ratings are used as regression targets. The old binary negative collection is not assigned synthetic star ratings.

The script writes:

- `models/vibe_rating_model.joblib`
- `models/vibe_classifier.joblib`, a compatibility copy used by older commands
- `kolo.0.data/.kolo/ai_ratings.json`
- JSON and Markdown evaluation reports
- an MLflow run in `kolo-star-rating`

See [the latest rating report](docs/rating_model_report.md).

### Binary classifier benchmark

`train_classifier.py` compares logistic regression, a calibrated linear SVM, an MLP, nearest centroid, and random forest on the original positive/negative split. This is retained as a benchmark; the player displays predictions from the star-rating model.

### Challenger studies

- `train_rating_challengers.py` compares the selected ensemble with a PyTorch MLP and cosine k-nearest neighbors on identical folds.
- `train_mlp_iterate.py` compares six MLP configurations.
- `docs/negative_anchor_experiment.md` records why unrated negative tracks were not converted into 0.5-star labels.

## Commands

Train the classifier benchmark and rating model:

```bash
./kolo.2.ml/train.sh
```

Run the two challenger studies:

```bash
.venv/bin/python kolo.2.ml/train_rating_challengers.py
.venv/bin/python kolo.2.ml/train_mlp_iterate.py
```

Open the local MLflow UI:

```bash
./kolo.2.ml/mlflow_ui.sh [port]
```

Score local audio or a YouTube URL:

```bash
.venv/bin/python kolo.2.ml/predict.py --input "path/to/song.mp3"
.venv/bin/python kolo.2.ml/predict.py --url "https://www.youtube.com/watch?v=..."
.venv/bin/python kolo.2.ml/predict.py --dir "path/to/album" --save-csv ranked_songs.csv
```

## Library utilities

| Script | Purpose |
| --- | --- |
| `discover_new_music.py` | Search a curated candidate list, score temporary downloads, and retain candidates above a rating threshold |
| `scrape_and_discover.py` | Older binary-classifier discovery experiment kept for comparison |
| `download_playlist_latest.py` | Import Spotify track metadata and find matching audio with yt-dlp |
| `download_liked_songs.py` | Download saved Spotify tracks through spotdl |
| `download_negatives.py` | Collect contrast samples for the binary benchmark |
| `scan_loudness.py` | Measure EBU R128 loudness with FFmpeg and store attenuation gains |

Downloading from third-party services is subject to their terms and to local copyright law. These utilities are intended for audio the user is permitted to download.
