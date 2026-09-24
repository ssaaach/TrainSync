"""Generates the synthetic TrainSync population (all rows are is_synthetic=1).

    python ml/generate_synthetic.py [--trainees N] [--trainers N] [--seed S]

Writes ml/data/synthetic/{trainees,trainers}.jsonl and meta.json; the Node
loader (scripts/seed/synthetic.js) inserts them and computes body type with the
app's own calculator (services/bodyComposition.js).

Planted structure: each person is drawn from one archetype (ml/config.yaml).
Every attribute block is independently replaced, with probability
noise_rate ~ U(0.25, 0.35), by the same block drawn from a different random
archetype. The archetype, the noised blocks and hidden "latent" traits
(not exposed to the app or the scoring formula) are stored for Phase 5
evaluation only.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import unicodedata
from pathlib import Path

import numpy as np
import yaml
from faker import Faker

from ipip import TRAIT_ORDER, load_scored

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
OUT_DIR = ROOT / "data" / "synthetic"

CFG = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))["synthetic"]
CITIES = json.loads((REPO / "config" / "cities.json").read_text(encoding="utf-8"))["cities"]
VOCAB = json.loads((REPO / "config" / "profile_vocab.json").read_text(encoding="utf-8"))

BLOCKS = ["goals", "style", "modality", "schedule", "budget", "experience", "big5"]
SLOTS = ["weekday_morning", "weekday_afternoon", "weekday_evening",
         "weekend_morning", "weekend_afternoon", "weekend_evening"]
WEEKDAYS, WEEKEND = VOCAB["days"][:5], VOCAB["days"][5:]
GYM_EQUIPMENT = ["body only", "dumbbell", "barbell", "kettlebells", "cable", "machine", "e-z curl bar", "medicine ball", "exercise ball"]
HOME_EQUIPMENT_OPTIONAL = ["dumbbell", "bands", "kettlebells", "exercise ball", "foam roll"]


class Gen:
    def __init__(self, seed: int):
        self.rng = np.random.default_rng(seed)
        self.fake = Faker("en_IN")
        self.fake.seed_instance(seed)
        self.big5 = load_scored()
        self.big5_z = (self.big5 - self.big5.mean(0)) / self.big5.std(0)
        self.archetypes = CFG["archetypes"]
        self.arch_names = list(self.archetypes)
        self.localities = self._load_localities()
        self.used_emails: set[str] = set()

    # ------------------------------------------------------------ helpers
    def choice(self, weights: dict):
        keys = list(weights)
        p = np.array([weights[k] for k in keys], dtype=float)
        return keys[self.rng.choice(len(keys), p=p / p.sum())]

    def bernoullis(self, probs: dict, vocab: list[str], at_least_one=True) -> list[str]:
        picked = [k for k in vocab if self.rng.random() < probs.get(k, 0.0)]
        if not picked and at_least_one:
            picked = [self.choice({k: v for k, v in probs.items() if v > 0})]
        return picked

    def style(self, spec: dict) -> dict:
        return {axis: int(np.clip(round(self.rng.normal(*spec[axis])), 1, 5)) for axis in VOCAB["styleAxes"]}

    def lognormal(self, median: float, sigma: float) -> float:
        return float(median * math.exp(self.rng.normal(0, sigma)))

    def _load_localities(self):
        by_city: dict[str, list] = {}
        with open(REPO / "db" / "seeds" / "localities.csv", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                key = next(k for k, c in CITIES.items() if c["name"] == row["city"])
                by_city.setdefault(key, []).append((row["name"], float(row["lat"]), float(row["lng"])))
        return by_city

    def block_source(self, arch: str, noise_rate: float) -> tuple[dict, list[str]]:
        """For each block, the archetype it is drawn from (own, or a random other one when noised)."""
        src, noised = {}, []
        for b in BLOCKS:
            if self.rng.random() < noise_rate:
                others = [a for a in self.arch_names if a != arch]
                src[b] = others[self.rng.integers(len(others))]
                noised.append(b)
            else:
                src[b] = arch
        return src, noised

    def big5_row(self, tilt: dict) -> dict:
        """Importance-samples one real IPIP-FFM row toward the archetype's trait tilt."""
        idx = self.rng.integers(len(self.big5), size=CFG["big5"]["candidates"])
        direction = np.array([tilt.get(t, 0.0) for t in TRAIT_ORDER])
        logits = CFG["big5"]["beta"] * (self.big5_z[idx] @ direction)
        p = np.exp(logits - logits.max())
        row = self.big5[idx[self.rng.choice(len(idx), p=p / p.sum())]]
        return {t: round(float(v), 4) for t, v in zip(TRAIT_ORDER, row, strict=True)}

    def schedule(self, probs: dict) -> dict:
        """7 days × dayparts from the 6 weekday/weekend slot probabilities."""
        sched = {}
        for day in VOCAB["days"]:
            kind = "weekday" if day in WEEKDAYS else "weekend"
            parts = [p for p in VOCAB["dayparts"] if self.rng.random() < probs[f"{kind}_{p}"]]
            if parts:
                sched[day] = parts
        if not sched:
            best = max(probs, key=probs.get)
            kind, part = best.split("_")
            sched = {d: [part] for d in (WEEKDAYS if kind == "weekday" else WEEKEND)}
        return sched

    def location(self):
        city_key = self.choice({k: c["weight"] for k, c in CITIES.items()})
        name, lat0, lng0 = self.localities[city_key][self.rng.integers(len(self.localities[city_key]))]
        sigma = CFG["locality_jitter_km"]
        lat = lat0 + self.rng.normal(0, sigma) / 110.574
        lng = lng0 + self.rng.normal(0, sigma) / (111.320 * math.cos(math.radians(lat0)))
        s, w, n, e = CITIES[city_key]["bbox"]
        return city_key, name, round(float(np.clip(lat, s, n)), 6), round(float(np.clip(lng, w, e)), 6)

    def languages(self, city_key: str) -> list[str]:
        city_langs = CITIES[city_key]["languages"]
        regional = [lang for lang in city_langs if lang not in ("English", "Hindi")]
        langs = [lang for lang, p in (("English", 0.85), ("Hindi", 0.7)) if self.rng.random() < p]
        if regional and self.rng.random() < 0.6:
            langs.append(regional[0])
        for extra in regional[1:]:
            if self.rng.random() < 0.1:
                langs.append(extra)
        return langs or ["English"]

    def name_email(self, sex: str) -> tuple[str, str]:
        first = self.fake.first_name_male() if sex == "male" else self.fake.first_name_female()
        last = self.fake.last_name()
        base = slug(f"{first}.{last}")
        email = f"{base}@{CFG['email_domain']}"
        n = 1
        while email in self.used_emails:
            n += 1
            email = f"{base}.{n}@{CFG['email_domain']}"
        self.used_emails.add(email)
        return f"{first} {last}", email

    def latent(self) -> dict:
        """Hidden traits used only for ground-truth compatibility in Phase 5."""
        v = self.rng.normal(size=3)
        return {
            "chemistry": [round(float(x), 4) for x in v / np.linalg.norm(v)],
            "motivation": round(float(self.rng.beta(4, 3)), 4),
            "patience": round(float(self.rng.beta(3, 3)), 4),
        }

    # ------------------------------------------------------------ people
    def body(self, sex: str, bmi_shift: float) -> dict:
        b = CFG["body"][sex]
        h = float(self.rng.normal(*b["height_cm"]))
        bmi = float(np.clip(b["bmi_median"] * math.exp(self.rng.normal(0, b["bmi_log_sd"])) + bmi_shift, *CFG["body"]["bmi_clip"]))
        w = bmi * (h / 100) ** 2
        lin = lambda spec: spec[0] + spec[1] * bmi + self.rng.normal(0, spec[2])  # noqa: E731
        waist, neck, hip = lin(b["waist"]), lin(b["neck"]), lin(b["hip"])
        # Keep the Navy formula in a physiological range (see navy_floor in config.yaml).
        if sex == "male":
            waist = max(waist, neck + b["navy_floor"])
        else:
            waist = max(waist, b["navy_floor"] + neck - hip)
        wrist = float(self.rng.normal(*b["wrist"])) * (h / b["height_cm"][0])
        return {"height_cm": round(h, 1), "weight_kg": round(w, 1), "waist_cm": round(waist, 1),
                "neck_cm": round(neck, 1), "hip_cm": round(hip, 1), "wrist_cm": round(wrist, 1)}

    def equipment(self, modality: list[str]) -> list[str]:
        eq = {"body only"}
        if "in_person_gym" in modality:
            eq.update(GYM_EQUIPMENT)
        if "home" in modality or "online" in modality:
            eq.update(e for e in HOME_EQUIPMENT_OPTIONAL if self.rng.random() < 0.35)
        return sorted(eq)

    def trainee(self, i: int) -> dict:
        arch = self.choice({a: v["share"]["trainee"] for a, v in self.archetypes.items()})
        noise_rate = float(self.rng.uniform(*CFG["noise_rate"]))
        src, noised = self.block_source(arch, noise_rate)
        spec = lambda block: self.archetypes[src[block]]["trainee"]  # noqa: E731
        own = self.archetypes[arch]["trainee"]

        sex = "female" if self.rng.random() < own["female_share"] else "male"
        name, email = self.name_email(sex)
        city_key, locality, lat, lng = self.location()
        modality = self.bernoullis(spec("modality")["modality"], VOCAB["modalities"])
        goals = self.bernoullis(spec("goals")["goals"], VOCAB["goals"])
        pref = CFG["trainer_gender_pref"]
        gender_pref = None
        if sex == "female" and self.rng.random() < pref["female_prefers_female"]:
            gender_pref = "female"
        elif sex == "male" and self.rng.random() < pref["male_prefers_male"]:
            gender_pref = "male"
        allergens = [a for a, p in CFG["allergen_rates"].items() if self.rng.random() < p]

        return {
            "kind": "trainee", "ext_id": f"trainee-{i:05d}", "archetype": arch, "noised_blocks": noised,
            "name": name, "email": email, "sex": sex, "gender": sex,
            "age": int(self.rng.integers(own["age"][0], own["age"][1] + 1)),
            "city_key": city_key, "city": CITIES[city_key]["name"], "locality": locality, "lat": lat, "lng": lng,
            **self.body(sex, own["bmi_shift"]),
            "activity_level": self.choice(own["activity"]),
            "experience_level": self.choice(spec("experience")["experience"]),
            "goal": self.choice(spec("goals")["body_goal"]),
            "goals": goals,
            "days_per_week": int(self.rng.integers(own["days_per_week"][0], own["days_per_week"][1] + 1)),
            "session_minutes": int(self.rng.choice([m for m in (30, 45, 60, 75, 90) if own["session_minutes"][0] <= m <= own["session_minutes"][1]])),
            "equipment": self.equipment(modality),
            "diet_pref": self.choice(CFG["diet_pref"]),
            "allergens": allergens,
            "budget_per_session_inr": int(round(self.lognormal(*spec("budget")["budget_inr"]) * CITIES[city_key]["priceMultiplier"], -1)),
            "search_radius_km": round(float(self.rng.uniform(*CFG["search_radius_km"])), 1),
            "modality": modality,
            "languages": self.languages(city_key),
            "trainer_gender_pref": gender_pref,
            "big5": self.big5_row(self.archetypes[src["big5"]]["trainee"]["big5_tilt"]),
            "style_pref": self.style(spec("style")["style"]),
            "schedule": self.schedule(spec("schedule")["schedule"]),
            "latent": self.latent(),
        }

    def trainer(self, i: int) -> dict:
        arch = self.choice({a: v["share"]["trainer"] for a, v in self.archetypes.items()})
        noise_rate = float(self.rng.uniform(*CFG["noise_rate"]))
        src, noised = self.block_source(arch, noise_rate)
        spec = lambda block: self.archetypes[src[block]]["trainer"]  # noqa: E731
        own = self.archetypes[arch]["trainer"]
        t = CFG["trainer"]

        gender = "female" if self.rng.random() < own["female_share"] else "male"
        name, email = self.name_email(gender)
        city_key, locality, lat, lng = self.location()
        years = int(self.rng.integers(own["years"][0], own["years"][1] + 1))
        specs = self.bernoullis(spec("goals")["specializations"], VOCAB["goals"])
        n_certs = int(self.rng.integers(1, min(3, len(own["certs"])) + 1))
        certs = sorted(self.rng.choice(own["certs"], size=n_certs, replace=False).tolist())
        price = self.lognormal(*spec("budget")["price_inr"]) * CITIES[city_key]["priceMultiplier"] * (1 + 0.03 * years)
        max_clients = int(self.rng.integers(t["max_clients"][0], t["max_clients"][1] + 1))
        a, b = t["rating_beta"]
        rating_count = int(self.rng.poisson(t["rating_count_lambda"]))
        modality = self.bernoullis(spec("modality")["modality"], VOCAB["modalities"])
        first = name.split()[0]

        return {
            "kind": "trainer", "ext_id": f"trainer-{i:05d}", "archetype": arch, "noised_blocks": noised,
            "name": name, "email": email, "gender": gender,
            "city_key": city_key, "city": CITIES[city_key]["name"], "locality": locality, "lat": lat, "lng": lng,
            "years_experience": years,
            "experience": years,
            "certifications": certs,
            "certification": certs[0],
            "specializations": specs,
            "specialization": ", ".join(specs),
            "best_level": self.choice(spec("experience")["best_level"]),
            "price_per_session_inr": int(round(float(np.clip(price, *t["price_inr_clip"])), -1)),
            "max_clients": max_clients,
            "active_clients": int(self.rng.binomial(max_clients, self.rng.uniform(0.2, 0.85))),
            "rating_avg": round(float(1 + 4 * self.rng.beta(a, b)), 2) if rating_count else None,
            "rating_count": rating_count,
            "bio": f"[Synthetic demo profile] {first} has coached for {years} years ({', '.join(certs)}) "
                   f"and specialises in {', '.join(s.replace('-', ' ') for s in specs)}.",
            "travel_radius_km": round(float(self.rng.uniform(*CFG["travel_radius_km"])), 1),
            "modality": modality,
            "languages": self.languages(city_key),
            "big5": self.big5_row(self.archetypes[src["big5"]]["trainer"]["big5_tilt"]),
            "coaching_style": self.style(spec("style")["style"]),
            "schedule": self.schedule(spec("schedule")["schedule"]),
            "latent": self.latent(),
        }


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9.]+", "", s.lower().replace(" ", "."))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trainees", type=int, default=CFG["n_trainees"])
    ap.add_argument("--trainers", type=int, default=CFG["n_trainers"])
    ap.add_argument("--seed", type=int, default=CFG["seed"])
    args = ap.parse_args()

    gen = Gen(args.seed)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    counts = {}
    for kind, n, make in (("trainees", args.trainees, gen.trainee), ("trainers", args.trainers, gen.trainer)):
        with open(OUT_DIR / f"{kind}.jsonl", "w", encoding="utf-8") as f:
            for i in range(n):
                f.write(json.dumps(make(i), ensure_ascii=False) + "\n")
        counts[kind] = n
    meta = {"generator_version": CFG["generator_version"], "seed": args.seed, "counts": counts,
            "ipip_rows_available": int(len(gen.big5))}
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Generated {counts['trainees']:,} trainees and {counts['trainers']:,} trainers "
          f"(seed {args.seed}) -> {OUT_DIR.relative_to(REPO)}")


if __name__ == "__main__":
    main()
