"""Scores the Open Psychometrics IPIP-FFM dataset (50 items, ~1M respondents).

Used only to sample realistic Big Five score *rows* for synthetic users, so
the correlations between traits in real data are preserved.

Keying follows the item wording in the dataset's codebook.txt (IPIP Big-Five
Factor Markers). The "EST" items are worded as neuroticism, so they are scored
as N (higher = more neurotic), matching the Mini-IPIP used in the app.
Each trait: sum of 10 keyed items (10–50), min-max scaled to 0–1 = (sum − 10) / 40.
"""
from __future__ import annotations

import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
RAW_ZIP = ROOT / "data" / "raw" / "ipip" / "IPIP-FFM-data-8Nov2018.zip"
CACHE = ROOT / "data" / "raw" / "ipip" / "ipip_ffm_scored.npz"

# +1 = positively keyed, -1 = reverse keyed (6 - x).
KEYS = {
    "E": ("EXT", [+1, -1, +1, -1, +1, -1, +1, -1, +1, -1]),
    "N": ("EST", [+1, -1, +1, -1, +1, +1, +1, +1, +1, +1]),
    "A": ("AGR", [-1, +1, -1, +1, -1, +1, -1, +1, +1, +1]),
    "C": ("CSN", [+1, -1, +1, -1, +1, -1, +1, -1, +1, +1]),
    "O": ("OPN", [+1, -1, +1, -1, +1, -1, +1, +1, +1, +1]),
}
TRAIT_ORDER = ["O", "C", "E", "A", "N"]  # matches config/profile_vocab.json big5


def item_columns() -> list[str]:
    return [f"{prefix}{i + 1}" for prefix, _ in KEYS.values() for i in range(10)]


def score_items(items: pd.DataFrame) -> np.ndarray:
    """items: DataFrame with the 50 item columns (values 1–5). Returns (n, 5) in TRAIT_ORDER."""
    out = {}
    for trait, (prefix, keys) in KEYS.items():
        total = np.zeros(len(items), dtype=np.float64)
        for i, k in enumerate(keys):
            x = items[f"{prefix}{i + 1}"].to_numpy(dtype=np.float64)
            total += x if k > 0 else 6 - x
        out[trait] = (total - 10) / 40
    return np.column_stack([out[t] for t in TRAIT_ORDER]).astype(np.float32)


def load_scored(refresh: bool = False) -> np.ndarray:
    """Returns cleaned, scored Big Five rows (n, 5), cached as .npz."""
    if CACHE.exists() and not refresh:
        return np.load(CACHE)["big5"]
    if not RAW_ZIP.exists():
        raise FileNotFoundError(
            f"{RAW_ZIP} not found. Run `npm run import:ipip` (or download "
            "https://openpsychometrics.org/_rawdata/IPIP-FFM-data-8Nov2018.zip into ml/data/raw/ipip/)."
        )
    cols = item_columns()
    with zipfile.ZipFile(RAW_ZIP) as z:
        name = next(n for n in z.namelist() if n.endswith("data-final.csv"))
        with z.open(name) as f:
            df = pd.read_csv(f, sep="\t", usecols=cols + ["IPC"], na_values=["NULL"], dtype="float32")
    n_raw = len(df)
    # Codebook guidance: IPC == 1 for max cleanliness; 0 means an unanswered item.
    df = df[df["IPC"] == 1]
    df = df[(df[cols] >= 1).all(axis=1) & (df[cols] <= 5).all(axis=1)]
    big5 = score_items(df[cols])
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(CACHE, big5=big5, n_raw=n_raw)
    return big5


if __name__ == "__main__":
    b = load_scored(refresh=True)
    print(f"IPIP-FFM: {len(b):,} clean respondents (IPC == 1, all 50 items answered)")
    print("means", dict(zip(TRAIT_ORDER, np.round(b.mean(0), 3))))
    print("corr\n", np.round(np.corrcoef(b.T), 2))
