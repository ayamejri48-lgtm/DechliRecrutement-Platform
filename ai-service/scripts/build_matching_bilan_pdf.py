# -*- coding: utf-8 -*-
"""Génère le bilan technique détaillé AI Matching (CRISP-DM) en PDF sur le Bureau."""
from __future__ import annotations

from pathlib import Path

from fpdf import FPDF

DESKTOP = Path.home() / "Desktop"
OUT = DESKTOP / "Bilan_AI_Matching_CRISP_DM_DechliRecrutement.pdf"
FONT = r"C:\Windows\Fonts\arial.ttf"
FONT_BOLD = r"C:\Windows\Fonts\arialbd.ttf"


class BilanPDF(FPDF):
    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_font("ArialUnicode", "B", 9)
        self.set_text_color(40, 80, 75)
        self.cell(0, 6, "Bilan technique - AI Matching DechliRecrutement (CRISP-DM)", ln=1)
        self.set_draw_color(180, 200, 195)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(4)

    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("ArialUnicode", size=8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, f"Page {self.page_no()}/{{nb}} - PFE DechliRecrutement - AI-Service v1.3.1 / hybrid-v3.1.1", align="C")


def _safe(text: str) -> str:
    return (
        text.replace("—", "-")
        .replace("–", "-")
        .replace("→", "->")
        .replace("×", "x")
        .replace("·", "-")
        .replace("€", "EUR")
        .replace("∈", "in")
    )


def add_title(pdf: BilanPDF, text: str) -> None:
    pdf.set_x(pdf.l_margin)
    pdf.set_font("ArialUnicode", "B", 14)
    pdf.set_text_color(13, 55, 50)
    pdf.multi_cell(pdf.epw, 8, _safe(text))
    pdf.ln(2)


def add_h2(pdf: BilanPDF, text: str) -> None:
    pdf.ln(2)
    pdf.set_x(pdf.l_margin)
    pdf.set_font("ArialUnicode", "B", 12)
    pdf.set_text_color(21, 110, 104)
    pdf.multi_cell(pdf.epw, 7, _safe(text))
    pdf.ln(1)


def add_h3(pdf: BilanPDF, text: str) -> None:
    pdf.set_x(pdf.l_margin)
    pdf.set_font("ArialUnicode", "B", 10.5)
    pdf.set_text_color(30, 60, 55)
    pdf.multi_cell(pdf.epw, 6, _safe(text))
    pdf.ln(0.5)


def add_p(pdf: BilanPDF, text: str) -> None:
    pdf.set_x(pdf.l_margin)
    pdf.set_font("ArialUnicode", size=10)
    pdf.set_text_color(25, 25, 25)
    pdf.multi_cell(pdf.epw, 5.5, _safe(text))
    pdf.ln(1.5)


def add_bullet(pdf: BilanPDF, text: str) -> None:
    pdf.set_font("ArialUnicode", size=10)
    pdf.set_text_color(25, 25, 25)
    pdf.set_x(pdf.l_margin + 4)
    pdf.multi_cell(pdf.epw - 4, 5.3, _safe(f"- {text}"))
    pdf.ln(0.4)


