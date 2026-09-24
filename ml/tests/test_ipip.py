"""IPIP-FFM scoring: keying, range, and agreement with the app's Mini-IPIP key."""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from ipip import KEYS, TRAIT_ORDER, item_columns, score_items

REPO = Path(__file__).resolve().parents[2]


def frame(values: dict[str, int], default: int = 3) -> pd.DataFrame:
    return pd.DataFrame([{c: values.get(c, default) for c in item_columns()}])


def test_all_neutral_scores_half():
    assert np.allclose(score_items(frame({})), 0.5)


def test_maximal_trait_scores_one_and_minimal_zero():
    for trait, (prefix, keys) in KEYS.items():
        hi = {f"{prefix}{i + 1}": (5 if k > 0 else 1) for i, k in enumerate(keys)}
        lo = {f"{prefix}{i + 1}": (1 if k > 0 else 5) for i, k in enumerate(keys)}
        idx = TRAIT_ORDER.index(trait)
        assert score_items(frame(hi))[0, idx] == 1.0
        assert score_items(frame(lo))[0, idx] == 0.0


def test_reverse_keyed_items_lower_the_score():
    # EXT2 "I don't talk a lot" is reverse keyed: agreeing lowers extraversion.
    base = score_items(frame({}))[0, TRAIT_ORDER.index("E")]
    assert score_items(frame({"EXT2": 5}))[0, TRAIT_ORDER.index("E")] < base
    assert score_items(frame({"EXT1": 5}))[0, TRAIT_ORDER.index("E")] > base


def test_mini_ipip_key_agrees_with_ipip_ffm_key():
    """Every Mini-IPIP item maps to an IPIP-FFM item with the same keying direction."""
    mini = json.loads((REPO / "config" / "mini_ipip.json").read_text(encoding="utf-8"))
    trait_prefix = {t: p for t, (p, _) in KEYS.items()}
    for item in mini["items"]:
        prefix = item["ipipFfm"].rstrip("0123456789")
        n = int(item["ipipFfm"][len(prefix):])
        assert prefix == trait_prefix[item["trait"]], item
        key = dict(KEYS)[item["trait"]][1][n - 1]
        assert (key < 0) == item["reverse"], item
    assert len(mini["items"]) == 20
    assert {i["trait"] for i in mini["items"]} == set("OCEAN")
