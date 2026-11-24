from app.nlp import extract, normalize_skills


def test_skills_aliases_and_evidence():
    out = extract("Experienced with React.js, K8s and PostgreSQL.")
    assert {"react", "kubernetes", "postgresql"} <= set(out["skills"])
    assert any(e["field"] == "skills" for e in out["evidence"])


def test_experience_and_education_fr_en():
    out = extract("Expérience de 5 ans. Diplôme d'ingénieur.")
    assert out["experienceYears"] == 5
    assert out["education"] == "master"


def test_experience_ans_d_experience():
    out = extract("Développeur Java avec 4 ans d'expérience professionnelle.")
    assert out["experienceYears"] == 4


def test_experience_ans_without_accent():
    out = extract("Data Analyst avec 3 ans d'experience en analyse de donnees.")
    assert out["experienceYears"] == 3.0


def test_experience_named_month_ranges_in_plural_section():
    text = """
EXPERIENCES PROFESSIONNELLES
Data Analyst — Atlas Retail, Tunis
Mars 2023 - Aujourd'hui
• Tableaux de bord Power BI
Stagiaire BI — NovaTech
Juin 2022 - Septembre 2022
FORMATION
Master professionnel
"""
    out = extract(text)
    assert out["experienceYears"] is not None
    assert out["experienceYears"] >= 1.0


def test_cyber_skills_lexicon():
    text = (
        "Sécurité : SIEM, Splunk, Microsoft Sentinel, Wireshark, Nmap, "
        "gestion des incidents, sécurité réseau. Linux, Python."
    )
    out = extract(text)
    skills = set(out["skills"])
    assert {"siem", "splunk", "wireshark", "nmap", "linux", "python"} <= skills
    assert "gestion des incidents" in skills
    assert "sécurité réseau" in skills


def test_experience_from_dated_stages():
    """Student CVs often list internships by date without 'X years'."""
    text = """
COMPÉTENCES
Java, Spring Boot
EXPÉRIENCE
STAGIAIRE, 08/2025 – 10/2025
Stage d'été – Vision Age VFX
STAGIAIRE, 02/2023 – 09/2023
Projet de Fin d'Études – Linedata
STAGIAIRE, 06/2022 – 08/2022
Stage d'été – TOPNET
FORMATION
Esprit, Tunis — 09/2023 – En cours
Diplôme d'ingénieur
PROJETS RÉALISÉS
– Projet Coding Factory | 2024-2025
"""
    out = extract(text)
    # 2 + 7 + 2 = 11 months ≈ 0.9 year; education/project dates must not inflate this
    assert out["experienceYears"] == 0.9
    assert out["educationStatus"] == "in_progress"
    assert out["education"] == "edu2ip"  # wire token for Offre-Service


def test_education_bac5_completed():
    out = extract("FORMATION\nMaster of Science obtenu en 2021.")
    assert out["education"] == "master"
    assert out["educationStatus"] == "completed"


def test_education_licence_plus_ingenieur_en_cours():
    text = """
FORMATION
Faculté des Sciences — 09/2021 – 09/2023
Diplôme de licence en sciences informatiques
Esprit — 09/2023 – En cours
Diplôme d'ingénieur en Software Architecture Engineering
"""
    out = extract(text)
    assert out["educationStatus"] == "in_progress"
    assert out["education"] == "edu2ip"
    assert any(
        e["field"] == "education" and str(e["value"]).startswith("bachelor:")
        for e in out["evidence"]
    )


def test_education_bachelor_only_below_master_requirement_signal():
    out = extract("FORMATION\nLicence en informatique obtenue en 2022.")
    assert out["education"] == "bachelor"
    assert out["educationStatus"] == "completed"


def test_experience_ignores_hobby_depuis_deux_ans():
    text = """
PROFIL
Étudiante motivée.
CENTRES D'INTÉRÊT
j'organise chaque année depuis deux ans une collecte.
"""
    out = extract(text)
    assert out["experienceYears"] is None


def test_specialty_ai_engineer():
    out = extract("AI Engineer with PyTorch and NLP background.")
    assert out["specialty"] == "ai engineering"
    assert "pytorch" in out["skills"]


def test_normalize_skills():
    assert normalize_skills(["React.js", "K8s", "Postgres"]) == [
        "kubernetes",
        "postgresql",
        "react",
    ]


def test_fr_lexicon_aliases_normalize():
    assert normalize_skills(
        [
            "apprentissage automatique",
            "traitement du langage naturel",
            "visualisation des données",
            "statistiques",
            "intégration continue",
            "k8s",
        ]
    ) == [
        "ci/cd",
        "data visualization",
        "kubernetes",
        "machine learning",
        "nlp",
        "statistics",
    ]


def test_empty_text():
    out = extract("   ")
    assert out["skills"] == []
    assert out["method"].endswith("v3")


def test_parse_education_bac_plus_with_spaces():
    from app.nlp import parse_education_value

    assert parse_education_value("bac + 3")[0] == "bachelor"
    assert parse_education_value("Bac + 5 (Master / Ingénieur)")[0] == "master"
    assert parse_education_value("bac+3")[0] == "bachelor"
