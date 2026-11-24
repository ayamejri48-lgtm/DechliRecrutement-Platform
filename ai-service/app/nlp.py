"""Deterministic NLP extraction with curated lexicon and evidence spans.

Unknown skills outside the lexicon are not invented.
"""
from __future__ import annotations

import re
from typing import Optional

from app.schemas import ExtractionEvidence, ExtractResponse
from app.skills_lexicon import ALIASES, AMBIGUOUS_ALIASES

_SPECIALTY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("data science", re.compile(r"\bdata\s+scien(?:ce|tist)\b", re.I)),
    ("machine learning engineering", re.compile(r"\b(?:ml|machine learning)\s+engineer\b", re.I)),
    ("ai engineering", re.compile(r"\b(?:ai|artificial intelligence)\s+engineer\b", re.I)),
    ("data engineering", re.compile(r"\bdata\s+engineer(?:ing)?\b", re.I)),
    ("software engineering", re.compile(r"\bsoftware\s+engineer(?:ing)?\b", re.I)),
    ("backend engineering", re.compile(r"\bback[\s-]?end\s+engineer(?:ing)?\b", re.I)),
    ("frontend engineering", re.compile(r"\bfront[\s-]?end\s+engineer(?:ing)?\b", re.I)),
    ("devops", re.compile(r"\bdevops\b", re.I)),
    ("cybersecurity", re.compile(r"\b(?:cyber\s*security|sécurité|infosec)\b", re.I)),
    ("human resources", re.compile(r"\b(?:human resources|hr administrator|recruteur)\b", re.I)),
    ("nursing", re.compile(r"\b(?:registered nurse|licensed practical nurse|infirmier)\b", re.I)),
    ("project management", re.compile(r"\bproject\s+manager\b", re.I)),
]

_SKILLS_SECTION = re.compile(
    r"(?:^|\n)\s*(?:skills|compétences|technical skills|technologies|tech stack)\s*[:\-]\s*(.+?)(?=\n\s*\n|\n\s*[A-Z][A-Za-z ]{2,40}\s*:|\Z)",
    re.I | re.S,
)


def canonical(skill: str) -> str:
    s = " ".join(skill.lower().strip().split())
    for key, names in ALIASES.items():
        if s == key or s in names:
            return key
    return s


def normalize_skills(skills: list[str]) -> list[str]:
    """Normalize inbound Spring/Angular skill lists to canonical forms."""
    out: list[str] = []
    for skill in skills:
        if not isinstance(skill, str) or not skill.strip():
            continue
        out.append(canonical(skill))
    return sorted(set(out))


def _alias_match(alias: str, text_lower: str) -> Optional[re.Match[str]]:
    if alias in AMBIGUOUS_ALIASES or len(alias) <= 2:
        pattern = r"(?<![a-z0-9_+#])" + re.escape(alias) + r"(?![a-z0-9_+#])"
    else:
        pattern = r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])"
    return re.search(pattern, text_lower)


def find_skills(text: str) -> tuple[list[str], list[ExtractionEvidence]]:
    lowered = text.lower()
    # Prefer dense skill sections first (higher confidence), then full text.
    section_blobs = [m.group(1) for m in _SKILLS_SECTION.finditer(text)]
    search_regions: list[tuple[str, float]] = [(blob.lower(), 0.92) for blob in section_blobs]
    search_regions.append((lowered, 0.82))

    found: dict[str, ExtractionEvidence] = {}
    for region, base_conf in search_regions:
        for skill, names in ALIASES.items():
            if skill in found:
                continue
            # Prefer longest aliases first to capture "spring boot" before noise.
            for alias in sorted(names, key=len, reverse=True):
                match = _alias_match(alias, region)
                if not match:
                    continue
                conf = base_conf if alias not in AMBIGUOUS_ALIASES else min(base_conf, 0.6)
                # Map span back best-effort from original text when possible.
                span = match.group(0)
                found[skill] = ExtractionEvidence(
                    field="skills",
                    value=skill,
                    span=span,
                    confidence=conf,
                )
                break
    skills = sorted(found.keys())
    return skills, [found[s] for s in skills]


