"""Learns the matching weights and evaluates the ranker.

Input:  ml/data/synthetic/pairs.csv (scripts/ml/export-pairs.js): the app's own
        factor scores per trainee x trainer pair plus a HIDDEN ground truth
        built from the synthetic generator's latent state.
Model:  non-negative linear ranker over the factors, fitted by pairwise
        logistic regression (RankNet-style) within each trainee's candidate
        list, so the weights stay explainable and drop straight into
        services/matching.js. Missing factors are treated as neutral (0.5).
Output: ml/artifacts/ranker.json (weights, version, metrics)
        ml/reports/ranker_eval.md (NDCG@10 vs baselines, bias check)

Metrics are on synthetic data: they validate the pipeline, not real-world
matching quality.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parent
PAIRS = ROOT / "data" / "synthetic" / "pairs.csv"
ARTIFACT = ROOT / "artifacts" / "ranker.json"
REPORT = ROOT / "reports" / "ranker_eval.md"
FACTORS = ["goals", "schedule", "style", "distance", "personality", "budget", "level", "interests", "modality", "quality"]
DEFAULT = {"goals": 0.22, "schedule": 0.14, "style": 0.13, "distance": 0.12, "personality": 0.1, "budget": 0.08,
           "level": 0.07, "interests": 0.06, "modality": 0.04, "quality": 0.04}
SEED = 7


def ndcg_at_k(rel: np.ndarray, scores: np.ndarray, k: int = 10) -> float:
    order = np.argsort(-scores)[:k]
    ideal = np.sort(rel)[::-1][:k]
    disc = 1 / np.log2(np.arange(2, k + 2))
    dcg = float(((2 ** rel[order] - 1) * disc[: len(order)]).sum())
    idcg = float(((2 ** ideal - 1) * disc[: len(ideal)]).sum())
    return dcg / idcg if idcg > 0 else 0.0


def graded(gt: np.ndarray) -> np.ndarray:
    """Within-list relevance grades 0-3 from ground-truth quantiles."""
    q = np.quantile(gt, [0.5, 0.75, 0.9])
    return np.digitize(gt, q).astype(float)


def pairwise(df: pd.DataFrame, rng: np.random.Generator, per_list: int = 60):
    xs, ys = [], []
    for _, g in df.groupby("qid"):
        X = g[FACTORS].to_numpy()
        y = g["gt"].to_numpy()
        n = len(g)
        i = rng.integers(0, n, per_list)
        j = rng.integers(0, n, per_list)
        keep = np.abs(y[i] - y[j]) > 0.15
        i, j = i[keep], j[keep]
        xs.append(X[i] - X[j])
        ys.append((y[i] > y[j]).astype(int))
    return np.vstack(xs), np.concatenate(ys)


def evaluate(df: pd.DataFrame, score_fn) -> dict:
    ndcg, p5, top_same = [], [], []
    for _, g in df.groupby("qid"):
        rel = graded(g["gt"].to_numpy())
        s = score_fn(g)
        ndcg.append(ndcg_at_k(rel, s))
        top5 = np.argsort(-s)[:5]
        p5.append(float((rel[top5] >= 2).mean()))
        top_same.append(float(g["same_arch"].to_numpy()[np.argsort(-s)[:10]].mean()))
    return {"ndcg@10": round(float(np.mean(ndcg)), 4), "precision@5": round(float(np.mean(p5)), 4),
            "same_archetype@10": round(float(np.mean(top_same)), 4)}


def main() -> None:
    df = pd.read_csv(PAIRS)
    df[FACTORS] = df[FACTORS].fillna(0.5)
    rng = np.random.default_rng(SEED)
    qids = df["qid"].unique()
    rng.shuffle(qids)
    cut = int(len(qids) * 0.8)
    train, test = df[df.qid.isin(qids[:cut])], df[df.qid.isin(qids[cut:])]

    X, y = pairwise(train, rng)
    clf = LogisticRegression(fit_intercept=False, C=1.0, max_iter=2000).fit(X, y)
    w = np.clip(clf.coef_[0], 0, None)
    w = w / w.sum()
    learned = {f: round(float(v), 4) for f, v in zip(FACTORS, w, strict=True)}

    def linear(weights):
        vec = np.array([weights[f] for f in FACTORS])
        return lambda g: g[FACTORS].to_numpy() @ vec

    results = {
        "random": evaluate(test, lambda g: rng.random(len(g))),
        "distance only": evaluate(test, lambda g: g["distance"].to_numpy()),
        "goals + distance": evaluate(test, lambda g: g["goals"].to_numpy() + g["distance"].to_numpy()),
        "rule weights (default)": evaluate(test, linear(DEFAULT)),
        "learned weights": evaluate(test, linear(learned)),
    }

    # Bias check: share of top-10 slots going to each trainer gender vs. its share of candidates.
    exp, pool = {}, {}
    vec = np.array([learned[f] for f in FACTORS])
    for _, g in test.groupby("qid"):
        top = g.iloc[np.argsort(-(g[FACTORS].to_numpy() @ vec))[:10]]
        for gen, n in top["gender"].fillna("unknown").value_counts().items():
            exp[gen] = exp.get(gen, 0) + n
        for gen, n in g["gender"].fillna("unknown").value_counts().items():
            pool[gen] = pool.get(gen, 0) + n
    te, tp = sum(exp.values()), sum(pool.values())
    bias = {gen: round((exp.get(gen, 0) / te) / (pool[gen] / tp), 3) for gen in pool}

    version = f"ranker-{datetime.now(UTC).strftime('%Y%m%d')}"
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT.write_text(json.dumps({
        "version": version, "trainedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "model": "non-negative linear ranker, pairwise logistic regression",
        "features": FACTORS, "weights": learned,
        "metrics": results["learned weights"], "baselines": results, "exposureRatioByGender": bias,
        "data": {"pairs": int(len(df)), "trainees": int(df.qid.nunique()), "note": "synthetic population; hidden ground truth"},
    }, indent=2) + "\n", encoding="utf-8")

    lines = ["# Ranker evaluation", "", f"Version `{version}`, {len(df):,} pairs, {df.qid.nunique():,} trainees "
             f"(80/20 split by trainee). Relevance = hidden ground truth graded 0–3 within each list.", "",
             "| Ranker | NDCG@10 | Precision@5 | Same archetype in top 10 |", "|---|---|---|---|"]
    for name, m in results.items():
        lines.append(f"| {name} | {m['ndcg@10']} | {m['precision@5']} | {m['same_archetype@10']} |")
    lines += ["", "## Learned weights", "", "| Factor | Default | Learned |", "|---|---|---|"]
    lines += [f"| {f} | {DEFAULT[f]} | {learned[f]} |" for f in FACTORS]
    lines += ["", "## Bias check (top-10 exposure ÷ share of candidates)", "",
              "| Trainer gender | Ratio |", "|---|---|"] + [f"| {g} | {r} |" for g, r in bias.items()]
    flagged = [g for g, r in bias.items() if g != "unknown" and not 0.8 <= r <= 1.25]
    lines += ["", "Flagged (outside 0.8–1.25): " + (", ".join(flagged) if flagged else "none") + ".", "",
              "These numbers come from the synthetic population and validate the pipeline, not real-world matching quality. "
              "Retrain on real accepted/declined requests once there are enough of them."]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"weights": learned, **{k: v["ndcg@10"] for k, v in results.items()}, "bias": bias}, indent=1))


if __name__ == "__main__":
    main()
