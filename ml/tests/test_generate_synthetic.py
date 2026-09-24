"""Synthetic generator: determinism, planted structure, domains and constraints."""
import math
from collections import Counter

import numpy as np
import pytest

import generate_synthetic as gs


@pytest.fixture(scope="module")
def people():
    g = gs.Gen(seed=7)
    return [g.trainee(i) for i in range(800)], [g.trainer(i) for i in range(300)]


def test_deterministic_for_a_seed():
    a, b = gs.Gen(seed=11), gs.Gen(seed=11)
    assert [a.trainee(i) for i in range(20)] == [b.trainee(i) for i in range(20)]


def test_emails_unique_and_on_reserved_domain(people):
    trainees, trainers = people
    emails = [p["email"] for p in trainees + trainers]
    assert len(set(emails)) == len(emails)
    assert all(e.endswith("@" + gs.CFG["email_domain"]) for e in emails)


def test_noise_rate_close_to_config(people):
    trainees, _ = people
    rate = np.mean([len(p["noised_blocks"]) / len(gs.BLOCKS) for p in trainees])
    lo, hi = gs.CFG["noise_rate"]
    assert lo - 0.04 <= rate <= hi + 0.04


def test_archetype_shares_roughly_match(people):
    trainees, _ = people
    share = Counter(p["archetype"] for p in trainees)
    for name, spec in gs.CFG["archetypes"].items():
        assert abs(share[name] / len(trainees) - spec["share"]["trainee"]) < 0.05, name


def test_planted_signal_goals_follow_archetype(people):
    """Un-noised yoga archetype members should almost always list mobility-yoga."""
    trainees, _ = people
    yoga = [p for p in trainees if p["archetype"] == "yoga_mobility_supportive" and "goals" not in p["noised_blocks"]]
    assert yoga and np.mean(["mobility-yoga" in p["goals"] for p in yoga]) > 0.85


def test_values_in_domain(people):
    trainees, trainers = people
    v = gs.VOCAB
    for p in trainees:
        assert 18 <= p["age"] <= 55
        assert set(p["goals"]) <= set(v["goals"]) and p["goals"]
        assert set(p["modality"]) <= set(v["modalities"]) and p["modality"]
        assert p["goal"] in v["bodyGoals"] and p["diet_pref"] in v["dietPrefs"]
        assert all(1 <= s <= 5 for s in p["style_pref"].values())
        assert all(0 <= b <= 1 for b in p["big5"].values())
        assert p["schedule"] and set(p["schedule"]) <= set(v["days"])
        s, w, n, e = gs.CITIES[p["city_key"]]["bbox"]
        assert s <= p["lat"] <= n and w <= p["lng"] <= e
    for t in trainers:
        assert 300 <= t["price_per_session_inr"] <= 2500
        assert 8 <= t["max_clients"] <= 25 and 0 <= t["active_clients"] <= t["max_clients"]
        assert t["rating_avg"] is None or 1 <= t["rating_avg"] <= 5
        assert t["bio"].startswith("[Synthetic demo profile]")


def test_navy_formula_domain_is_respected(people):
    trainees, _ = people
    for p in trainees:
        if p["sex"] == "male":
            assert p["waist_cm"] - p["neck_cm"] >= gs.CFG["body"]["male"]["navy_floor"] - 0.11
        else:
            assert p["waist_cm"] + p["hip_cm"] - p["neck_cm"] >= gs.CFG["body"]["female"]["navy_floor"] - 0.21


def test_big5_rows_come_from_real_ipip_rows():
    g = gs.Gen(seed=3)
    row = g.big5_row({"C": 1.0})
    arr = np.array([row[t] for t in gs.TRAIT_ORDER], dtype=np.float32)
    assert np.isclose(g.big5, arr, atol=1e-4).all(axis=1).any()


def test_latent_chemistry_is_unit_vector(people):
    trainees, _ = people
    for p in trainees[:50]:
        assert math.isclose(sum(x * x for x in p["latent"]["chemistry"]), 1.0, abs_tol=1e-3)
