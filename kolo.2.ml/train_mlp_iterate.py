"""Compare MLP architectures, losses, and target encodings on fixed folds."""

import argparse
import os
import sys
import time
from pathlib import Path

import matplotlib
import mlflow
import numpy as np
import torch
import torch.nn as nn
from sklearn.model_selection import KFold
from sklearn.preprocessing import normalize

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _load_helpers():
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


_helpers = _load_helpers()
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


class MLPBase(nn.Module):
    def __init__(self, dim=512, dropout=0.25, head="sigmoid"):
        super().__init__()
        self.body = nn.Sequential(
            nn.Linear(dim, 256), nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(256, 128), nn.ReLU(), nn.Dropout(dropout),
        )
        self.head = nn.Sequential(nn.Linear(128, 1), nn.Sigmoid()) if head == "sigmoid" else nn.Linear(128, 1)

    def forward(self, x):
        return self.head(self.body(x)).squeeze(-1)


class MLPWide(nn.Module):
    def __init__(self, dim=512, dropout=0.30, head="sigmoid"):
        super().__init__()
        self.body = nn.Sequential(
            nn.Linear(dim, 512), nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(512, 256), nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(256, 128), nn.ReLU(), nn.Dropout(dropout),
        )
        out = nn.Linear(128, 1)
        self.head = nn.Sequential(out, nn.Sigmoid()) if head == "sigmoid" else out

    def forward(self, x):
        return self.head(self.body(x)).squeeze(-1)


class ResBlock(nn.Module):
    def __init__(self, w, dropout):
        super().__init__()
        self.fc1 = nn.Linear(w, w)
        self.ln = nn.LayerNorm(w)
        self.fc2 = nn.Linear(w, w)
        self.drop = nn.Dropout(dropout)

    def forward(self, x):
        h = self.fc1(x)
        h = nn.functional.gelu(h)
        h = self.drop(h)
        h = self.fc2(h)
        return self.ln(x + self.drop(h))


class MLPRes(nn.Module):
    def __init__(self, dim=512, dropout=0.15, head="sigmoid"):
        super().__init__()
        self.inp = nn.Sequential(nn.Linear(dim, 256), nn.LayerNorm(256))
        self.b1 = ResBlock(256, dropout)
        self.b2 = ResBlock(256, dropout)
        self.down = nn.Sequential(nn.Linear(256, 128), nn.LayerNorm(128), nn.GELU(),
                                  nn.Dropout(dropout))
        out = nn.Linear(128, 1)
        self.head = nn.Sequential(out, nn.Sigmoid()) if head == "sigmoid" else out

    def forward(self, x):
        return self.head(self.down(self.b2(self.b1(self.inp(x))))).squeeze(-1)


# model factory, target encoding, loss, learning rate, weight decay, patience, epochs
VARIANTS = {
    "A_base": (lambda d: MLPBase(d, 0.25, "sigmoid"), "01", "mse", 3e-3, 1e-4, 30, 400),
    "B_wide": (lambda d: MLPWide(d, 0.30, "sigmoid"), "01", "mse", 3e-3, 1e-4, 30, 400),
    "C_res": (lambda d: MLPRes(d, 0.15, "sigmoid"), "01", "mse", 2e-3, 1e-4, 40, 500),
    "D_linout": (lambda d: MLPBase(d, 0.25, "linear"), "z", "mse", 3e-3, 1e-4, 30, 400),
    "E_huber": (lambda d: MLPBase(d, 0.25, "linear"), "z", "huber", 3e-3, 1e-4, 30, 400),
    "F_bigrob": (lambda d: MLPWide(d, 0.35, "linear"), "z", "huber", 2e-3, 3e-4, 40, 500),
}


def encode(y, kind, mean=None, std=None):
    if kind == "01":
        return ((y - 0.5) / 4.5).astype(np.float32), None, None
    if mean is None or std is None:
        mean = float(y.mean())
        std = float(y.std() + 1e-8)
    return ((y - mean) / std).astype(np.float32), mean, std


def decode(predictions, kind, mean, std):
    if kind == "01":
        return np.clip(predictions * 4.5 + 0.5, 0.5, 5.0)
    return np.clip(predictions * std + mean, 0.5, 5.0)


