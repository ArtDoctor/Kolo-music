"""Compare the rating ensemble with MLP and cosine-kNN regressors."""

import argparse
import io
import os
import pickle
import sys
import time
from pathlib import Path

import matplotlib
import mlflow
import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import KFold
from sklearn.neighbors import KNeighborsRegressor
from sklearn.preprocessing import normalize

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _load_baseline_helpers():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "kolo_train_rating_model",
        REPO_ROOT / "kolo.2.ml" / "train_rating_model.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load train_rating_model.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_helpers = _load_baseline_helpers()
load_embeddings = _helpers.load_embeddings
load_user_labels = _helpers.load_user_labels
make_preference_ensemble = _helpers.make_preference_ensemble
metrics_for = _helpers.metrics_for
resolve_path = _helpers.resolve_path

MODEL_NAME = "Preference Ensemble (RBF SVR + Extra Trees)"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


class RatingMLP(nn.Module):
    def __init__(self, dim: int = 512, dropout: float = 0.25):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(dim, 256),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(128, 1),
            nn.Sigmoid(),  # targets scaled to [0, 1]
        )

    def forward(self, x):
        return self.net(x).squeeze(-1)


def train_mlp_fold(X_tr, y_tr, X_va, y_va, seed, max_epochs=400, patience=30):
    torch.manual_seed(seed)
    model = RatingMLP(X_tr.shape[1]).to(DEVICE)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    loss_fn = nn.MSELoss()

    def to_tensor(array):
        return torch.from_numpy(array).to(DEVICE)

    Xtr, Ytr, Xva, Yva = to_tensor(X_tr), to_tensor(y_tr), to_tensor(X_va), to_tensor(y_va)
    loader = torch.utils.data.DataLoader(
        torch.utils.data.TensorDataset(Xtr, Ytr),
        batch_size=256,
        shuffle=True,
        generator=torch.Generator().manual_seed(seed),
    )
    best, best_state, bad = float("inf"), None, 0
    train_hist, val_hist = [], []
    for _ in range(max_epochs):
        model.train()
        tot = 0.0
        for xb, yb in loader:
            opt.zero_grad()
            loss = loss_fn(model(xb), yb)
            loss.backward()
            opt.step()
            tot += loss.item() * len(xb)
        train_hist.append(tot / len(Xtr))
        model.eval()
        with torch.no_grad():
            v = loss_fn(model(Xva), Yva).item()
        val_hist.append(v)
        if v < best - 1e-5:
            best, bad = v, 0
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= patience:
                break
    if best_state is None:
        raise RuntimeError("MLP training did not produce a checkpoint")
    model.load_state_dict({key: value.to(DEVICE) for key, value in best_state.items()})
    return model, train_hist, val_hist


def run_mlp(X, y, folds, seed, run):
    oof = np.zeros(len(y), dtype=np.float32)
    fit_times, curves = [], []
    for f, (tr, te) in enumerate(folds):
        rng = np.random.RandomState(seed + f)
        sub = rng.permutation(tr)
        cut = int(0.9 * len(sub))
        str_, va_ = sub[:cut], sub[cut:]

        def scale_ratings(values):
            return ((values - 0.5) / 4.5).astype(np.float32)

        t0 = time.perf_counter()
        model, th, vh = train_mlp_fold(
            X[str_],
            scale_ratings(y[str_]),
            X[va_],
            scale_ratings(y[va_]),
            seed + f,
        )
        fit_times.append(time.perf_counter() - t0)
        curves.append((th, vh))
        for epoch, (a, b) in enumerate(zip(th, vh)):
            run.log_metric(f"mlp_fold{f}_train_mse", a, step=epoch)
            run.log_metric(f"mlp_fold{f}_val_mse", b, step=epoch)
        model.eval()
        with torch.no_grad():
            p01 = model(torch.from_numpy(X[te]).to(DEVICE)).cpu().numpy()
        oof[te] = np.clip(p01 * 4.5 + 0.5, 0.5, 5.0)
        buf = io.BytesIO()
        torch.save(model.state_dict(), buf)
        size_kb = buf.tell() / 1024
    return oof, fit_times, curves, size_kb


