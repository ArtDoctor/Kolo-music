# Negative samples for the binary benchmark

Kolo's first preference model treated the original library as positive examples and a separate collection as negative examples. That setup is still useful as a classifier benchmark, but it does not provide enough information for the current half-star rating task.

## Sampling choices

Two kinds of negative example are useful:

| Type | Example | What it tests |
| --- | --- | --- |
| Broad contrast | Genres far from the original library | Whether the embedding separates large stylistic differences |
| Hard negative | A rejected track from a familiar artist or adjacent genre | Whether the model learns preferences within a similar sound |

A dataset made entirely from broad contrast examples can produce an impressive accuracy number while learning little more than coarse genre boundaries. Hard negatives are more informative, but they should come from explicit skips, dislikes, or ratings rather than assumptions about a genre.

## Preferred sources

1. **Explicit ratings.** A low rating is the clearest signal and is the only negative signal used by the star-rating model.
2. **Personal listening history.** Repeated early skips can identify review candidates, but a skip should be confirmed before it becomes a label.
3. **Open research datasets.** FMA and MTG-Jamendo provide licensed audio and genre metadata suitable for broad contrast experiments.
4. **Manual candidate searches.** `download_negatives.py` can gather a small benchmark set, but downloaded material must be reviewed and used in accordance with its license and source terms.

## Result of the rating-model experiment

The [negative-anchor experiment](negative_anchor_experiment.md) assigned the legacy negative set a synthetic 0.5-star target at several sample weights. Every tested weight worsened held-out error on explicit ratings. The deployed regressor therefore trains only on user-assigned ratings.

The binary benchmark remains separate so its positive/negative labels are not confused with the 0.5–5.0 scale.
