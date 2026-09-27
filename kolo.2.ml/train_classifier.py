"""Compare binary preference classifiers on positive and negative embeddings."""

import argparse
import os
from pathlib import Path

import joblib
import mlflow
import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.neighbors import NearestCentroid
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import normalize
from sklearn.svm import LinearSVC


def resolve_path(p: Path) -> Path:
    if p.exists():
        return p
    script_dir = Path(__file__).resolve().parent
    if (script_dir / p).exists():
        return script_dir / p
    if (script_dir.parent / p).exists():
        return script_dir.parent / p
    return p


def load_data(pos_path: Path, neg_path: Path):
    """Loads positive and negative embeddings and filenames from NPZ files."""
    pos_path = resolve_path(pos_path)
    neg_path = resolve_path(neg_path)
    if not pos_path.exists():
        raise FileNotFoundError(f"Positive embeddings file not found: {pos_path}")
    if not neg_path.exists():
        raise FileNotFoundError(f"Negative embeddings file not found: {neg_path}")

    pos_data = np.load(str(pos_path))
    neg_data = np.load(str(neg_path))

    pos_X = pos_data["embeddings"]
    pos_files = pos_data["filenames"]
    pos_y = np.ones(len(pos_X), dtype=np.int32)

    neg_X = neg_data["embeddings"]
    neg_files = neg_data["filenames"]
    neg_y = np.zeros(len(neg_X), dtype=np.int32)

    X = np.vstack([pos_X, neg_X])
    y = np.concatenate([pos_y, neg_y])
    files = np.concatenate([pos_files, neg_files])

    print(f"[+] Loaded {len(pos_X)} positive samples from {pos_path.name}")
    print(f"[+] Loaded {len(neg_X)} negative samples from {neg_path.name}")
    print(f"[+] Total dataset: {len(X)} samples with {X.shape[1]}-dimensional embeddings")

    return X, y, files