def run_knn(X, y, folds, k_choices=(5, 11, 25, 51)):
    oof_by_k, sweep = {}, {}
    t0 = time.perf_counter()
    for k in k_choices:
        oof = np.zeros(len(y), dtype=np.float32)
        for tr, te in folds:
            m = KNeighborsRegressor(n_neighbors=k, weights="distance", metric="cosine", n_jobs=-1)
            m.fit(X[tr], y[tr])
            oof[te] = np.clip(m.predict(X[te]), 0.5, 5.0)
        oof_by_k[k] = oof
        sweep[k] = mean_absolute_error(y, oof)
    fit_t = (time.perf_counter() - t0) / len(k_choices)
    # Measure prediction latency after fitting the selected value of k.
    m = KNeighborsRegressor(n_neighbors=25, weights="distance", metric="cosine", n_jobs=-1)
    m.fit(X, y)
    t1 = time.perf_counter()
    m.predict(X[:256])
    pred_ms = (time.perf_counter() - t1) / 256 * 1000
    size_kb = X.nbytes / 1024  # must store train set
    return oof_by_k, sweep, fit_t, pred_ms, size_kb


def run_baseline(X, y, folds, seed):
    oof = np.zeros(len(y), dtype=np.float32)
    fit_times, pred_times = [], []
    for tr, te in folds:
        m = make_preference_ensemble(seed)
        t0 = time.perf_counter()
        m.fit(X[tr], y[tr])
        fit_times.append(time.perf_counter() - t0)
        t1 = time.perf_counter()
        oof[te] = np.clip(m.predict(X[te]), 0.5, 5.0)
        pred_times.append((time.perf_counter() - t1) / len(te) * 1000)
    size_kb = len(pickle.dumps(m)) / 1024
    return oof, fit_times, pred_times, size_kb


def fig_metrics(results, out):
    names = list(results)
    mae = [results[n]["metrics"]["mae"] for n in names]
    rmse = [results[n]["metrics"]["rmse"] for n in names]
    half = [results[n]["metrics"]["within_half_star"] for n in names]
    pear = [results[n]["metrics"]["pearson"] for n in names]
    fig, ax = plt.subplots(2, 2, figsize=(11, 7))
    for a, vals, ttl in zip(ax.flat, [mae, rmse, half, pear],
                            ["MAE ↓ (stars)", "RMSE ↓ (stars)", "Within ±0.5★ ↑ (%)", "Pearson ↑"]):
        bars = a.bar(names, vals, color=["#3b82f6", "#f59e0b", "#10b981"])
        a.set_title(ttl)
        for b, v in zip(bars, vals):
            a.text(b.get_x() + b.get_width() / 2, b.get_height(), f"{v:.3f}",
                   ha="center", va="bottom", fontsize=9)
        a.tick_params(axis="x", rotation=12)
    fig.suptitle("OOF rating accuracy — same 5 folds, same labels", fontsize=13)
    fig.tight_layout()
    fig.savefig(out, dpi=140)
    plt.close(fig)


def fig_training(mlp_curves, knn_sweep, baseline_mae, out):
    fig, ax = plt.subplots(1, 2, figsize=(12, 4.5))
    min_len = min(len(v) for _, v in mlp_curves)
    T = np.array([t[:min_len] for t, _ in mlp_curves])
    V = np.array([v[:min_len] for _, v in mlp_curves])
    ep = np.arange(min_len)
    for arr, lab, col in [(T, "train", "#f59e0b"), (V, "val", "#3b82f6")]:
        ax[0].plot(ep, arr.mean(0), color=col, label=f"{lab} mean")
        ax[0].fill_between(ep, arr.mean(0) - arr.std(0), arr.mean(0) + arr.std(0),
                           color=col, alpha=0.2, label=f"{lab} ±1σ")
    ax[0].set_title("Challenger A (MLP): MSE vs epoch (5 folds)")
    ax[0].set_xlabel("epoch")
    ax[0].legend(fontsize=8)
    ks = sorted(knn_sweep)
    ax[1].plot(ks, [knn_sweep[k] for k in ks], "o-", color="#10b981", label="kNN OOF MAE")
    ax[1].axhline(baseline_mae, color="gray", ls="--", label="ensemble MAE ref")
    ax[1].set_title("Challenger B (kNN): MAE vs k")
    ax[1].set_xlabel("k (distance-weighted, cosine)")
    ax[1].legend(fontsize=8)
    fig.suptitle("Training cycles", fontsize=13)
    fig.tight_layout()
    fig.savefig(out, dpi=140)
    plt.close(fig)


