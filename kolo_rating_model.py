"""Serializable model adapter shared by Kolo training and inference."""

from typing import Any

import numpy as np
from sklearn.preprocessing import normalize

# Folders holding the user's own collection. Everything else (imports, Spotify
# playlists, discoveries) is new music the user has not chosen yet.
LIBRARY_PREFIXES = ("pos/", "downloads/", "neg/")


def is_candidate_track(track_id: str) -> bool:
    """Whether a track is new music rather than part of the user's collection."""
    return not track_id.startswith(LIBRARY_PREFIXES)


def rating_category(rating: float) -> str:
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


def ai_rating_entry(raw_rating: float) -> dict[str, Any]:
    """Build the ``ai_ratings.json`` record for one raw model estimate."""
    # The app displays half-star steps but retains the raw estimate for reports.
    displayed_rating = round(raw_rating * 2) / 2
    return {
        "rating": displayed_rating,
        "rawRating": round(raw_rating, 2),
        "vibeScore": round(min(max((raw_rating - 0.5) / 4.5, 0.0), 1.0), 3),
        "category": rating_category(displayed_rating),
    }


def with_source_flag(features: np.ndarray, candidate: Any, scale: float) -> np.ndarray:
    """Append a column telling the model whether each row is new music.

    New tracks sound like the collection but are liked far less often, so the
    model needs to know which population a track comes from.
    """
    flags = np.broadcast_to(np.asarray(candidate, dtype=np.float32), (len(features),))
    return np.column_stack((features, scale * flags)).astype(np.float32)


class VibeRatingModel:
    """Expose star ratings and legacy binary-classifier style probabilities.

    ``candidate`` is True for new music (the default, since unknown tracks are
    what callers usually score) and False for tracks in the user's collection.
    It may be a single bool or one value per row.
    """

    def __init__(self, regressor, name: str, l2_norm: bool = True, candidate_flag: float | None = None):
        self.regressor = regressor
        self.model_name = name
        self.l2_norm = l2_norm
        self.candidate_flag = candidate_flag

    def predict_rating(self, features: np.ndarray, candidate: Any = True) -> np.ndarray:
        values = np.asarray(features, dtype=np.float32)
        if self.l2_norm:
            values = normalize(values, norm="l2")
        # Models pickled before the source flag existed lack the attribute.
        scale = getattr(self, "candidate_flag", None)
        if scale is not None:
            values = with_source_flag(values, candidate, scale)
        return np.clip(self.regressor.predict(values), 0.5, 5.0)

    def predict_vibe_score(self, features: np.ndarray, candidate: Any = True) -> np.ndarray:
        # Keep 0..1 vibe contract while stars remain the primary output.
        return np.clip((self.predict_rating(features, candidate) - 0.5) / 4.5, 0.0, 1.0)

    def predict(self, features: np.ndarray, candidate: Any = True) -> np.ndarray:
        return (self.predict_rating(features, candidate) >= 3.5).astype(np.int32)

    def predict_proba(self, features: np.ndarray, candidate: Any = True) -> np.ndarray:
        scores = self.predict_vibe_score(features, candidate)
        return np.column_stack((1.0 - scores, scores)).astype(np.float32)