def main():
    parser = argparse.ArgumentParser(description="Train music preference classifier on MuQ-MuLan embeddings.")
    parser.add_argument(
        "--pos-npz", type=str, default="kolo.0.data/pos_embeddings.npz", help="Path to positive embeddings NPZ"
    )
    parser.add_argument(
        "--neg-npz", type=str, default="kolo.0.data/neg_embeddings.npz", help="Path to negative embeddings NPZ"
    )
    parser.add_argument("--output-dir", type=str, default="models", help="Directory to save trained model")
    parser.add_argument("--test-size", type=float, default=0.20, help="Test set fraction (default: 0.20)")
    parser.add_argument("--random-state", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    X, y, files = load_data(Path(args.pos_npz), Path(args.neg_npz))

    X_norm = normalize(X, norm="l2")

    X_train, X_test, y_train, y_test, files_train, files_test = train_test_split(
        X_norm, y, files, test_size=args.test_size, random_state=args.random_state, stratify=y
    )
    print(f"\n[*] Train set: {len(y_train)} ({sum(y_train)} pos / {len(y_train)-sum(y_train)} neg)")
    print(f"[*] Test set:  {len(y_test)} ({sum(y_test)} pos / {len(y_test)-sum(y_test)} neg)")

    models = {
        "Logistic Regression (C=1.0)": LogisticRegression(
            C=1.0, max_iter=1000, class_weight="balanced", random_state=args.random_state
        ),
        "Logistic Regression (C=10.0)": LogisticRegression(
            C=10.0, max_iter=1000, class_weight="balanced", random_state=args.random_state
        ),
        "Calibrated Linear SVM": CalibratedClassifierCV(
            LinearSVC(class_weight="balanced", random_state=args.random_state, max_iter=2000)
        ),
        "MLP Classifier (128 -> 32)": MLPClassifier(
            hidden_layer_sizes=(128, 32), max_iter=500, early_stopping=True, random_state=args.random_state
        ),
        "Nearest Centroid (Cosine)": NearestCentroid(metric="euclidean"),
        "Random Forest (100 trees)": RandomForestClassifier(
            n_estimators=100, class_weight="balanced", random_state=args.random_state
        ),
    }

    results = []
    trained_models = {}

    separator = "=" * 85
    print(f"\n{separator}")
    print(f"{'Model':<30} | {'Test Acc':<9} | {'ROC-AUC':<9} | {'Precision':<9} | {'Recall':<9} | {'F1':<6}")
    print(separator)

    best_model_name = None
    best_auc = 0.0

    for name, clf in models.items():
        clf.fit(X_train, y_train)
        trained_models[name] = clf

        preds = clf.predict(X_test)

        if hasattr(clf, "predict_proba"):
            probs = clf.predict_proba(X_test)[:, 1]
        elif hasattr(clf, "decision_function"):
            probs = clf.decision_function(X_test)
        else:
            probs = preds

        acc = accuracy_score(y_test, preds)
        auc = roc_auc_score(y_test, probs)
        prec = precision_score(y_test, preds, zero_division=0)
        rec = recall_score(y_test, preds, zero_division=0)
        f1 = f1_score(y_test, preds, zero_division=0)

        results.append(
            {
                "model": name,
                "accuracy": acc,
                "roc_auc": auc,
                "precision": prec,
                "recall": rec,
                "f1": f1,
            }
        )

        if auc > best_auc:
            best_auc = auc
            best_model_name = name

        print(
            f"{name:<30} | {acc * 100:6.2f}%   | {auc:7.4f}   | "
            f"{prec * 100:6.2f}%    | {rec * 100:6.2f}%   | {f1:5.3f}"
        )

    print(separator)

    if best_model_name is None:
        raise RuntimeError("No classifier was trained")
    best_clf = trained_models[best_model_name]
    print(f"\n[★] Best Performing Model: {best_model_name} (ROC-AUC: {best_auc:.4f})")

    model_save_path = out_dir / "vibe_classifier.joblib"
    save_payload = {
        "model": best_clf,
        "model_name": best_model_name,
        "l2_normalize": True,
        "embedding_dim": X.shape[1],
        "metrics": next(r for r in results if r["model"] == best_model_name),
    }
    joblib.dump(save_payload, model_save_path)
    print(f"[✓] Saved model to: {model_save_path}")

    best_preds = best_clf.predict(X_test)
    if hasattr(best_clf, "predict_proba"):
        best_probs = best_clf.predict_proba(X_test)[:, 1]
    else:
        best_probs = best_preds

    print("\n[+] Confusion Matrix on Test Set:")
    cm = confusion_matrix(y_test, best_preds)
    print(f"    True Negative: {cm[0,0]:<4} | False Positive: {cm[0,1]:<4}")
    print(f"    False Negative: {cm[1,0]:<4} | True Positive:  {cm[1,1]:<4}")

    neg_mask = y_test == 0
    if any(neg_mask):
        neg_indices = np.where(neg_mask)[0]
        sorted_fp = neg_indices[np.argsort(-best_probs[neg_indices])]
        print("\n[?] Top 5 Potential False Positives (Disliked/Random songs with highest vibe score):")
        for i in sorted_fp[:5]:
            print(f"    - Score: {best_probs[i]:.3f} | {files_test[i]}")

    pos_mask = y_test == 1
    if any(pos_mask):
        pos_indices = np.where(pos_mask)[0]
        sorted_fn = pos_indices[np.argsort(best_probs[pos_indices])]
        print("\n[?] Top 5 Potential False Negatives (Liked songs with lowest vibe score):")
        for i in sorted_fn[:5]:
            print(f"    - Score: {best_probs[i]:.3f} | {files_test[i]}")

    try:
        repo_root = Path(__file__).resolve().parent.parent
        tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", f"sqlite:///{repo_root}/mlruns.db")
        mlflow.set_tracking_uri(tracking_uri)
        mlflow.set_experiment("kolo-classifier-benchmark")
        with mlflow.start_run(run_name="classifier_benchmark"):
            mlflow.log_params(
                {
                    "test_size": args.test_size,
                    "random_state": args.random_state,
                    "total_samples": len(X),
                    "pos_samples": int(np.sum(y == 1)),
                    "neg_samples": int(np.sum(y == 0)),
                    "best_model": best_model_name,
                }
            )
            for r in results:
                prefix = (
                    r["model"].lower()
                    .replace(" ", "_")
                    .replace("(", "")
                    .replace(")", "")
                    .replace("->", "_")
                    .replace("=", "_")
                    .replace(".", "_")
                )
                mlflow.log_metrics(
                    {
                        f"{prefix}_accuracy": float(r["accuracy"]),
                        f"{prefix}_roc_auc": float(r["roc_auc"]),
                        f"{prefix}_precision": float(r["precision"]),
                        f"{prefix}_recall": float(r["recall"]),
                        f"{prefix}_f1": float(r["f1"]),
                    }
                )
            mlflow.log_artifact(str(model_save_path))
        print("[+] Logged classifier benchmark to MLflow (mlruns/)")
    except Exception as e:
        print(f"[!] Warning: MLflow tracking failed: {e}")


if __name__ == "__main__":
    main()