_EXP_SECTION_HEADER = re.compile(
    r"(?:^|\n)\s*"
    r"(?:exp[eé]riences?(?:\s+professionnelles?)?|"
    r"work\s+experience|professional\s+experience|emplois?(?:\s+occupés)?)\b"
    r"\s*[:\-]?\s*",
    re.I,
)
# Strict section titles only — avoid cutting on "Projet de Fin d'Études".
_NEXT_SECTION_HEADER = re.compile(
    r"(?:^|\n)\s*"
    r"(?:formation|éducation|education|parcours\s+académique|"
    r"langues?|languages?|compétences(?:\s+techniques)?|technical\s+skills|skills|"
    r"certificat(?:s|ions)?|"
    r"projets?\s+réalisés|projets?\s*[:\-]|personal\s+projects|"
    r"centres?\s+d['’]?intérêt|loisirs|intérêts|"
    r"profil|profile|summary|about\s+me|à\s+propos|"
    r"coordonnées|contact)\b"
    r"\s*[:\-]?\s*",
    re.I,
)
# MM/YYYY – MM/YYYY | MM/YYYY – En cours | YYYY-MM – YYYY-MM
_DATE_RANGE = re.compile(
    r"(?P<sm>\d{1,2})\s*[/\-]\s*(?P<sy>\d{4})\s*[-–—]\s*"
    r"(?:"
    r"(?P<em>\d{1,2})\s*[/\-]\s*(?P<ey>\d{4})"
    r"|"
    r"(?P<ongoing>présent|present|aujourd['’]hui|en\s+cours|actuel(?:le)?|now|current)"
    r")",
    re.I,
)

_MONTH_NAME_TO_NUM = {
    "janvier": 1,
    "jan": 1,
    "january": 1,
    "février": 2,
    "fevrier": 2,
    "feb": 2,
    "february": 2,
    "mars": 3,
    "mar": 3,
    "march": 3,
    "avril": 4,
    "apr": 4,
    "april": 4,
    "mai": 5,
    "may": 5,
    "juin": 6,
    "jun": 6,
    "june": 6,
    "juillet": 7,
    "jul": 7,
    "july": 7,
    "août": 8,
    "aout": 8,
    "aug": 8,
    "august": 8,
    "septembre": 9,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "octobre": 10,
    "oct": 10,
    "october": 10,
    "novembre": 11,
    "nov": 11,
    "november": 11,
    "décembre": 12,
    "decembre": 12,
    "dec": 12,
    "december": 12,
}
_MONTH_ALT = "|".join(sorted(_MONTH_NAME_TO_NUM.keys(), key=len, reverse=True))
# "Mars 2023 - Aujourd'hui" / "Juin 2022 - Septembre 2022"
_DATE_RANGE_NAMED = re.compile(
    rf"(?P<sm_name>{_MONTH_ALT})\s+(?P<sy>\d{{4}})\s*[-–—]\s*"
    rf"(?:"
    rf"(?P<em_name>{_MONTH_ALT})\s+(?P<ey>\d{{4}})"
    rf"|"
    rf"(?P<ongoing>présent|present|aujourd['’]hui|en\s+cours|actuel(?:le)?|now|current)"
    rf")",
    re.I,
)


def _experience_section(text: str) -> Optional[str]:
    match = _EXP_SECTION_HEADER.search(text)
    if not match:
        return None
    rest = text[match.end() :]
    end = _NEXT_SECTION_HEADER.search(rest)
    return rest[: end.start()] if end else rest