def fig_tradeoff(results, out):
    fig, a = plt.subplots(figsize=(9, 5.5))
    cols = {"Preference Ensemble": "#3b82f6", "MLP (PyTorch)": "#f59e0b", "kNN-cosine (k=25)": "#10b981"}
    offs = {"Preference Ensemble": (10, -22), "MLP (PyTorch)": (10, 8), "kNN-cosine (k=25)": (10, 8)}
    sizes = {n: r["size_kb"] for n, r in results.items()}
    smax = max(sizes.values())
    for n, r in results.items():
        a.scatter(r["fit_s"], r["metrics"]["mae"], s=80 + 500 * (r["size_kb"] / smax),
                  color=cols[n], alpha=0.7, label=n, edgecolors="white", linewidths=1)
        a.annotate(f"{n}\n{r['fit_s']:.1f}s fit, {r['size_kb']:.0f}KB",
                   (r["fit_s"], r["metrics"]["mae"]), fontsize=8,
                   xytext=offs[n], textcoords="offset points",
                   bbox=dict(boxstyle="round,pad=0.3", fc="white", ec="0.8", alpha=0.9))
    fits = [r["fit_s"] for r in results.values()]
    maes = [r["metrics"]["mae"] for r in results.values()]
    a.set_xlim(min(fits) * 0.55, max(fits) * 2.2)
    a.set_ylim(min(maes) - 0.012, max(maes) + 0.012)
    a.set_xscale("log")
    a.set_xlabel("mean fit time per fold (s, log)")
    a.set_ylabel("OOF MAE (stars) ↓")
    a.set_title("Speed / accuracy / size (bubble = model KB)")
    a.legend(fontsize=8, loc="best")
    fig.tight_layout()
    fig.savefig(out, dpi=140)
    plt.close(fig)


