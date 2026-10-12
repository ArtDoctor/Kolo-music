# Kolo Rating Model Report

## Coverage

- **2113 / 2113 audio files have vectors** (2113 vectors in the index).
- **1342 explicit app ratings** were used for training and evaluation.
- The legacy binary negative set was not given artificial star values.

## Out-of-fold performance

- Model: **Preference Ensemble (RBF SVR + Extra Trees)**
- MAE: **0.525 stars**; RMSE: **0.733 stars**
- Within ±0.5 star: **62.6%**; within ±1 star: **85.8%**
- Pearson correlation: **0.519**; Spearman: **0.448**
- Among raw OOF predictions ≥4: **83.3%** were actually ≥4 (**91.7%** were ≥3.5, allowing ±0.5 tolerance).

These are predictions for held-out personal labels, not training-set scores. The older headline binary-classification accuracy is not comparable to this harder rating task. App predictions are rounded to the nearest half-star label; raw values remain in the JSON report.

## Largest misses (out of fold)

| Track | Actual | Predicted | Error |
|---|---:|---:|---:|
| imported/PROM - Tearing me apart.mp3 | 0.5 | 3.48 | +2.98 |
| downloads/OLD/ASTXR, KIRXSHA - ILLIMINATE.mp3 | 0.5 | 3.30 | +2.80 |
| imported/Monstaz. - SAME OLD LIES.mp3 | 0.5 | 3.24 | +2.74 |
| downloads/OLD/EESE - Move On.mp3 | 0.5 | 3.21 | +2.71 |
| discovery/Dead Poet Society - Under My Skin (Official Audio) [anguc16ihMQ].mp3 | 1.0 | 3.65 | +2.65 |
| downloads/OLD/Bad Blood Orchestra - When I Let You Go.mp3 | 0.5 | 3.14 | +2.64 |
| imported/Kiltro - The Drunk.mp3 | 0.5 | 3.14 | +2.64 |
| imported/RAT BOY, IBDY - Likewise.mp3 | 0.5 | 3.09 | +2.59 |
| downloads/OLD/Starwolf - I'm so Dangerous.mp3 | 0.5 | 3.04 | +2.54 |
| neg/Bebe Rexha - The Way I Are (Dance With Somebody) feat. Lil Wayne [Official Music Video] [g6xvHG8nd5U].mp3 | 0.5 | 2.95 | +2.45 |
| imported/wishlane - SUCKER PUNCH.mp3 | 0.5 | 2.93 | +2.43 |
| imported/Saint Punk, Matt McAndrew - Gloves (with Matt McAndrew).mp3 | 1.0 | 3.42 | +2.42 |

## Unrated 4+ star recommendations

| Track | AI rating | Raw | Similar rated evidence |
|---|---:|---:|---|
| imported/LUZ_ROJA_ROCK_VERSION_-_1_HOUR_LOOP_SLOWED_+_REVERB-lyK9-mr7Q7s.mp3 | 4.0 | 4.13 | LUZ_ROJA_Rock_Version_-_Slowed-VbWuv6VfQ8E (4.5★); Suoming_NAQUELA_Sped_Up_KICKSTXP_AMV_8K-ATEU8JDCEbY (4.0★); Consoul Trainin - Obsession (slowed) (3.0★) |

## Caveats

- The test folds are random rather than grouped by recording, so alternate/remixed versions can make results mildly optimistic.
- 0.5–2.0 and 5.0 star labels are sparse; predictions at the extremes regress toward the middle.
- A predicted rating is a ranking aid, not ground truth; ±0.5 star is treated as a plausible hit.