def _months_from_ranges(blob: str) -> tuple[Optional[float], Optional[str]]:
    """Sum non-overlapping month spans from dated experience lines."""
    from datetime import date

    today = date.today()
    intervals: list[tuple[date, date, str]] = []

    def _append(start: date, end: date, span: str) -> None:
        if end < start:
            return
        months = (end.year - start.year) * 12 + (end.month - start.month)
        if months <= 0:
            months = 1
        intervals.append((start, end, span))

    for match in _DATE_RANGE.finditer(blob):
        try:
            start = date(int(match.group("sy")), int(match.group("sm")), 1)
            if match.group("ongoing"):
                end = date(today.year, today.month, 1)
            else:
                end = date(int(match.group("ey")), int(match.group("em")), 1)
        except (TypeError, ValueError):
            continue
        _append(start, end, match.group(0))

    for match in _DATE_RANGE_NAMED.finditer(blob):
        try:
            sm = _MONTH_NAME_TO_NUM[match.group("sm_name").lower()]
            start = date(int(match.group("sy")), sm, 1)
            if match.group("ongoing"):
                end = date(today.year, today.month, 1)
            else:
                em = _MONTH_NAME_TO_NUM[match.group("em_name").lower()]
                end = date(int(match.group("ey")), em, 1)
        except (TypeError, ValueError, KeyError):
            continue
        _append(start, end, match.group(0))

    if not intervals:
        return None, None

    # Merge overlaps so concurrent roles are not double-counted.
    intervals.sort(key=lambda x: x[0])
    merged: list[tuple[date, date]] = []
    for start, end, _ in intervals:
        if not merged or start > merged[-1][1]:
            merged.append((start, end))
        else:
            prev_start, prev_end = merged[-1]
            merged[-1] = (prev_start, max(prev_end, end))

    total_months = 0
    for start, end in merged:
        months = (end.year - start.year) * 12 + (end.month - start.month)
        total_months += max(months, 1)

    years = round(total_months / 12.0, 1)
    if years <= 0 or years > 50:
        return None, None
    span = "; ".join(span for _, _, span in intervals[:5])
    return years, span


def experience_years(text: str) -> tuple[Optional[float], list[ExtractionEvidence]]:
    patterns = [
        r"(?<!\d)(\d{1,2})\+\s*(?:years?|yrs?|ans|années?)\s+(?:of\s+)?(?:professional\s+)?experience",
        r"(?<!\d)(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\+?\s*(?:years?|yrs?|ans|années?)\s+(?:of\s+)?(?:professional\s+)?experience",
        r"(?:experience|expérience)\s*(?:of|de|:)?\s*(\d{1,2})\+?\s*(?:years?|ans|années?)",
        # FR: "5 ans d'expérience" / "3 ans d'experience" (accent optional)
        r"(?<!\d)(\d{1,2})\+?\s*(?:years?|yrs?|ans|années?)\s+d['’]exp[eé]rience(?:\s+professionnelle)?",
        r"(?:minimum|at least|au moins|min\.?)\s+(\d{1,2})\s*(?:years?|ans|années?)",
        r"(\d{1,2})\+\s*(?:years?|yrs?|ans|années?)\s+(?:in|de|d['’])",
        r"(?:over|plus de)\s+(\d{1,2})\s*(?:years?|ans|années?)",
        # months stated explicitly
        r"(?<!\d)(\d{1,2})\s*(?:months?|mois)\s+(?:of\s+)?(?:professional\s+)?(?:experience|expérience)",
        r"(?:experience|expérience)\s*(?:of|de|:)?\s*(\d{1,2})\s*(?:months?|mois)",
    ]
    values: list[tuple[float, str, float]] = []  # years, span, confidence
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.I):
            raw = int(match.group(1))
            span = match.group(0)
            if "mois" in span.lower() or "month" in span.lower():
                years = round(raw / 12.0, 1)
            else:
                years = float(raw)
            if 0 < years <= 50:
                values.append((years, span, 0.72))

    section = _experience_section(text)
    if section:
        inferred, span = _months_from_ranges(section)
        if inferred is not None and span:
            values.append((inferred, span, 0.58))

    if not values:
        return None, []
    # Prefer explicit statements (higher confidence); otherwise longest tenure signal.
    best = max(values, key=lambda x: (x[2], x[0]))
    return best[0], [
        ExtractionEvidence(
            field="experienceYears",
            value=str(best[0]),
            span=best[1][:180],
            confidence=best[2],
        )
    ]


_EDU_RANK = {"bachelor": 1, "master": 2, "phd": 3}
_EDU_LEVEL_FROM_RANK = {1: "bachelor", 2: "master", 3: "phd"}
_EDU_WIRE = re.compile(r"^edu([123])(ok|ip|un)$", re.I)

