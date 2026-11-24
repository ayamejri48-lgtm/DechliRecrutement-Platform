"""Explainable hybrid matching: skills + required + experience + education + semantics.

Job titles are a soft signal only. Sharing 'Engineer' must not yield a high score.

hybrid-v3.1 (AI-eng decision):
- Keep weighted MCDM + anti-false-positive caps (proven on QA).
- Skills signal = 0.7*Recall + 0.3*F1 (standard IR formulas).
- Soft skill families for FR free-text offer labels (stats / data viz).
- Weights: skills 50% / semantic 20% / experience 20% / education 10%.
"""
from __future__ import annotations

from typing import Any, Optional

from app.nlp import normalize_skills, parse_education_value
from app.schemas import (
    BatchMatchResponse,
    MatchFeatures,
    MatchResponse,
    RankedMatchItem,
    ScoreBand,
)
from app.semantic import backend_name, profile_semantic_text, similarity, skills_text

EDU = {"bachelor": 1, "master": 2, "phd": 3}

# Equivalence groups for matching only (does not invent extract skills).
_SKILL_FAMILIES: tuple[frozenset[str], ...] = (
    # Only conservative equivalences (validated on QA). Do not equate sklearn≈pytorch.
    frozenset({"data visualization", "tableau", "power bi", "matplotlib", "seaborn"}),
    frozenset({"statistics", "numpy", "scipy"}),
)

# One-way: having a REST framework on the CV covers an offer skill "REST API"
# (does NOT cover the reverse: "REST API" alone ≠ FastAPI / Spring Boot).
_IMPLIES_REST_API: frozenset[str] = frozenset(
    {
        "fastapi",
        "django",
        "flask",
        "spring boot",
        "express",
        "nestjs",
    }
)

MODEL_VERSION = "hybrid-v3.1.1"
METHOD_NAME = "hybrid-baseline-v3.1.1"


def _family(skill: str) -> frozenset[str]:
    for group in _SKILL_FAMILIES:
        if skill in group:
            return group
    return frozenset({skill})


def _skill_covers(candidate_skills: set[str], offer_skill: str) -> bool:
    if bool(candidate_skills & _family(offer_skill)):
        return True
    if offer_skill == "rest api" and bool(candidate_skills & _IMPLIES_REST_API):
        return True
    return False


def education_match_score(candidate: dict, offer: dict) -> Optional[float]:
    """1.0 completed at/above required, 0.5 in_progress, 0.0 below, null unknown/missing."""
    ce, cs = parse_education_value(
        candidate.get("education"),
        candidate.get("educationStatus"),
    )
    oe, _ = parse_education_value(
        offer.get("education"),
        offer.get("educationStatus"),
    )
    if ce is None or oe is None:
        return None
    if EDU[ce] < EDU[oe]:
        return 0.0
    # Level meets or exceeds requirement
    if cs == "in_progress":
        return 0.5
    if cs == "unknown":
        return None
    # completed, or legacy plain level without status → treat as obtained
    return 1.0

NUMERIC_FEATURES = [
    "skills_coverage",
    "skills_f1",
    "skills_score",
    "required_skills_coverage",
    "experience_match",
    "education_match",
    "semantic_similarity",
    "critical_skills_missing",
]


def score_band(score: Optional[float]) -> ScoreBand:
    if score is None:
        return "unavailable"
    if score < 0.4:
        return "low"
    if score < 0.7:
        return "medium"
    return "high"


