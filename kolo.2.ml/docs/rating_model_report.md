# Kolo Rating Model Report

## Coverage

- **2214 / 2214 audio files have vectors** (2214 vectors in the index).
- **1440 explicit app ratings** were used for training and evaluation.
- The legacy binary negative set was not given artificial star values.

## Out-of-fold performance

- Model: **Preference Ensemble (RBF SVR + Extra Trees)**
- MAE: **0.500 stars**; RMSE: **0.676 stars**
- Within ±0.5 star: **61.5%**; within ±1 star: **88.5%**
- Pearson correlation: **0.677**; Spearman: **0.541**
- Among raw OOF predictions ≥4: **90.9%** were actually ≥4 (**100.0%** were ≥3.5, allowing ±0.5 tolerance).

These are predictions for held-out personal labels, not training-set scores. The older headline binary-classification accuracy is not comparable to this harder rating task. Shuffled folds mix the collection with new music, and the source flag lets the model tell the two apart, which flatters these figures; the batch-by-batch section below is the realistic measure. App predictions are rounded to the nearest half-star label; raw values remain in the JSON report.

## New music, rated batch by batch

Each import batch is rated by a model trained only on ratings made before it, which is how a new playlist is scored in practice. *Without flag* is the same ensemble when it is not told which tracks are new music.

| Batch | Tracks | Your avg | Predicted avg | Without flag | Spearman | Without flag | Top-5 liked |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-09-27 | 49 | 2.42 | 2.02 | 3.35 | 0.40 | 0.43 | 100% |
| 2026-09-30 | 39 | 1.94 | 2.13 | 3.20 | 0.50 | 0.40 | 60% |
| 2026-10-02 | 40 | 2.62 | 2.26 | 3.25 | 0.73 | 0.48 | 100% |
| 2026-10-16 | 36 | 2.33 | 2.16 | 3.18 | 0.17 | -0.03 | 40% |
| 2026-10-27 | 30 | 1.55 | 2.41 | 3.25 | 0.22 | -0.17 | 0% |

- Overall: MAE **1.04** stars (without flag 1.37); bias **-0.04** (+1.04).
- Ranking within a batch: Spearman **0.40** (0.22); AUC for liked (≥3★) tracks **0.61** (0.63).
- Of each batch's 5 top-rated tracks, **60%** were liked (without flag 44%); 32% of all new tracks were.

## Largest misses (out of fold)

| Track | Actual | Predicted | Error |
|---|---:|---:|---:|
| downloads/OLD/Bad Blood Orchestra - When I Let You Go.mp3 | 0.5 | 3.54 | +3.04 |
| downloads/OLD/ASTXR, KIRXSHA - ILLIMINATE.mp3 | 0.5 | 3.30 | +2.80 |
| downloads/OLD/Starwolf - I'm so Dangerous.mp3 | 0.5 | 3.25 | +2.75 |
| downloads/OLD/EESE - Move On.mp3 | 0.5 | 3.24 | +2.74 |
| downloads/OLD/Logan Levi - NEWSGIRL.mp3 | 0.5 | 3.14 | +2.64 |
| neg/Bebe Rexha - The Way I Are (Dance With Somebody) feat. Lil Wayne [Official Music Video] [g6xvHG8nd5U].mp3 | 0.5 | 3.07 | +2.57 |
| neg/Billboard Year-End 2022 ｜ Hot Country Songs ｜ Top 50 ｜ ChartExpress [nUI9awDOrBM].mp3 | 0.5 | 3.04 | +2.54 |
| imported/Battle_Tapes_-_Valley_People_PXLTR-m2zQ1zy0cE0.mp3 | 4.5 | 1.98 | -2.52 |
| imported/Letting_Go-vK2RmeP0r8o.mp3 | 5.0 | 2.51 | -2.49 |
| downloads/OLD/Disco Face - Too Late To Say Goodbye.mp3 | 1.0 | 3.39 | +2.39 |
| imported/Lappland_il_disoccupato_MONTAGEM_NOBODY_Slowed_DJ_PHXNTXM_AMV_8K-e78vLXLsAN4.mp3 | 5.0 | 2.66 | -2.34 |
| downloads/OLD/dye - taKe.mp3 | 0.5 | 2.84 | +2.34 |

## Top unrated new music

| Track | AI rating | Raw | Similar rated evidence |
|---|---:|---:|---|
| imported/LUZ_ROJA_ROCK_VERSION_-_1_HOUR_LOOP_SLOWED_+_REVERB-lyK9-mr7Q7s.mp3 | 4.0 | 4.24 | LUZ_ROJA_Rock_Version_-_Slowed-VbWuv6VfQ8E (4.5★); Suoming_NAQUELA_Sped_Up_KICKSTXP_AMV_8K-ATEU8JDCEbY (4.0★); Consoul Trainin - Obsession (slowed) (3.0★) |
| discovery/Inhaler - It Won't Always Be Like This (Official Video) [pad_iFvqtYw].mp3 | 1.5 | 1.46 | Kyd the Band - American Dreamer (1.0★); Lovejoy - Curse These Metal Hands (3.0★); ONR - Human Enough (1.0★) |
| imported/Culi. - HOW_TO_LIVE_FOREVER_.mp3 | 1.5 | 1.44 | Gengahr - Icarus (1.0★); Kyd the Band - American Dreamer (1.0★); Inhaler - Just To Keep You Satisfied (Official Lyric Video) [Fdl3VXnZglA] (1.5★) |
| imported/Sterling Press - Hell Song.mp3 | 1.5 | 1.33 | crywank_only_everyone_can_judge_me_lyrics_DONATE_TO_CRYWANK_IN_DESC (3.0★); Hana Lili - Iconic (1.0★); wilbur - Romance is Boring (Los Campesinos! Cover) (3.0★) |
| imported/Corduroy County - Sabertooth.mp3 | 1.5 | 1.31 | Swoon (4.5★); Weathers - Losing Blood - Official Lyric Video (3.0★); SIAMES - All The Best (3.0★) |

## Caveats

- The test folds are random rather than grouped by recording, so alternate/remixed versions can make results mildly optimistic.
- 0.5–2.0 and 5.0 star labels are sparse; predictions at the extremes regress toward the middle.
- New music sits close to the collection in embedding space, so ratings for it are a weak ranking signal; telling 0.5 from 2.5 stars is not reliable.
- A predicted rating is a ranking aid, not ground truth; ±0.5 star is treated as a plausible hit.