_FORMATION_SECTION_HEADER = re.compile(
    r"(?:^|\n)\s*"
    r"(?:formation|éducation|education|parcours\s+académique|"
    r"academic\s+(?:background|history)|diplômes?)\b"
    r"\s*[:\-]?\s*",
    re.I,
)
_AFTER_FORMATION_HEADER = re.compile(
    r"(?:^|\n)\s*"
    r"(?:exp[eé]riences?(?:\s+professionnelles?)?|"
    r"work\s+experience|langues?|languages?|compétences|skills|"
    r"certificat(?:s|ions)?|projets?\s+réalisés|projets?\s*[:\-]|"
    r"centres?\s+d['’]?intérêt|loisirs|intérêts|profil|profile|"
    r"coordonnées|contact)\b"
    r"\s*[:\-]?\s*",
    re.I,
)

_DEGREE_PATTERNS: list[tuple[str, re.Pattern[str], float]] = [
    ("phd", re.compile(r"\b(ph\.?d\.?|doctorate|doctorat)\b", re.I), 0.85),
    (
        "master",
        re.compile(
            r"\b(master(?:'s)?|msc|m\.sc\.?|mba|mastère|ingénieur|"
            r"engineering degree|diplôme d['’]ingénieur|bac\s*\+\s*5|"
            r"cycle\s+ingénieur)\b",
            re.I,
        ),
        0.8,
    ),
    (
        "bachelor",
        re.compile(
            r"\b(bachelor(?:'s)?|bsc|b\.sc\.?|licence|undergraduate|"
            r"bac\s*\+\s*3|associate(?:'s)? degree)\b",
            re.I,
        ),
        0.75,
    ),
]

_IN_PROGRESS_CUE = re.compile(
    r"(?:en\s+cours|in\s+progress|currently\s+(?:pursuing|studying)|"
    r"en\s+préparation|étudiant(?:e)?|etudiant(?:e)?|"
    r"\d(?:er|ère|eme|ème|e)\s+année|year\s+\d)\b",
    re.I,
)
_COMPLETED_CUE = re.compile(
    r"(?:obtenu(?:e)?|diplômé(?:e)?|graduated|completed|awarded|terminé(?:e)?|finished)\b",
    re.I,
)


def encode_education_wire(level: str, status: str) -> str:
    """Encode level+status so Offre-Service normalizeEducation keeps the token."""
    rank = _EDU_RANK[level]
    if status == "completed":
        return level
    flag = {"in_progress": "ip", "unknown": "un"}.get(status, "un")
    return f"edu{rank}{flag}"


