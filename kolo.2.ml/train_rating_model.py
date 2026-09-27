"""Train and audit Kolo's personal 0.5–5 star rating model.

The primary training set is the user's explicit app ratings. The old binary
negative corpus is deliberately not assigned invented star labels: "not liked"
does not reliably distinguish 0.5 from 2 stars.
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Callable, cast

import joblib
import mlflow
import numpy as np
from scipy.stats import pearsonr, spearmanr
from sklearn.ensemble import (
    ExtraTreesRegressor,
    HistGradientBoostingRegressor,
    RandomForestRegressor,
    VotingRegressor,
)
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import KFold
from sklearn.preprocessing import normalize
from sklearn.svm import SVR

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
from kolo_rating_model import VibeRatingModel  # noqa: E402

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".flac", ".ogg", ".webm", ".aac", ".opus"}
MODEL_NAME = "Preference Ensemble (RBF SVR + Extra Trees)"


def resolve_path(value: str) -> Path:
    path = Path(value)
    if path.exists() or path.is_absolute():
        return path
    candidate = REPO_ROOT / path
    return candidate if candidate.exists() else path


def load_embeddings(data_root: Path) -> dict[str, np.ndarray]:
    master = data_root / ".kolo" / "all_embeddings.npz"
    if not master.exists():
        raise FileNotFoundError(f"Missing {master}; run extract_all_missing_embeddings.py first")
    data = np.load(master)
    vectors = {str(track_id): embedding for track_id, embedding in zip(data["ids"], data["embeddings"])}
    print(f"[+] Loaded {len(vectors)} canonical vectors from {master.name}")
    return vectors


def load_user_labels(data_root: Path, vectors: dict[str, np.ndarray]):
    ratings_path = data_root / ".kolo" / "ratings.json"
    ratings = json.loads(ratings_path.read_text(encoding="utf-8")).get("ratings", {})
    ids = [track_id for track_id in ratings if track_id in vectors]
    missing = sorted(set(ratings) - set(ids))
    if missing:
        print(f"[!] {len(missing)} rated tracks have no vector")
    features = np.asarray([vectors[track_id] for track_id in ids], dtype=np.float32)
    labels = np.asarray([ratings[track_id] for track_id in ids], dtype=np.float32)
    print(f"[+] Matched {len(ids)}/{len(ratings)} explicit app ratings")
    return features, labels, np.asarray(ids), missing, ratings


def make_svr() -> SVR:
    return SVR(C=1.0, epsilon=0.2, kernel="rbf")


def make_extra_trees(seed: int) -> ExtraTreesRegressor:
    return ExtraTreesRegressor(
        n_estimators=300,
        min_samples_leaf=2,
        max_features=0.7,
        random_state=seed,
        n_jobs=-1,
    )


def make_preference_ensemble(seed: int) -> VotingRegressor:
    return VotingRegressor([("svr", make_svr()), ("extra_trees", make_extra_trees(seed))])


def metrics_for(labels: np.ndarray, predictions: np.ndarray) -> dict[str, float]:
    errors = np.abs(labels - predictions)
    high_mask = predictions >= 4.0
    return {
        "rmse": float(np.sqrt(mean_squared_error(labels, predictions))),
        "mae": float(mean_absolute_error(labels, predictions)),
        "pearson": float(pearsonr(labels, predictions)[0]),
        "spearman": float(spearmanr(labels, predictions)[0]),
        "within_half_star": float(np.mean(errors <= 0.5) * 100),
        "within_one_star": float(np.mean(errors <= 1.0) * 100),
        "predicted_4_plus_count": int(high_mask.sum()),
        "predicted_4_plus_precision": (
            float(np.mean(labels[high_mask] >= 4.0) * 100) if high_mask.any() else 0.0
        ),
        "predicted_4_plus_tolerant_precision": (
            float(np.mean(labels[high_mask] >= 3.5) * 100) if high_mask.any() else 0.0
        ),
    }


def evaluate_models(features: np.ndarray, labels: np.ndarray, seed: int):
    normalized = normalize(features, norm="l2")
    folds = list(KFold(n_splits=5, shuffle=True, random_state=seed).split(normalized))
    factories: dict[str, Callable[[], Any]] = {
        "Ridge Regression": lambda: Ridge(alpha=0.1),
        "RBF Support Vector Regression": make_svr,
        "Extra Trees Regressor": lambda: make_extra_trees(seed),
        "Random Forest Regressor": lambda: RandomForestRegressor(
            n_estimators=300, min_samples_leaf=2, max_features=0.7, random_state=seed, n_jobs=-1
        ),
        "Histogram Gradient Boosting": lambda: HistGradientBoostingRegressor(
            max_iter=200, min_samples_leaf=8, l2_regularization=2.0, random_state=seed
        ),
        MODEL_NAME: lambda: make_preference_ensemble(seed),
    }

    all_metrics: dict[str, dict[str, float]] = {}
    all_predictions: dict[str, np.ndarray] = {}
    print("\nModel                                      RMSE    MAE   ±0.5★  Pearson")
    print("-" * 78)
    for name, factory in factories.items():
        oof = np.zeros(len(labels), dtype=np.float32)
        for train_indices, test_indices in folds:
            model = factory()
            model.fit(normalized[train_indices], labels[train_indices])
            oof[test_indices] = np.clip(model.predict(normalized[test_indices]), 0.5, 5.0)
        result = metrics_for(labels, oof)
        all_metrics[name] = result
        all_predictions[name] = oof
        print(
            f"{name:<42} {result['rmse']:>5.3f}  {result['mae']:>5.3f}  "
            f"{result['within_half_star']:>5.1f}%  {result['pearson']:>7.3f}"
        )

    # Keep model selection fixed so retraining runs remain comparable.
    selected_predictions = all_predictions[MODEL_NAME]
    final_regressor = make_preference_ensemble(seed)
    final_regressor.fit(normalized, labels)
    wrapper = VibeRatingModel(final_regressor, MODEL_NAME)
    return wrapper, selected_predictions, all_metrics


def category(rating: float) -> str:
    if rating >= 4.5:
        return "absolute favorite candidate"
    if rating >= 4.0:
        return "strong recommendation"
    if rating >= 3.5:
        return "listen from time to time"
    if rating >= 3.0:
        return "occasional listen"
    if rating >= 2.5:
        return "some good parts"
    return "not your vibe"


def score_library(model: VibeRatingModel, vectors: dict[str, np.ndarray], data_root: Path):
    track_ids = sorted(vectors)
    features = np.asarray([vectors[track_id] for track_id in track_ids], dtype=np.float32)
    predicted = model.predict_rating(features)
    vibes = model.predict_vibe_score(features)
    exported = {}
    for track_id, rating, vibe in zip(track_ids, predicted, vibes):
        raw_rating = float(rating)
        # The app displays half-star steps but retains the raw estimate for reports.
        displayed_rating = round(raw_rating * 2) / 2
        exported[track_id] = {
            "rating": displayed_rating,
            "rawRating": round(raw_rating, 2),
            "vibeScore": round(float(vibe), 3),
            "category": category(displayed_rating),
        }
    payload = {
        "version": "3.0",
        "model": model.model_name,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "expected_error_stars": 0.5,
        "total_scored": len(exported),
        "ratings": exported,
    }
    write_json_atomic(data_root / ".kolo" / "ai_ratings.json", payload)
    print(f"[+] Exported {len(exported)} AI ratings")
    return exported


def normalized_title(track_id: str) -> str:
    stem = Path(track_id).stem.casefold()
    stem = re.sub(r"\[[^]]*]|\([^)]*(official|audio|video|lyrics|visuali[sz]er)[^)]*\)", " ", stem)
    return re.sub(r"[^\w]+", " ", stem).strip()


def nearest_examples(embedding: np.ndarray, train_features: np.ndarray, train_ids: np.ndarray, labels: np.ndarray):
    similarities = normalize(train_features, norm="l2") @ normalize(embedding.reshape(1, -1), norm="l2")[0]
    best = np.argsort(-similarities)[:3]
    return [
        {
            "track": str(train_ids[index]),
            "rating": float(labels[index]),
            "similarity": round(float(similarities[index]), 3),
        }
        for index in best
    ]


def build_report(
    data_root: Path,
    vectors: dict[str, np.ndarray],
    features: np.ndarray,
    labels: np.ndarray,
    ids: np.ndarray,
    oof: np.ndarray,
    all_metrics: dict[str, dict[str, float]],
    exported: dict[str, dict[str, Any]],
    missing_labels: list[str],
):
    selected_metrics = all_metrics[MODEL_NAME]
    errors = []
    for track_id, actual, predicted in zip(ids, labels, oof):
        errors.append({
            "track": str(track_id),
            "actual": float(actual),
            "predicted": round(float(predicted), 2),
            "error": round(float(predicted - actual), 2),
            "absolute_error": round(float(abs(predicted - actual)), 2),
        })
    errors.sort(key=lambda item: float(cast(float, item["absolute_error"])), reverse=True)

    breakdown = {}
    for rating in sorted(np.unique(labels)):
        mask = labels == rating
        breakdown[f"{rating:.1f}"] = {
            "count": int(mask.sum()),
            "mae": round(float(np.mean(np.abs(labels[mask] - oof[mask]))), 3),
            "within_half_star_percent": round(float(np.mean(np.abs(labels[mask] - oof[mask]) <= 0.5) * 100), 1),
        }

    explicit = set(map(str, ids))
    rated_titles = {normalized_title(track_id) for track_id in explicit}
    candidate_prefixes = ("downloads/OLD/", "discovery/", "imported/")
    recommendations = []
    seen_titles: set[str] = set()
    for track_id, prediction in sorted(exported.items(), key=lambda item: item[1]["rawRating"], reverse=True):
        if track_id in explicit or not track_id.startswith(candidate_prefixes) or prediction["rating"] < 4.0:
            continue
        title_key = normalized_title(track_id)
        if title_key in seen_titles or title_key in rated_titles:
            continue
        evidence = nearest_examples(vectors[track_id], features, ids, labels)
        # Exclude likely duplicates of rated recordings.
        if evidence and evidence[0]["similarity"] >= 0.985:
            continue
        seen_titles.add(title_key)
        recommendations.append({
            "track": track_id,
            "predicted_rating": prediction["rating"],
            "raw_model_rating": prediction["rawRating"],
            "nearest_rated_examples": evidence,
        })
        if len(recommendations) == 20:
            break

    audio_ids: list[str] = []
    for folder in ("pos", "neg", "downloads/OLD", "discovery", "imported", "playlists"):
        base = data_root / folder
        if base.exists():
            for path in base.rglob("*"):
                if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS:
                    audio_ids.append(str(path.relative_to(data_root)).replace("\\", "/"))
    missing_vectors = sorted(set(audio_ids) - set(vectors))

    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": MODEL_NAME,
        "methodology": "5-fold shuffled out-of-fold evaluation on explicit app ratings only",
        "data": {
            "explicit_ratings": len(labels),
            "audio_files": len(audio_ids),
            "vectors": len(vectors),
            "missing_vectors": missing_vectors,
            "rated_tracks_missing_vectors": missing_labels,
        },
        "selected_model_metrics": selected_metrics,
        "all_model_metrics": all_metrics,
        "performance_by_actual_rating": breakdown,
        "largest_out_of_fold_errors": errors[:20],
        "recommendations_4_plus": recommendations,
        "limitations": [
            (
                "The test folds are random rather than grouped by recording, "
                "so alternate/remixed versions can make results mildly optimistic."
            ),
            "0.5–2.0 and 5.0 star labels are sparse; predictions at the extremes regress toward the middle.",
            "A predicted rating is a ranking aid, not ground truth; ±0.5 star is treated as a plausible hit.",
        ],
    }
    write_json_atomic(data_root / ".kolo" / "rating_model_report.json", report)
    write_json_atomic(REPO_ROOT / "models" / "rating_model_report.json", report)
    docs_dir = REPO_ROOT / "kolo.2.ml" / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    write_markdown_report(docs_dir / "rating_model_report.md", report)
    print(f"[+] Wrote report with {len(recommendations)} 4+ star recommendations")
    return report


def write_markdown_report(path: Path, report: dict[str, Any]):
    metric = report["selected_model_metrics"]
    note_text = (
        "These are predictions for held-out personal labels, not training-set scores. "
        "The older headline binary-classification accuracy is not comparable to this harder rating task. "
        "App predictions are rounded to the nearest half-star label; raw values remain in the JSON report."
    )
    vector_coverage = report["data"]["audio_files"] - len(report["data"]["missing_vectors"])
    lines = [
        "# Kolo Rating Model Report",
        "",
        "## Coverage",
        "",
        (
            f"- **{vector_coverage} / {report['data']['audio_files']} audio files have vectors** "
            f"({report['data']['vectors']} vectors in the index)."
        ),
        f"- **{report['data']['explicit_ratings']} explicit app ratings** were used for training and evaluation.",
        "- The legacy binary negative set was not given artificial star values.",
        "",
        "## Out-of-fold performance",
        "",
        f"- Model: **{report['model']}**",
        f"- MAE: **{metric['mae']:.3f} stars**; RMSE: **{metric['rmse']:.3f} stars**",
        (
            f"- Within ±0.5 star: **{metric['within_half_star']:.1f}%**; "
            f"within ±1 star: **{metric['within_one_star']:.1f}%**"
        ),
        f"- Pearson correlation: **{metric['pearson']:.3f}**; Spearman: **{metric['spearman']:.3f}**",
        (
            f"- Among raw OOF predictions ≥4: **{metric['predicted_4_plus_precision']:.1f}%** were actually ≥4 "
            f"(**{metric['predicted_4_plus_tolerant_precision']:.1f}%** were ≥3.5, allowing ±0.5 tolerance)."
        ),
        "",
        note_text,
        "",
        "## Largest misses (out of fold)",
        "",
        "| Track | Actual | Predicted | Error |",
        "|---|---:|---:|---:|",
    ]
    for item in report["largest_out_of_fold_errors"][:12]:
        escaped_track = item["track"].replace("|", "\\|")
        lines.append(f"| {escaped_track} | {item['actual']:.1f} | {item['predicted']:.2f} | {item['error']:+.2f} |")
    lines += ["", "## Unrated 4+ star recommendations", ""]
    recommendations = report["recommendations_4_plus"]
    if recommendations:
        lines += ["| Track | AI rating | Raw | Similar rated evidence |", "|---|---:|---:|---|"]
        for item in recommendations:
            evidence = "; ".join(
                f"{Path(example['track']).stem} ({example['rating']:.1f}★)"
                for example in item["nearest_rated_examples"]
            )
            escaped_track = item["track"].replace("|", "\\|")
            escaped_evidence = evidence.replace("|", "\\|")
            lines.append(
                f"| {escaped_track} | {item['predicted_rating']:.1f} | "
                f"{item['raw_model_rating']:.2f} | {escaped_evidence} |"
            )
    else:
        lines.append("No currently downloaded unrated track cleared the conservative 4.0-star threshold.")
    lines += ["", "## Caveats", ""] + [f"- {item}" for item in report["limitations"]] + [""]
    path.write_text("\n".join(lines), encoding="utf-8")


def write_json_atomic(path: Path, payload: Any):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description="Train Kolo's personal star-rating model")
    parser.add_argument("--data-root", default="kolo.0.data")
    parser.add_argument("--models-dir", default="models")
    parser.add_argument("--random-state", type=int, default=42)
    args = parser.parse_args()

    data_root = resolve_path(args.data_root).resolve()
    models_dir = resolve_path(args.models_dir).resolve()
    models_dir.mkdir(parents=True, exist_ok=True)

    vectors = load_embeddings(data_root)
    features, labels, ids, missing, _ = load_user_labels(data_root, vectors)
    if len(labels) < 20:
        raise RuntimeError("At least 20 explicit ratings are required")

    unique, counts = np.unique(labels, return_counts=True)
    dist_str = ", ".join(f"{rating:g}★={count}" for rating, count in zip(unique, counts))
    print(f"Rating distribution: {dist_str}")
    model, oof, all_metrics = evaluate_models(features, labels, args.random_state)

    # Ratings may change while cross-validation runs. Refit until two reads match;
    # the out-of-fold metrics still describe the original evaluation snapshot.
    evaluation_samples = len(labels)
    final_features, final_labels = features, labels
    for attempt in range(3):
        final_features, final_labels, _, _, snapshot_ratings = load_user_labels(data_root, vectors)
        final_regressor = make_preference_ensemble(args.random_state)
        final_regressor.fit(normalize(final_features, norm="l2"), final_labels)
        ratings_data = (data_root / ".kolo" / "ratings.json").read_text(encoding="utf-8")
        current_ratings = json.loads(ratings_data).get("ratings", {})
        model = VibeRatingModel(final_regressor, MODEL_NAME)
        if current_ratings == snapshot_ratings:
            break
        print(f"Ratings changed during final fit; refreshing snapshot ({attempt + 2}/3)")

    payload = {
        "model": model,
        "model_name": model.model_name,
        "task": "rating_regression",
        "version": "3.0",
        "l2_normalize": True,
        "embedding_dim": int(final_features.shape[1]),
        "metrics": all_metrics[MODEL_NAME],
        "all_metrics": all_metrics,
        "training_samples": len(final_labels),
        "evaluation_samples": evaluation_samples,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rating_scale": {
            "5.0": "absolute bangers, my favorites",
            "4.5": "almost fully favorite; all parts work",
            "4.0": "missing a little, but very good and repeatable",
            "3.5": "listen from time to time",
            "3.0": "okay once in a while",
            "2.5": "has some good parts",
            "2.0_or_less": "bad or very bad",
        },
    }
    joblib.dump(payload, models_dir / "vibe_rating_model.joblib")
    joblib.dump(payload, models_dir / "vibe_classifier.joblib")
    print(
        f"Saved model v3 to {models_dir} "
        f"({len(final_labels)} latest labels; {evaluation_samples} evaluated)"
    )

    exported = score_library(model, vectors, data_root)
    report = build_report(data_root, vectors, features, labels, ids, oof, all_metrics, exported, missing)
    sel = report["selected_model_metrics"]
    print(f"Done: MAE {sel['mae']:.3f}, ±0.5★ {sel['within_half_star']:.1f}%")

    try:
        tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", f"sqlite:///{REPO_ROOT}/mlruns.db")
        mlflow.set_tracking_uri(tracking_uri)
        mlflow.set_experiment("kolo-star-rating")
        with mlflow.start_run(run_name=f"ensemble_seed_{args.random_state}"):
            mlflow.log_params({
                "random_state": args.random_state,
                "n_samples": len(final_labels),
                "model_name": MODEL_NAME,
                "embedding_dim": int(final_features.shape[1]),
                "svr_kernel": "rbf",
                "svr_c": 1.0,
                "svr_epsilon": 0.2,
                "extra_trees_estimators": 300,
                "extra_trees_min_leaf": 2,
                "extra_trees_max_features": 0.7,
            })
            for m_name, m_metrics in all_metrics.items():
                prefix = (
                    m_name.lower()
                    .replace(" ", "_")
                    .replace("(", "")
                    .replace(")", "")
                    .replace("+", "_")
                    .replace("–", "_")
                    .replace("-", "_")
                )
                mlflow.log_metrics({
                    f"{prefix}_mae": m_metrics["mae"],
                    f"{prefix}_rmse": m_metrics["rmse"],
                    f"{prefix}_pearson": m_metrics["pearson"],
                    f"{prefix}_spearman": m_metrics["spearman"],
                    f"{prefix}_within_half_star": m_metrics["within_half_star"],
                    f"{prefix}_within_one_star": m_metrics["within_one_star"],
                })
            mlflow.log_artifact(str(models_dir / "vibe_rating_model.joblib"))
            mlflow.log_artifact(str(models_dir / "rating_model_report.json"))
        print("Logged experiment metrics and artifacts to MLflow (mlruns/)")
    except Exception as e:
        print(f"Warning: MLflow tracking failed: {e}")


if __name__ == "__main__":
    main()
