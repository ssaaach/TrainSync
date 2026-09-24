# Ranker evaluation

Version `ranker-20260924`, 60,000 pairs, 1,500 trainees (80/20 split by trainee). Relevance = hidden ground truth graded 0–3 within each list.

| Ranker | NDCG@10 | Precision@5 | Same archetype in top 10 |
|---|---|---|---|
| random | 0.2633 | 0.25 | 0.12 |
| distance only | 0.4283 | 0.4247 | 0.1337 |
| goals + distance | 0.5647 | 0.582 | 0.2187 |
| rule weights (default) | 0.5631 | 0.5727 | 0.2423 |
| learned weights | 0.5754 | 0.5847 | 0.229 |

## Learned weights

| Factor | Default | Learned |
|---|---|---|
| goals | 0.22 | 0.2602 |
| schedule | 0.14 | 0.1573 |
| style | 0.13 | 0.1596 |
| distance | 0.12 | 0.3074 |
| personality | 0.1 | 0.0098 |
| budget | 0.08 | 0.084 |
| level | 0.07 | 0.0217 |
| interests | 0.06 | 0.0 |
| modality | 0.04 | 0.0 |
| quality | 0.04 | 0.0 |

## Bias check (top-10 exposure ÷ share of candidates)

| Trainer gender | Ratio |
|---|---|
| male | 1.004 |
| female | 0.992 |

Flagged (outside 0.8–1.25): none.

These numbers come from the synthetic population and validate the pipeline, not real-world matching quality. Retrain on real accepted/declined requests once there are enough of them.