def train_fold(model_fn, X_tr, y_tr, X_va, y_va, target, loss, lr, wd, patience, max_epochs, seed):
    torch.manual_seed(seed)
    model = model_fn(X_tr.shape[1]).to(DEVICE)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=wd)
    loss_fn = nn.MSELoss() if loss == "mse" else nn.HuberLoss(delta=1.0 if target == "z" else 0.1)
    ytr, mu, sd = encode(y_tr, target)
    yva, _, _ = encode(y_va, target, mu, sd)

    def to_tensor(array):
        values = np.asarray(array, dtype=np.float32)
        return torch.from_numpy(values).to(DEVICE)

    Xtr, Ytr, Xva, Yva = to_tensor(X_tr), to_tensor(ytr), to_tensor(X_va), to_tensor(yva)
    loader = torch.utils.data.DataLoader(
        torch.utils.data.TensorDataset(Xtr, Ytr), batch_size=256, shuffle=True,
        generator=torch.Generator().manual_seed(seed))
    best, state, bad = float("inf"), None, 0
    th, vh = [], []
    for _ in range(max_epochs):
        model.train()
        tot = 0.0
        for xb, yb in loader:
            opt.zero_grad()
            batch_loss = loss_fn(model(xb), yb)
            batch_loss.backward()
            opt.step()
            tot += batch_loss.item() * len(xb)
        th.append(tot / len(Xtr))
        model.eval()
        with torch.no_grad():
            v = loss_fn(model(Xva), Yva).item()
        vh.append(v)
        if v < best - 1e-5:
            best, bad = v, 0
            state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= patience:
                break
    if state is None:
        raise RuntimeError("MLP training did not produce a checkpoint")
    model.load_state_dict({key: value.to(DEVICE) for key, value in state.items()})
    return model, th, vh, mu, sd


