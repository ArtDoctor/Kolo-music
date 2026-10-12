# Kolo Rating Model Report

## Coverage

- **2102 / 2102 audio files have vectors** (2102 vectors in the index).
- **1332 explicit app ratings** were used for training and evaluation.
- The legacy binary negative set was not given artificial star values.

## Out-of-fold performance

- Model: **Preference Ensemble (RBF SVR + Extra Trees)**
- MAE: **0.520 stars**; RMSE: **0.726 stars**
- Within ±0.5 star: **63.5%**; within ±1 star: **86.8%**
- Pearson correlation: **0.523**; Spearman: **0.454**
- Among raw OOF predictions ≥4: **88.9%** were actually ≥4 (**100.0%** were ≥3.5, allowing ±0.5 tolerance).

These are predictions for held-out personal labels, not training-set scores. The older headline binary-classification accuracy is not comparable to this harder rating task. App predictions are rounded to the nearest half-star label; raw values remain in the JSON report.

## Largest misses (out of fold)

| Track | Actual | Predicted | Error |
|---|---:|---:|---:|
| imported/PROM - Tearing me apart.mp3 | 0.5 | 3.60 | +3.10 |
| downloads/OLD/ASTXR, KIRXSHA - ILLIMINATE.mp3 | 0.5 | 3.27 | +2.77 |
| imported/RAT BOY, IBDY - Likewise.mp3 | 0.5 | 3.27 | +2.77 |
| discovery/Dead Poet Society - Under My Skin (Official Audio) [anguc16ihMQ].mp3 | 1.0 | 3.75 | +2.75 |
| imported/Monstaz. - SAME OLD LIES.mp3 | 0.5 | 3.24 | +2.74 |
| downloads/OLD/Bad Blood Orchestra - When I Let You Go.mp3 | 0.5 | 3.22 | +2.72 |
| downloads/OLD/EESE - Move On.mp3 | 0.5 | 3.13 | +2.63 |
| downloads/OLD/Starwolf - I'm so Dangerous.mp3 | 0.5 | 3.08 | +2.58 |
| downloads/OLD/Logan Levi - NEWSGIRL.mp3 | 0.5 | 2.91 | +2.41 |
| imported/Youngblood Hawke - Pressure.mp3 | 0.5 | 2.91 | +2.41 |
| imported/Kiltro - The Drunk.mp3 | 0.5 | 2.90 | +2.40 |
| imported/wishlane - SUCKER PUNCH.mp3 | 0.5 | 2.89 | +2.39 |

## Unrated 4+ star recommendations

No currently downloaded unrated track cleared the conservative 4.0-star threshold.

## Caveats

- The test folds are random rather than grouped by recording, so alternate/remixed versions can make results mildly optimistic.
- 0.5–2.0 and 5.0 star labels are sparse; predictions at the extremes regress toward the middle.
- A predicted rating is a ranking aid, not ground truth; ±0.5 star is treated as a plausible hit.
