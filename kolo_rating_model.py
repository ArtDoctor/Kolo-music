"""Serializable model adapter shared by Kolo training and inference."""

import numpy as np
from sklearn.preprocessing import normalize


class VibeRatingModel:
    """Expose star ratings and legacy binary-classifier style probabilities."""

    def __init__(self, regressor, name: str, l2_norm: bool = True):
        self.regressor = regressor
        self.model_name = name
        self.l2_norm = l2_norm

    def predict_rating(self, features: np.ndarray) -> np.ndarray:
        values = np.asarray(features, dtype=np.float32)
        if self.l2_norm:
            values = normalize(values, norm="l2")
        return np.clip(self.regressor.predict(values), 0.5, 5.0)

    def predict_vibe_score(self, features: np.ndarray) -> np.ndarray:
        # Keep 0..1 vibe contract while stars remain the primary output.
        return np.clip((self.predict_rating(features) - 0.5) / 4.5, 0.0, 1.0)

    def predict(self, features: np.ndarray) -> np.ndarray:
        return (self.predict_rating(features) >= 3.5).astype(np.int32)

    def predict_proba(self, features: np.ndarray) -> np.ndarray:
        scores = self.predict_vibe_score(features)
        return np.column_stack((1.0 - scores, scores)).astype(np.float32)