def fig_parity(results, y, out):
    fig, ax = plt.subplots(1, 3, figsize=(13, 4))
    for a, n in zip(ax, results):
        a.scatter(y, results[n]["oof"], s=6, alpha=0.35)
        a.plot([0.5, 5], [0.5, 5], "r--", lw=1)
        a.set_title(f"{n}\nMAE {results[n]['metrics']['mae']:.3f}")
        a.set_xlabel("actual ★")
        a.set_ylabel("OOF predicted ★")
        a.set_xlim(0, 5.5)
        a.set_ylim(0, 5.5)
    fig.suptitle("Out-of-fold parity: predicted vs actual stars", fontsize=13)
    fig.tight_layout()
    fig.savefig(out, dpi=140)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root", default="kolo.0.data")
    ap.add_argument("--random-state", type=int, default=42)
    args = ap.parse_args()

    data_root = resolve_path(args.data_root).resolve()
    docs = REPO_ROOT / "kolo.2.ml" / "docs"
    docs.mkdir(parents=True, exist_ok=True)

    vectors = load_embeddings(data_root)
    X_all, y_all, ids, _, _ = load_user_labels(data_root, vectors)
    X = normalize(X_all, norm="l2").astype(np.float32)
    y = y_all.astype(np.float32)
    print(f"[+] n={len(y)}, dim={X.shape[1]}, device={DEVICE}")
    folds = list(KFold(n_splits=5, shuffle=True, random_state=args.random_state).split(X))

    mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI", f"sqlite:///{REPO_ROOT}/mlruns.db"))
    mlflow.set_experiment("kolo-rating-challengers")
    results, artifacts = {}, {}

    with mlflow.start_run(run_name="challenger_comparison"):
        print("[1/3] baseline ensemble (identical folds)...")
        oof_e, ft_e, pt_e, sz_e = run_baseline(X, y, folds, args.random_state)
        results["Preference Ensemble"] = {
            "oof": oof_e, "metrics": metrics_for(y, oof_e),
            "fit_s": float(np.mean(ft_e)), "pred_ms": float(np.mean(pt_e)), "size_kb": sz_e}
        print("[2/3] kNN sweep...")
        oof_k, sweep, fit_k, pred_k, sz_k = run_knn(X, y, folds)
        results["kNN-cosine (k=25)"] = {
            "oof": oof_k[25], "metrics": metrics_for(y, oof_k[25]),
            "fit_s": fit_k, "pred_ms": pred_k, "size_kb": sz_k}
        for k, v in sweep.items():
            mlflow.log_metric(f"knn_k{k}_mae", v)
        print("[3/3] MLP 5-fold (CUDA)" if DEVICE == "cuda" else "[3/3] MLP 5-fold (CPU)...")
        oof_m, ft_m, curves, sz_m = run_mlp(X, y, folds, args.random_state, mlflow)
        results["MLP (PyTorch)"] = {
            "oof": oof_m, "metrics": metrics_for(y, oof_m),
            "fit_s": float(np.mean(ft_m)), "pred_ms": 0.05, "size_kb": sz_m}

        for name, r in results.items():
            p = __import__("re").sub(r"[^a-z0-9_\.\- /:]+", "_", name.lower()).strip("_")
            mlflow.log_metrics({f"{p}_mae": r["metrics"]["mae"], f"{p}_rmse": r["metrics"]["rmse"],
                                f"{p}_pearson": r["metrics"]["pearson"],
                                f"{p}_within_half_star": r["metrics"]["within_half_star"],
                                f"{p}_fit_s": r["fit_s"], f"{p}_size_kb": r["size_kb"]})

        fig_metrics(results, docs / "challenger_metrics.png")
        fig_training(curves, sweep, results["Preference Ensemble"]["metrics"]["mae"],
                     docs / "challenger_training.png")
        fig_tradeoff(results, docs / "challenger_tradeoff.png")
        fig_parity(results, y, docs / "challenger_parity.png")
        for f in ["challenger_metrics.png", "challenger_training.png",
                  "challenger_tradeoff.png", "challenger_parity.png"]:
            mlflow.log_artifact(str(docs / f))
            artifacts[f] = str(docs / f)

    print("\nModel                    MAE    RMSE   ±0.5★  Pearson  fit(s)  size")
    rows = []
    for n, r in results.items():
        m = r["metrics"]
        print(f"{n:<24} {m['mae']:.3f}  {m['rmse']:.3f}  {m['within_half_star']:5.1f}%  "
              f"{m['pearson']:.3f}   {r['fit_s']:6.1f}  {r['size_kb']:7.0f}KB")
        rows.append((n, m, r))

    best = min(rows, key=lambda t: t[1]["mae"])
    md = ["# Rating Challenger Report", "",
          f"Same data ({len(y)} ratings, 512-dim MuQ-MuLan), same 5 folds (seed {args.random_state}).",
          f"MLflow experiment: `kolo-rating-challengers` / run `challenger_comparison` ({DEVICE}).", "",
          "| Model | MAE ↓ | RMSE ↓ | ±0.5★ ↑ | Pearson ↑ | fit/fold ↓ | size ↓ |",
          "|---|---:|---:|---:|---:|---:|---:|"]
    for n, m, r in rows:
        md.append(f"| {n} | {m['mae']:.3f} | {m['rmse']:.3f} | {m['within_half_star']:.1f}% | "
                  f"{m['pearson']:.3f} | {r['fit_s']:.1f}s | {r['size_kb']:.0f}KB |")
    md += ["", f"**Most accurate: {best[0]} (MAE {best[1]['mae']:.3f}).**",
           "", "## Plots",
           "![metrics](challenger_metrics.png)", "![training](challenger_training.png)",
           "![tradeoff](challenger_tradeoff.png)", "![parity](challenger_parity.png)", ""]
    (docs / "challenger_report.md").write_text("\n".join(md), encoding="utf-8")
    print("[+] report + 4 PNGs in kolo.2.ml/docs/")


if __name__ == "__main__":
    main()