def run_variant(spec, X, y, folds, seed):
    model_fn, target, loss, lr, wd, patience, max_epochs = spec
    oof = np.zeros(len(y), dtype=np.float32)
    curves, t0 = [], time.perf_counter()
    for f, (tr, te) in enumerate(folds):
        rng = np.random.RandomState(seed + f)
        sub = rng.permutation(tr)
        cut = int(0.9 * len(sub))
        model, th, vh, mu, sd = train_fold(
            model_fn, X[sub[:cut]], y[sub[:cut]], X[sub[cut:]], y[sub[cut:]],
            target, loss, lr, wd, patience, max_epochs, seed + f)
        curves.append((th, vh))
        model.eval()
        with torch.no_grad():
            p = model(torch.from_numpy(X[te]).to(DEVICE)).cpu().numpy()
        oof[te] = decode(p, target, mu, sd)
    return oof, curves, time.perf_counter() - t0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root", default="kolo.0.data")
    ap.add_argument("--random-state", type=int, default=42)
    args = ap.parse_args()
    data_root = Path(args.data_root)
    if not data_root.is_absolute():
        data_root = (REPO_ROOT / data_root).resolve()
    docs = REPO_ROOT / "kolo.2.ml" / "docs"
    docs.mkdir(parents=True, exist_ok=True)

    vectors = _helpers.load_embeddings(data_root)
    Xa, ya, _, _, _ = _helpers.load_user_labels(data_root, vectors)
    X = normalize(Xa, norm="l2").astype(np.float32)
    y = ya.astype(np.float32)
    print(f"[+] n={len(y)}, device={DEVICE}")
    folds = list(KFold(n_splits=5, shuffle=True, random_state=args.random_state).split(X))

    mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI", f"sqlite:///{REPO_ROOT}/mlruns.db"))
    mlflow.set_experiment("kolo-mlp-iterations")
    table, val_curves = {}, {}

    with mlflow.start_run(run_name="mlp_variant_grid"):
        for name, spec in VARIANTS.items():
            print(f"[...] {name} ...", flush=True)
            oof, curves, secs = run_variant(spec, X, y, folds, args.random_state)
            m = _helpers.metrics_for(y, oof)
            table[name] = (m, secs, oof)
            val_curves[name] = curves
            mlflow.log_metrics({f"{name}_mae": m["mae"], f"{name}_rmse": m["rmse"],
                                f"{name}_within_half_star": m["within_half_star"],
                                f"{name}_pearson": m["pearson"], f"{name}_fit_s": secs})
            for f, (_, vh) in enumerate(curves):
                for ep, v in enumerate(vh):
                    mlflow.log_metric(f"{name}_fold{f}_val", v, step=ep)
            print(f"     MAE {m['mae']:.3f}  ±0.5★ {m['within_half_star']:.1f}%  "
                  f"Pearson {m['pearson']:.3f}  ({secs:.0f}s)")
        print("[...] ensemble reference ...", flush=True)
        oof_e = np.zeros(len(y), dtype=np.float32)
        for tr, te in folds:
            mdl = _helpers.make_preference_ensemble(args.random_state)
            mdl.fit(X[tr], y[tr])
            oof_e[te] = np.clip(mdl.predict(X[te]), 0.5, 5.0)
        me = _helpers.metrics_for(y, oof_e)
        mlflow.log_metrics({"ensemble_mae": me["mae"], "ensemble_rmse": me["rmse"]})

    names = list(table)
    fig, a = plt.subplots(figsize=(10, 4.5))
    vals = [table[n][0]["mae"] for n in names]
    cols = ["#9ca3af" if n != min(table, key=lambda k: table[k][0]["mae"]) else "#10b981" for n in names]
    bars = a.bar(names, vals, color=cols)
    a.set_ylim(0.44, 0.55)
    a.axhline(me["mae"], color="#3b82f6", ls="--", label=f"ensemble {me['mae']:.3f}")
    for b, v in zip(bars, vals):
        a.text(b.get_x() + b.get_width() / 2, b.get_height(), f"{v:.3f}",
               ha="center", va="bottom", fontsize=9)
    a.set_title("MLP variants: OOF MAE ↓ (same 5 folds)")
    a.legend(fontsize=9)
    fig.tight_layout()
    fig.savefig(docs / "mlp_variants_mae.png", dpi=140)
    plt.close(fig)

    fig, a = plt.subplots(figsize=(10, 4.5))
    cmap = plt.cm.tab10
    for i, n in enumerate(names):
        cs = val_curves[n]
        L = min(len(v) for _, v in cs)
        V = np.array([v[:L] for _, v in cs])
        # Normalize by the first epoch because the target encodings put losses on different scales.
        base = V[:, 0:1].clip(min=1e-8)
        Rn = V / base
        a.plot(np.arange(L), Rn.mean(0), color=cmap(i), label=f"{n} rel. val")
    a.axhline(1.0, color="gray", ls=":", lw=1)
    a.set_title("Val loss shape per variant (mean of 5 folds, ÷ epoch-0)")
    a.set_ylabel("relative val loss (1.0 = start)")
    a.set_xlabel("epoch")
    a.legend(fontsize=8, ncol=2)
    fig.tight_layout()
    fig.savefig(docs / "mlp_variants_curves.png", dpi=140)
    plt.close(fig)

    print("\nVariant   MAE    ±0.5★  Pearson  time")
    for n in names:
        m, s, _ = table[n]
        print(f"{n:<9} {m['mae']:.3f}  {m['within_half_star']:5.1f}%  {m['pearson']:.3f}   {s:4.0f}s")
    print(f"ensemble  {me['mae']:.3f}  {me['within_half_star']:5.1f}%  {me['pearson']:.3f}")
    best = min(names, key=lambda k: table[k][0]["mae"])
    md = ["# MLP Iteration Report", "",
          f"Same data ({len(y)} ratings), same 5 folds (seed {args.random_state}).", "",
          "| Variant | MAE ↓ | ±0.5★ ↑ | Pearson ↑ | train time |",
          "|---|---:|---:|---:|---:|"]
    for n in names:
        m, s, _ = table[n]
        md.append(f"| {n} | {m['mae']:.3f} | {m['within_half_star']:.1f}% | {m['pearson']:.3f} | {s:.0f}s |")
    md += [f"| **Ensemble (ref)** | **{me['mae']:.3f}** | **{me['within_half_star']:.1f}%** | "
           f"**{me['pearson']:.3f}** | — |",
           "", f"**Best MLP: {best} (MAE {table[best][0]['mae']:.3f}).**", "",
           "![mae](mlp_variants_mae.png)", "![curves](mlp_variants_curves.png)", ""]
    (docs / "mlp_iterations_report.md").write_text("\n".join(md), encoding="utf-8")
    print("[+] kolo.2.ml/docs/mlp_variants_*.png + mlp_iterations_report.md")


if __name__ == "__main__":
    main()