def parse_education_value(
    education: Optional[str],
    education_status: Optional[str] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Return (level, status). Plain level + missing status ⇒ status None (legacy)."""
    status_hint = (
        education_status
        if education_status in {"completed", "in_progress", "unknown"}
        else None
    )
    if not education or not str(education).strip():
        return None, status_hint

    raw = str(education).strip()
    wire = _EDU_WIRE.match(raw.lower())
    if wire:
        level = _EDU_LEVEL_FROM_RANK[int(wire.group(1))]
        status = {"ok": "completed", "ip": "in_progress", "un": "unknown"}[
            wire.group(2)
        ]
        return level, status_hint or status

    lowered = raw.lower()
    # Normalize "bac + 3" / "Bac+ 5" → "bac+3" for token matching (Offre free-text).
    compact = re.sub(r"\s+", "", lowered)
    compact = re.sub(r"bac\+(\d)", r"bac+\1", compact)
    if lowered in _EDU_RANK or compact in _EDU_RANK:
        return (lowered if lowered in _EDU_RANK else compact), status_hint
    if "phd" in lowered or "doctor" in lowered:
        return "phd", status_hint
    if any(
        k in lowered or k in compact
        for k in ("master", "ingénieur", "ingenieur", "bac+5", "mba", "mastère")
    ):
        return "master", status_hint
    if any(k in lowered or k in compact for k in ("bachelor", "licence", "bac+3")):
        return "bachelor", status_hint
    return None, status_hint


def _formation_section(text: str) -> Optional[str]:
    match = _FORMATION_SECTION_HEADER.search(text)
    if not match:
        return None
    rest = text[match.end() :]
    end = _AFTER_FORMATION_HEADER.search(rest)
    return rest[: end.start()] if end else rest


def _status_from_window(window: str) -> str:
    if _IN_PROGRESS_CUE.search(window):
        return "in_progress"
    if _COMPLETED_CUE.search(window):
        return "completed"
    for match in _DATE_RANGE.finditer(window):
        if match.group("ongoing"):
            return "in_progress"
        if match.group("ey"):
            return "completed"
    return "completed"


def _collect_diplomas(blob: str) -> list[tuple[str, str, str, float]]:
    found: list[tuple[str, str, str, float]] = []
    for level, pattern, conf in _DEGREE_PATTERNS:
        for match in pattern.finditer(blob):
            start = max(0, match.start() - 120)
            end = min(len(blob), match.end() + 120)
            status = _status_from_window(blob[start:end])
            found.append((level, status, match.group(0), conf))
    return found


def education_level(
    text: str,
) -> tuple[Optional[str], Optional[str], list[ExtractionEvidence]]:
    """Highest diploma level + status (completed | in_progress | unknown)."""
    diplomas: list[tuple[str, str, str, float]] = []
    section = _formation_section(text)
    if section:
        diplomas.extend(_collect_diplomas(section))
    if not diplomas:
        diplomas.extend(_collect_diplomas(text))

    if not diplomas:
        return None, None, []

    # Highest rank wins; if tied, prefer in_progress so
    # "licence obtenue + ingénieur en cours" → master / in_progress.
    status_rank = {"in_progress": 2, "unknown": 1, "completed": 0}

    def sort_key(item: tuple[str, str, str, float]) -> tuple[int, int]:
        lvl, st, _, _ = item
        return (_EDU_RANK[lvl], status_rank.get(st, 0))

    level, status, span, conf = max(diplomas, key=sort_key)
    evidence = [
        ExtractionEvidence(
            field="education",
            value=level,
            span=span,
            confidence=conf,
        ),
        ExtractionEvidence(
            field="educationStatus",
            value=status,
            span=span,
            confidence=0.7 if status != "unknown" else 0.45,
        ),
    ]
    for lvl, st, sp, cf in diplomas:
        if lvl == level and st == status and sp == span:
            continue
        if _EDU_RANK[lvl] < _EDU_RANK[level]:
            evidence.append(
                ExtractionEvidence(
                    field="education",
                    value=f"{lvl}:{st}",
                    span=sp,
                    confidence=cf * 0.9,
                )
            )
    return level, status, evidence


def specialty(text: str) -> tuple[Optional[str], list[ExtractionEvidence]]:
    for label, pattern in _SPECIALTY_PATTERNS:
        match = pattern.search(text)
        if match:
            return label, [
                ExtractionEvidence(
                    field="specialty",
                    value=label,
                    span=match.group(0),
                    confidence=0.65,
                )
            ]
    return None, []


def extract(text: str) -> dict:
    """Return a JSON-serializable extraction dict (API + batch scripts)."""
    if not text or not str(text).strip():
        return ExtractResponse(
            skills=[],
            experienceYears=None,
            education=None,
            educationStatus=None,
            specialty=None,
            method="rule-based-nlp-v3",
            evidence=[],
            limitations=["Empty input text."],
        ).model_dump()

    skills, skill_ev = find_skills(text)
    years, year_ev = experience_years(text)
    edu, edu_status, edu_ev = education_level(text)
    spec, spec_ev = specialty(text)
    edu_wire = encode_education_wire(edu, edu_status) if edu and edu_status else edu
    response = ExtractResponse(
        skills=skills,
        experienceYears=years,
        education=edu_wire,
        educationStatus=edu_status,
        specialty=spec,
        method="rule-based-nlp-v3",
        evidence=skill_ev + year_ev + edu_ev + spec_ev,
        limitations=[
            "Skills limited to curated alias dictionary; unknown skills are not invented.",
            "Experience and education extraction are heuristic and require human validation.",
            "No OCR for scanned PDFs; specialty is a soft signal only.",
            "Education status (completed/in_progress/unknown) is heuristic from Formation dates/cues.",
        ],
    )
    return response.model_dump()