def main() -> None:
    pdf = BilanPDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_font("ArialUnicode", "", FONT)
    pdf.add_font("ArialUnicode", "B", FONT_BOLD)
    pdf.add_page()

    # ===== COVER =====
    pdf.set_font("ArialUnicode", "B", 18)
    pdf.set_text_color(13, 36, 34)
    pdf.ln(8)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 9, "BILAN TECHNIQUE DETAILLE")
    pdf.set_font("ArialUnicode", "B", 15)
    pdf.set_text_color(21, 110, 104)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 8, "Service Matching AI - DechliRecrutement")
    pdf.ln(2)
    pdf.set_font("ArialUnicode", size=11)
    pdf.set_text_color(50, 50, 50)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(
        pdf.epw,
        6,
        "Methodologie CRISP-DM - Architecture - Extraction - Formules hybrid-v3.1.1 - "
        "Bibliotheques - Integration plateforme - Evaluation - Limites",
    )
    pdf.ln(3)
    add_p(
        pdf,
        "Document destiné à la soutenance technique. Version code officielle présentée : "
        "AI-Service FastAPI v1.3.1, modelVersion hybrid-v3.1.1, method hybrid-baseline-v3.1.1. "
        "Chemin jury : extract rules + sémantique TF-IDF + matching hybrid (pas de modèle ML supervisé live).",
    )

    # ===== 0. EXECUTIVE =====
    add_title(pdf, "0. Synthèse exécutive (à retenir)")
    add_bullet(
        pdf,
        "Problème : aider le recruteur à prioriser les candidatures via un score d’adéquation CV↔offre ∈ [0,1] + explications.",
    )
    add_bullet(
        pdf,
        "Solution live : baseline heuristique EXPLICABLE (hybrid-v3.1.1), pas un LLM bout-en-bout, pas un réseau de neurones entraîné.",
    )
    add_bullet(
        pdf,
        "Datasets 12k CV + 12k offres : construction / extraction / évaluation — PAS le matching runtime.",
    )
    add_bullet(
        pdf,
        "Runtime : Offre-Service envoie CV PDF + profil offre → AI-Service (clé interne) → score + bandes + features.",
    )
    add_bullet(
        pdf,
        "LLM : NON utilisé sur le chemin officiel de matching. Ollama = option extract. Groq = Test-Service (autre module).",
    )
    add_bullet(
        pdf,
        "Phrase clé : le score est une AIDE À LA DÉCISION, pas une probabilité d’embauche.",
    )

    # ===== 1. CRISP-DM =====
    pdf.add_page()
    add_title(pdf, "1. Méthodologie CRISP-DM — ce qui a été fait phase par phase")
    add_p(
        pdf,
        "CRISP-DM (Cross-Industry Standard Process for Data Mining) structure le travail AI en 6 phases. "
        "Ci-dessous : ce qui a réellement été livré dans le repo AI-Service (pas du futur théorique).",
    )

    add_h2(pdf, "Phase 1 — Business Understanding (compréhension métier)")
    add_bullet(pdf, "Problème métier : prioriser des candidatures IT sur une offre.")
    add_bullet(pdf, "Utilisateur : recruteur (owner de l’offre) ; candidat ne voit pas les scores des autres.")
    add_bullet(pdf, "Contraintes plateforme : JWT/rôles gérés hors AI ; AI appelé seulement en interne.")
    add_bullet(pdf, "Critères de succès : baseline toujours dispo, extract local 0€, score borné [0,1], explicable, anti-faux-positifs.")
    add_bullet(pdf, "Hypothèse clé : requiredSkills viennent du métier (offre structurée), jamais inventées comme obligatoires par l’IA depuis un texte libre.")
    add_bullet(pdf, "Livrables : docs PHASE1_BUSINESS_DATA_UNDERSTANDING, protocole d’annotation.")

    add_h2(pdf, "Phase 2 — Data Understanding (compréhension des données)")
    add_bullet(pdf, "Deux datasets bruts : data/raw/pfe_cv_12000.csv et data/raw/pfe_offres_12000.csv (~12 000 chacun).")
    add_bullet(pdf, "Analyse Pandas : manquants, longueurs, catégories, parent_id (variantes d’un même CV), skills_raw.")
    add_bullet(pdf, "Catalogue d’anomalies (qualité texte, biais catégories, skills partielles…).")
    add_bullet(pdf, "Rôle ACTUEL des datasets : comprendre la réalité des textes pour construire extract + évaluer le scoring.")
    add_bullet(pdf, "Rôle NON actuel : entraîner un modèle supervisé live (labels humains gold absents).")
    add_bullet(pdf, "Livrable mesure : data/processed/phase1_data_understanding.json + script 05_phase1_data_understanding.py.")

    add_h2(pdf, "Phase 3 — Data Preparation (préparation des données)")
    add_bullet(pdf, "Nettoyage CSV → cv_cleaned / offres_cleaned (scripts 01_clean.py).")
    add_bullet(pdf, "Extraction batch rules sur échantillons (scripts 02_extract.py, 08_stratified_extract.py).")
    add_bullet(pdf, "Correctifs extract P0 après QA : lexique cyber/DevOps/ML FR, parsing expérience (accents/dates).")
    add_bullet(pdf, "Fichiers : cv_extracted*.csv, offres_extracted*.csv, stratified_extract_report.json.")
    add_bullet(pdf, "Files d’annotation préparées (annotation_queue_it / annotation_queue_1000) avec weak_label_score = score hybrid (PAS gold).")
    add_bullet(pdf, "Règle éthique : weak labels ≠ vérité terrain ; train refusé sans labels humains (sauf flag expérimental).")

    add_h2(pdf, "Phase 4 — Modeling (modélisation)")
    add_bullet(pdf, "Modèle OFFICIEL présenté : hybrid-baseline-v3.1.1 (MCDM pondéré + garde-fous).")
    add_bullet(pdf, "Skills signal = 0.7×Recall + 0.3×F1 (formules IR classiques).")
    add_bullet(pdf, "Poids : Skills 50% + Sémantique 20% + Expérience 20% + Formation 10% (renormalisation si feature absente).")
    add_bullet(pdf, "Sémantique défaut : TF-IDF cosinus (scikit-learn). Option : Sentence-Transformers local.")
    add_bullet(pdf, "Extract défaut : rules (lexique + regex + PyMuPDF pour PDF). Option : Ollama Structured Output.")
    add_bullet(pdf, "ML supervisé (/match/ml + joblib) : code prêt, 503 si modèle absent — NON présenté comme chemin jury.")

    add_h2(pdf, "Phase 5 — Evaluation (évaluation)")
    add_bullet(pdf, "Probes métier anti-faux-positifs (ex. Java vs Cyber → score bas ; bon overlap ML → high ; offre sans skills → unavailable).")
    add_bullet(pdf, "false_match_pass = true · determinism_ok = true.")
    add_bullet(pdf, "Campagne ~1000 paires (same_domain / hard_near / cross_domain / random) → final_baseline_eval_report.json.")
    add_bullet(pdf, "pytest suite matching/extract (dizaines de tests verts en baseline).")
    add_bullet(pdf, "QA sur cas réels plateforme (ex. 4 users × N offres) pour valider intégration extract PDF + hybrid.")

    add_h2(pdf, "Phase 6 — Deployment (déploiement)")
    add_bullet(pdf, "Service FastAPI uvicorn :8000, header X-Internal-Api-Key.")
    add_bullet(pdf, "Intégration : Offre-Service (Spring) appelle AI en RestClient ; Angular n’appelle JAMAIS :8000.")
    add_bullet(pdf, "Script start_demo.ps1 fige AI_EXTRACT_BACKEND=rules et AI_SEMANTIC_BACKEND=tfidf.")
    add_bullet(pdf, "Health/Swagger : /health , /docs.")

    # ===== 2. ARCHITECTURE =====
    pdf.add_page()
    add_title(pdf, "2. Architecture technique du matching dans la plateforme")
    add_h3(pdf, "Flux runtime (production / démo)")
    add_p(
        pdf,
        "1) Recruteur clique « Calculer le matching » dans Angular.\n"
        "2) Requête HTTP → API Gateway :8083 → Offre-Service :8084 (JWT).\n"
        "3) Offre-Service charge le PDF via cvId (snapshot candidature) auprès de User-Service (API interne).\n"
        "4) Offre-Service POST /api/v1/extract/cv/pdf vers AI-Service :8000 (+ clé interne).\n"
        "5) Offre-Service construit le profil offre (skills structurées + requiredSkills + exp/edu/title).\n"
        "6) Offre-Service POST /api/v1/match → hybrid-v3.1.1.\n"
        "7) Persistance MatchResult côté offre_db ; Angular affiche score, bande, explications FR.",
    )
    add_h3(pdf, "Pourquoi service-to-service ?")
    add_bullet(pdf, "Sécurité : la clé AI ne circule pas dans le navigateur.")
    add_bullet(pdf, "Orchestration : CV snapshot + offre + persistance au même endroit métier.")
    add_bullet(pdf, "Front = UI uniquement.")

    # ===== 3. STACK =====
    add_title(pdf, "3. Stack & bibliothèques exactes")
    add_h3(pdf, "Runtime / API")
    add_bullet(pdf, "Python 3 + FastAPI + Uvicorn + Pydantic v2 + python-multipart")
    add_h3(pdf, "Extraction PDF / texte")
    add_bullet(pdf, "PyMuPDF (fitz) : extraction texte PDF (pas d’OCR images scannées)")
    add_bullet(pdf, "NLP rules maison : app/nlp.py + app/skills_lexicon.py (lexique + regex)")
    add_bullet(pdf, "Option Ollama (local) : extract Structured Output — NON requis chemin jury")
    add_h3(pdf, "Matching / features")
    add_bullet(pdf, "NumPy + Pandas (prep/scripts)")
    add_bullet(pdf, "scikit-learn : TF-IDF + similarité cosinus (sémantique défaut)")
    add_bullet(pdf, "sentence-transformers (option ST locale)")
    add_bullet(pdf, "joblib : sérialisation modèle ML optionnel")
    add_h3(pdf, "Qualité")
    add_bullet(pdf, "pytest + httpx (tests API)")
    add_h3(pdf, "LLM ?")
    add_p(
        pdf,
        "Sur le chemin officiel MATCHING : AUCUN LLM cloud. "
        "Pas de GPT/Claude pour le score. "
        "Ollama = option EXTRACT locale. "
        "Groq/LLM côté Test-Service = autre bounded context (génération/correction de questions), pas le matching.",
    )

    # ===== 4. EXTRACT =====
    pdf.add_page()
    add_title(pdf, "4. Pipeline d’extraction — détail ingénieur")
    add_h2(pdf, "4.1 Entrées")
    add_bullet(pdf, "Texte CV / offre (POST /extract/cv , /extract/offer)")
    add_bullet(pdf, "PDF multipart (POST /extract/cv/pdf) — max ~10 Mo / 30 pages (contraintes service)")
    add_h2(pdf, "4.2 Backend extract (config)")
    add_bullet(pdf, "AI_EXTRACT_BACKEND=rules → chemin officiel")
    add_bullet(pdf, "auto / ollama → tente LLM local puis fallback rules")
    add_h2(pdf, "4.3 Sorties structurées")
    add_bullet(pdf, "skills[] normalisées")
    add_bullet(pdf, "experienceYears (nombre d’années estimé)")
    add_bullet(pdf, "education + educationStatus (bachelor/master/phd, completed/in_progress/unknown)")
    add_bullet(pdf, "title / specialty / evidence / limitations")
    add_h2(pdf, "4.4 Comment les datasets 12k aident l’extract (CAS ACTUEL)")
    add_bullet(pdf, "Observer les patterns de texte réel (compétences FR/EN, cyber, data, etc.).")
    add_bullet(pdf, "Élargir le lexique là où l’extract ratait (ex. outils SIEM).")
    add_bullet(pdf, "Corriger les regex d’expérience (dates, accents).")
    add_bullet(pdf, "Mesurer couverture sur échantillons stratifiés (hit-rates).")
    add_bullet(pdf, "Éviter d’annoter / scorer sur des profils mal extraits.")
    add_p(
        pdf,
        "Donc : les datasets = banc d’essai pour itérer les RÈGLES d’extraction. "
        "Ce n’est pas un fine-tuning de LLM sur les 12k.",
    )

    # ===== 5. FORMULES =====
    add_title(pdf, "5. Formules exactes hybrid-v3.1.1")
    add_h2(pdf, "5.1 Features calculées")
    add_h3(pdf, "A) Skills — Recall, Precision, F1, skills_score")
    add_p(
        pdf,
        "Soit C = skills candidat, O = skills offre (normalisées).\n"
        "Appariement soft via familles (ex. statistics↔numpy/scipy ; data visualization↔tableau/power bi…) "
        "et implication unilatérale frameworks REST → « rest api ».\n\n"
        "Recall (skills_coverage) = |matched| / |O|\n"
        "Precision = proportion des skills candidat utiles vs offre\n"
        "F1 = 2·Recall·Precision / (Recall+Precision)\n"
        "skills_score = 0.7·Recall + 0.3·F1\n\n"
        "Interprétation ingénieur : on privilégie de COUVRIR l’offre (recall) tout en pénalisant un CV qui spam des skills (via F1).",
    )
    add_h3(pdf, "B) Required skills coverage")
    add_p(
        pdf,
        "Si R = requiredSkills de l’offre :\n"
        "required_coverage = (|R| − |missing_required|) / |R|\n"
        "Ces required viennent du métier, pas d’une inférence libre.",
    )
    add_h3(pdf, "C) Expérience")
    add_p(
        pdf,
        "experience_match = min(1.0, années_candidat / années_offre)\n"
        "si années_offre > 0 et les deux valeurs présentes ; sinon null (feature absente → renormalisation).",
    )
    add_h3(pdf, "D) Formation")
    add_p(
        pdf,
        "Niveaux : bachelor=1, master=2, phd=3.\n"
        "Si niveau candidat < requis → 0.0\n"
        "Si niveau OK et diplôme en cours → 0.5\n"
        "Si niveau OK et obtenu → 1.0\n"
        "Sinon unknown → null.",
    )
    add_h3(pdf, "E) Sémantique")
    add_p(
        pdf,
        "Par défaut TF-IDF + cosine similarity entre textes de skills/profil (sans surpondérer le titre).\n"
        "title_similarity existe comme signal FAIBLE secondaire (ne doit pas créer un high seul).",
    )

    add_h2(pdf, "5.2 Agrégation MCDM (score brut)")
    add_p(
        pdf,
        "weighted = [\n"
        "  (skills_score, 0.50),\n"
        "  (semantic_similarity, 0.20),\n"
        "  (experience_match, 0.20),\n"
        "  (education_match, 0.10)\n"
        "]\n"
        "score = Σ(v·w) / Σ(w)  sur les features NON nulles (renormalisation).",
    )

    add_h2(pdf, "5.3 Pénalités & plafonds anti-faux-positifs")
    add_bullet(pdf, "Si requiredSkills présents : score *= (0.35 + 0.65 · required_coverage)")
    add_bullet(pdf, "Si titre très proche (≥0.7) mais skills faibles (<0.25) et sémantique faible (<0.45) → score ≤ 0.35")
    add_bullet(pdf, "Si au moins 1 required manquante → score ≤ 0.69 (impossible d’être « high »)")
    add_bullet(pdf, "Si coverage skills = 0 → score ≤ 0.35 ; si coverage < 0.2 → score ≤ 0.45")
    add_bullet(pdf, "Clip final : score ∈ [0, 1]")

    add_h2(pdf, "5.4 Bandes (scoreBand)")
    add_bullet(pdf, "unavailable : score null (souvent offre sans skills structurées)")
    add_bullet(pdf, "low : score < 0.4")
    add_bullet(pdf, "medium : 0.4 ≤ score < 0.7")
    add_bullet(pdf, "high : score ≥ 0.7")

    add_h2(pdf, "5.5 Sorties explicables")
    add_bullet(pdf, "features numériques (coverage, f1, exp, edu, semantic…)")
    add_bullet(pdf, "matchedSkills / missingSkills / missingRequiredSkills")
    add_bullet(pdf, "explanations en français pour le recruteur")
    add_bullet(pdf, "warning : rappelle que ce n’est ni annotation humaine ni ML supervisé")

    # ===== 6. EVAL =====
    pdf.add_page()
    add_title(pdf, "6. Comment on a évalué (détail)")
    add_h3(pdf, "Niveau 1 — Tests unitaires / API")
    add_p(pdf, "pytest sur formules, bandes, cas unavailable, déterminisme, contrats de réponse.")
    add_h3(pdf, "Niveau 2 — Probes métier (garde-fous)")
    add_p(
        pdf,
        "Jeux de paires conçus pour casser un matching naïf :\n"
        "- overlap fort → high attendu\n"
        "- domaines disjoints → score bas\n"
        "- titres proches mais skills différentes → ne doit pas sur-scorer\n"
        "- offre sans skills → unavailable\n"
        "Résultat documenté : false_match_pass=true.",
    )
    add_h3(pdf, "Niveau 3 — Batch ~1000 paires")
    add_p(
        pdf,
        "Distribution same_domain_positive / hard_near_domain / cross_domain_negative / random_pair. "
        "On observe moyennes et taux de high. Preuve : final_baseline_eval_report.json. "
        "Important : ce n’est PAS une vérité gold humaine ; c’est un comportement baseline mesuré.",
    )
    add_h3(pdf, "Niveau 4 — QA intégration plateforme")
    add_p(
        pdf,
        "Cas réels (candidats/offres) : extract PDF rules + match hybrid, analyse des scores/bandes/missing skills "
        "(docs QA_*).",
    )

    # ===== 7. DATASETS ROLE =====
    add_title(pdf, "7. Rôle exact des 2 datasets (présent, pas futur)")
    add_p(
        pdf,
        "Oui, on les a utilisés pour :\n"
        "1) comprendre comment extraire skills / expérience / formation à l’échelle,\n"
        "2) itérer lexique + règles,\n"
        "3) évaluer le comportement du score hybrid sur beaucoup de paires.\n\n"
        "Non, on ne les utilise PAS pour :\n"
        "- le matching live d’un clic recruteur,\n"
        "- entraîner un modèle supervisé présenté en jury,\n"
        "- remplacer le CV PDF réel de la candidature.",
    )

    # ===== 8. STEP BY STEP BUILD =====
    add_title(pdf, "8. Chronologie « comment on a construit » le service (étape par étape)")
    add_bullet(pdf, "Étape A : cadrer le problème (score aide décision + explicabilité).")
    add_bullet(pdf, "Étape B : ingérer et mesurer les datasets 12k+12k (Data Understanding).")
    add_bullet(pdf, "Étape C : clean + extract rules ; corriger les échecs QA extract.")
    add_bullet(pdf, "Étape D : implémenter features + score hybrid + bandes + warnings.")
    add_bullet(pdf, "Étape E : ajouter plafonds anti-faux-positifs après erreurs observées.")
    add_bullet(pdf, "Étape F : passer à hybrid-v3.1/v3.1.1 (0.7R+0.3F1, poids 50/20/20/10, familles soft).")
    add_bullet(pdf, "Étape G : évaluer (probes + 1000 paires + pytest).")
    add_bullet(pdf, "Étape H : exposer FastAPI sécurisée ; brancher Offre-Service (RestClient + clé).")
    add_bullet(pdf, "Étape I : documenter limites + chemin ML/Ollama optionnels sans casser la baseline.")

    # ===== 9. LIMITS =====
    add_title(pdf, "9. Limites honnêtes (à dire au jury avant qu’il les demande)")
    add_bullet(pdf, "Pas d’OCR : PDF image scannée mal supporté.")
    add_bullet(pdf, "Extract rules ≠ compréhension linguistique profonde.")
    add_bullet(pdf, "Poids/heuristiques calibrés par ingénierie + QA, pas par apprentissage supervisé gold.")
    add_bullet(pdf, "TF-IDF dilue parfois les scores mid vs embeddings riches.")
    add_bullet(pdf, "/match/ml en 503 sans annotations humaines — choix volontaire anti-weak-as-gold.")
    add_bullet(pdf, "Le score ne décide pas une embauche.")

    # ===== 10. ORAL =====
    add_title(pdf, "10. Mini script oral 45 secondes (Matching)")
    add_p(
        pdf,
        "« Notre matching suit CRISP-DM. Nous avons analysé deux datasets CV/offres pour construire "
        "une extraction rules et évaluer une baseline hybrid-v3.1.1. "
        "Le score combine skills (0.7 recall + 0.3 F1), sémantique TF-IDF, expérience et formation "
        "avec poids 50/20/20/10, plus des plafonds anti-faux-positifs. "
        "En runtime, Offre-Service appelle l’AI-Service en interne sur le CV snapshot et l’offre réelle. "
        "Ce n’est pas un LLM ni un modèle supervisé live : c’est une aide à la décision explicable. »",
    )

    add_title(pdf, "11. Références code / docs")
    add_bullet(pdf, "app/matching.py — formules hybrid-v3.1.1")
    add_bullet(pdf, "app/extract_pipeline.py , app/nlp.py , app/skills_lexicon.py — extract")
    add_bullet(pdf, "app/semantic.py — TF-IDF / ST")
    add_bullet(pdf, "app/main.py — routes FastAPI")
    add_bullet(pdf, "docs/DECISION_HYBRID_V31.md , FINAL_DELIVERY_AI_MATCHING.md , PHASE1/2 bilans")
    add_bullet(pdf, "data/raw/pfe_cv_12000.csv , data/raw/pfe_offres_12000.csv")
    add_bullet(pdf, "data/processed/final_baseline_eval_report.json")

    pdf.ln(4)
    add_p(
        pdf,
        "Fin du bilan. Document généré pour préparation soutenance — aligné sur le code présenté.",
    )

    DESKTOP.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    print(OUT)


if __name__ == "__main__":
    main()
