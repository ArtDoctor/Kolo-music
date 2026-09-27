# Kolo Rating Model Report

## Coverage

- **2065 / 2065 audio files have vectors** (2065 total).
- **1208 explicit app ratings** were used for training and evaluation.
- The legacy binary negative set was not given artificial star values.

## Out-of-fold performance

- Model: **Preference Ensemble (RBF SVR + Extra Trees)**
- MAE: **0.472 stars**; RMSE: **0.652 stars**
- Within ±0.5 star: **64.8%**; within ±1 star: **90.0%**
- Pearson correlation: **0.523**; Spearman: **0.438**
- Among raw OOF predictions ≥4: **62.5%** were actually ≥4 (**87.5%** were ≥3.5, allowing the requested ±0.5 tolerance).

These are predictions for held-out personal labels, not training-set scores. The older headline binary-classification accuracy is not comparable to this harder rating task. App predictions are rounded to the nearest half-star label; raw values remain in the JSON report.

## Largest misses (out of fold)

| Track | Actual | Predicted | Error |
|---|---:|---:|---:|
| downloads/OLD/ASTXR, KIRXSHA - ILLIMINATE.mp3 | 0.5 | 3.38 | +2.88 |
| downloads/OLD/Bad Blood Orchestra - When I Let You Go.mp3 | 0.5 | 3.33 | +2.83 |
| discovery/Dead Poet Society - Under My Skin (Official Audio) [anguc16ihMQ].mp3 | 1.0 | 3.78 | +2.78 |
| downloads/OLD/EESE - Move On.mp3 | 0.5 | 3.27 | +2.77 |
| downloads/OLD/Starwolf - I'm so Dangerous.mp3 | 0.5 | 3.22 | +2.72 |
| downloads/OLD/Logan Levi - NEWSGIRL.mp3 | 0.5 | 3.15 | +2.65 |
| discovery/Dublin in Ecstasy [QfTWQ2mr3iE].mp3 | 1.0 | 3.51 | +2.51 |
| imported/flor - 24.mp3 | 0.5 | 2.97 | +2.47 |
| neg/Bebe Rexha - The Way I Are (Dance With Somebody) feat. Lil Wayne [Official Music Video] [g6xvHG8nd5U].mp3 | 0.5 | 2.97 | +2.47 |
| downloads/OLD/Disco Face - Too Late To Say Goodbye.mp3 | 1.0 | 3.42 | +2.42 |
| imported/Lappland_il_disoccupato_MONTAGEM_NOBODY_Slowed_DJ_PHXNTXM_AMV_8K-e78vLXLsAN4.mp3 | 5.0 | 2.63 | -2.37 |
| neg/Billboard Year-End 2022 ｜ Hot Country Songs ｜ Top 50 ｜ ChartExpress [nUI9awDOrBM].mp3 | 0.5 | 2.84 | +2.34 |

## Unrated 4+ star recommendations

No currently downloaded unrated track cleared the conservative 4.0-star threshold.

## Caveats

- The test folds are random rather than grouped by recording, so alternate/remixed versions can make results mildly optimistic.
- 0.5–2.0 and 5.0 star labels are sparse; predictions at the extremes regress toward the middle.
- A predicted rating is a ranking aid, not ground truth; ±0.5 star is treated as a plausible hit.
