# Legacy Negative-Anchor Experiment

Compared on the same **1208 held-out explicit app ratings**. The experimental training folds additionally contain **506 unrated legacy-negative tracks labeled 0.5★**.

| Negative weight | MAE ↓ | RMSE ↓ | Within ±0.5★ ↑ | Pearson ↑ |
|---:|---:|---:|---:|---:|
| 0.0 | 0.472 | 0.652 | 64.8% | 0.523 |
| 0.05 | 0.495 | 0.674 | 62.1% | 0.474 |
| 0.1 | 0.502 | 0.688 | 61.9% | 0.461 |
| 0.25 | 0.512 | 0.707 | 61.6% | 0.439 |
| 0.5 | 0.519 | 0.720 | 61.6% | 0.427 |
| 1.0 | 0.524 | 0.726 | 61.2% | 0.424 |

## Result

Equal-weight negatives changed MAE from **0.472** to **0.524** and ±0.5★ accuracy from **64.8%** to **61.2%**. Every tested weight worsened overall held-out accuracy.

The negative anchors slightly improved 4★ recommendation precision, but that estimate used only 8–11 held-out predictions. It did not offset the overall degradation.

**Decision:** retain the explicit-rating model in the app. The equal-weight variant is saved at `models/vibe_rating_model_neg05_experiment.joblib` for inspection.