def features(candidate: dict, offer: dict) -> dict[str, Any]:
    cs = set(normalize_skills(list(candidate.get("skills") or [])))
    rs = set(normalize_skills(list(offer.get("skills") or [])))
    must = set(normalize_skills(list(offer.get("requiredSkills") or [])))

    # Soft family matching: offer skill covered if candidate has equivalent tool/label.
    matched = sorted(s for s in rs if _skill_covers(cs, s))
    matched_set = set(matched)
    missing = sorted(rs - matched_set)
    critical_missing = sorted(s for s in must if not _skill_covers(cs, s))

    coverage = len(matched_set) / len(rs) if rs else None  # Recall vs offer skills
    # Precision: share of candidate skills whose family hits at least one offer skill.
    if cs and rs:
        useful = sum(
            1
            for s in cs
            if bool(_family(s) & rs) or any(s in _family(o) for o in rs)
        )
        precision = useful / len(cs)
    else:
        precision = None

    f1: Optional[float] = None
    if coverage is not None and precision is not None:
        if coverage + precision > 0:
            f1 = 2.0 * coverage * precision / (coverage + precision)
        else:
            f1 = 0.0

    # Standard blend: emphasize meeting the offer (recall) while F1 limits CV spam.
    skills_score: Optional[float] = None
    if coverage is not None:
        skills_score = 0.7 * coverage + 0.3 * (f1 if f1 is not None else coverage)

    required_coverage = (
        (len(must) - len(critical_missing)) / len(must) if must else None
    )

    cy = candidate.get("experienceYears")
    oy = offer.get("experienceYears")
    exp: Optional[float]
    if cy is None or oy is None:
        exp = None
    elif oy <= 0:
        exp = None
    else:
        exp = min(1.0, float(cy) / float(oy))

    edu = education_match_score(candidate, offer)

    cand_sem = profile_semantic_text({**candidate, "title": None}, include_title=False)
    offer_sem = profile_semantic_text({**offer, "title": None}, include_title=False)
    if skills_text(list(cs)) and skills_text(list(rs)):
        sem = similarity(skills_text(list(cs)), skills_text(list(rs)))
    else:
        sem = similarity(cand_sem, offer_sem) if cand_sem and offer_sem else None

    title_sim = None
    if candidate.get("title") and offer.get("title"):
        title_sim = similarity(str(candidate["title"]), str(offer["title"]))

    return {
        "skills_coverage": coverage,
        "skills_precision": precision,
        "skills_f1": f1,
        "skills_score": skills_score,
        "required_skills_coverage": required_coverage,
        "experience_match": exp,
        "education_match": edu,
        "semantic_similarity": sem,
        "title_similarity": title_sim,
        "critical_skills_missing": len(critical_missing),
        "matchedSkills": matched,
        "missingSkills": missing,
        "missingRequiredSkills": critical_missing,
    }


def _pct(v: float) -> str:
    return f"{int(round(float(v) * 100))} %"


def _explanations(f: dict[str, Any], score: Optional[float], band: ScoreBand) -> list[str]:
    """Recruiter-facing notes (plain French). Avoid raw eng jargon in the UI."""
    notes: list[str] = []
    band_fr = {
        "low": "faible",
        "medium": "moyen",
        "high": "élevé",
        "unavailable": "indisponible",
    }.get(band, band)
    if band != "unavailable":
        notes.append(f"Niveau d’adéquation : {band_fr}.")
    if f.get("matchedSkills"):
        notes.append(
            "Points forts communs : " + ", ".join(f["matchedSkills"][:12]) + "."
        )
    if f.get("missingRequiredSkills"):
        notes.append(
            "Compétences obligatoires manquantes : "
            + ", ".join(f["missingRequiredSkills"][:12])
            + "."
        )
    elif f.get("missingSkills"):
        notes.append(
            "Compétences de l’offre encore absentes du profil : "
            + ", ".join(f["missingSkills"][:12])
            + "."
        )
    if f.get("experience_match") is not None:
        notes.append(
            f"Expérience par rapport à l’offre : {_pct(f['experience_match'])}."
        )
    if f.get("education_match") is not None:
        em = f["education_match"]
        if em >= 1:
            label = "formation suffisante (diplôme obtenu)"
        elif em >= 0.5:
            label = "formation partielle (diplôme en cours)"
        else:
            label = "formation insuffisante pour l’offre"
        notes.append(f"Formation : {label}.")
    if f.get("semantic_similarity") is not None:
        # Plain language — no backend id (tfidf/st) in recruiter UI.
        notes.append(
            "Proximité globale du profil et de l’offre : "
            f"{_pct(f['semantic_similarity'])} "
            "(ressemblance des compétences / contenu, complément au matching skills)."
        )
    if f.get("title_similarity") is not None:
        notes.append(
            "Proximité des intitulés de poste : "
            f"{_pct(f['title_similarity'])} (indicateur secondaire uniquement)."
        )
    if score is None:
        notes.append(
            "Score indisponible : ajoutez des compétences structurées sur l’offre."
        )
    return notes


def baseline(candidate: dict, offer: dict, **meta: Any) -> dict:
    return hybrid(candidate, offer, **meta)


def _offer_has_structured_skills(offer: dict) -> bool:
    return bool(normalize_skills(list(offer.get("skills") or [])))


def hybrid(
    candidate: dict,
    offer: dict,
    *,
    candidatureId: Optional[str] = None,
    cvId: Optional[str] = None,
) -> dict:
    f = features(candidate, offer)

    # Guard: empty offer.skills must not produce a renormalized high score.
    if not _offer_has_structured_skills(offer):
        band: ScoreBand = "unavailable"
        notes = [
            "Matching indisponible: aucune compétence structurée sur l'offre.",
            "Ajoutez au moins une compétence (offre_skills) avant de calculer un score.",
        ]
        notes.extend(_explanations(f, None, band))
        response = MatchResponse(
            score=None,
            scoreBand=band,
            features=MatchFeatures(**{k: f[k] for k in MatchFeatures.model_fields}),
            explanations=notes,
            method=METHOD_NAME,
            modelVersion=MODEL_VERSION,
            warning=(
                "BASELINE hybrid-v3.1 — score unavailable (no structured offer skills). "
                "Not a human annotation and not a supervised ML prediction. "
                "Bands: low<0.4, medium<0.7, high>=0.7."
            ),
            candidatureId=candidatureId,
            cvId=cvId,
        )
        return response.model_dump()

    # MCDM weighted sum — skills use Recall+F1 blend (skills_score).
    weighted = [
        (f["skills_score"] if f.get("skills_score") is not None else f["skills_coverage"], 0.50),
        (f["semantic_similarity"], 0.20),
        (f["experience_match"], 0.20),
        (f["education_match"], 0.10),
    ]
    available = [(v, w) for v, w in weighted if v is not None]
    score = (
        sum(v * w for v, w in available) / sum(w for _, w in available)
        if available
        else None
    )

    if score is not None and offer.get("requiredSkills"):
        req = f["required_skills_coverage"]
        if req is None:
            req = 1.0
        score *= 0.35 + 0.65 * req

    if (
        score is not None
        and f.get("title_similarity") is not None
        and f["title_similarity"] >= 0.7
        and (f.get("skills_coverage") is None or f["skills_coverage"] < 0.25)
        and (f.get("semantic_similarity") is None or f["semantic_similarity"] < 0.45)
    ):
        score = min(score, 0.35)

    # Hard gate: missing required skills cannot be "high".
    if score is not None and f["critical_skills_missing"] > 0:
        score = min(score, 0.69)

    # Skills are the primary signal: block medium/high when coverage is absent/very low
    # (prevents TF-IDF/title inflation from looking like a strong match).
    cov = f.get("skills_coverage")
    if score is not None and cov is not None:
        if cov <= 0.0:
            score = min(score, 0.35)
        elif cov < 0.2:
            score = min(score, 0.45)

    if score is not None:
        score = float(max(0.0, min(1.0, score)))

    rounded = round(score, 4) if score is not None else None
    band = score_band(rounded)
    response = MatchResponse(
        score=rounded,
        scoreBand=band,
        features=MatchFeatures(**{k: f[k] for k in MatchFeatures.model_fields}),
        explanations=_explanations(f, rounded, band),
        method=METHOD_NAME,
        modelVersion=MODEL_VERSION,
        warning=(
            "BASELINE heuristic score (hybrid-v3.1) — skills=0.7*Recall+0.3*F1, "
            "weights 50/20/20/10. Not a human annotation and not supervised ML. "
            "Decision-support only, not a hiring probability. "
            "Bands: low<0.4, medium<0.7, high>=0.7."
        ),
        candidatureId=candidatureId,
        cvId=cvId,
    )
    return response.model_dump()


def _is_rankable(result: MatchResponse) -> bool:
    if result.score is None:
        return False
    if result.scoreBand == "unavailable":
        return False
    # Historical / empty-offer path: skills_coverage null ⇒ exclude from ranking
    if result.features.skills_coverage is None:
        return False
    return True


def rank_candidates(offer: dict, candidates: list[dict]) -> dict:
    """Rank up to N candidate profiles against one offer (stable sort)."""
    scored: list[MatchResponse] = []
    for item in candidates:
        cand = item.get("candidate") if isinstance(item.get("candidate"), dict) else item
        result = hybrid(
            cand,
            offer,
            candidatureId=item.get("candidatureId"),
            cvId=item.get("cvId"),
        )
        scored.append(MatchResponse(**result))

    rankable = [r for r in scored if _is_rankable(r)]
    excluded = [r for r in scored if not _is_rankable(r)]

    def sort_key(r: MatchResponse):
        return (
            r.score if r.score is not None else -1.0,
            -(r.features.critical_skills_missing or 0),
        )

    ordered = sorted(rankable, key=sort_key, reverse=True)
    ranked = [
        RankedMatchItem(rank=i + 1, result=r) for i, r in enumerate(ordered)
    ]
    # Keep unavailable / non-rankable in the payload without a competitive rank.
    ranked.extend(RankedMatchItem(rank=None, result=r) for r in excluded)

    return BatchMatchResponse(
        offerSkills=normalize_skills(list(offer.get("skills") or [])),
        results=ranked,
        method="hybrid-batch-v3.1",
        modelVersion=MODEL_VERSION,
        warning=(
            "Batch ranking is relative among the provided candidates only; "
            "not a global talent-pool ranking. "
            "Results without structured offer skills are excluded from rank positions."
        ),
    ).model_dump()
