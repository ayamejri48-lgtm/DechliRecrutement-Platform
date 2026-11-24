# DechliRecrutement — AI-Service (PFE)

**Local / gratuit.** Python FastAPI **v1.3.1** (version jury).  
Chemin officiel : extract **rules** + match **hybrid-v3**. Ollama / ML = optionnels.  
Livrable : `docs/FINAL_DELIVERY_AI_MATCHING.md` · Démo : `docs/JURY_DEMO.md`

## Démarrage rapide (jury)
```powershell
.\scripts\start_demo.ps1
```
Swagger : http://127.0.0.1:8000/docs — santé : http://127.0.0.1:8000/health

## Démarrage Windows PowerShell (manuel)
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:AI_INTERNAL_API_KEY="change-me"
$env:AI_EXTRACT_BACKEND="rules"          # défaut recommandé
$env:AI_SEMANTIC_BACKEND="tfidf"         # ou auto|st
python -m uvicorn app.main:app --reload --port 8000
```
API Swagger : http://localhost:8000/docs — santé : http://localhost:8000/health

Header interne (si `AI_INTERNAL_API_KEY` est défini) : `X-Internal-Api-Key`.

## Tests
```powershell
$env:AI_SEMANTIC_BACKEND="tfidf"
python -m pytest -q
```

## Données et CRISP-DM
Copier `pfe_cv_12000.csv` et `pfe_offres_12000.csv` dans `data/raw/` (ne pas modifier les originaux).
```powershell
python scripts/01_clean.py --cv data/raw/pfe_cv_12000.csv --offres data/raw/pfe_offres_12000.csv
python scripts/02_extract.py --limit 500
python scripts/04_prepare_annotations.py --pairs 200
```
Les variantes d’un même CV partagent `parent_id` : le split d’entraînement regroupe par `parent_id`.

## API
- `POST /api/v1/extract/cv` : texte → skills, expérience, formation, specialty, evidence
- `POST /api/v1/extract/offer` : idem
- `POST /api/v1/extract/cv/pdf` : PDF multipart (texte extractible, max 10 Mo / 30 pages)
- `POST /api/v1/match` : matching hybride explicable (score [0,1] ou null, `scoreBand`, echo `cvId`/`candidatureId`)
- `POST /api/v1/match/batch` : ranking jusqu’à 50 candidats vs une offre
- `POST /api/v1/match/ml` : modèle local entraîné, **503** si absent

Exemple match :
```json
{
  "candidate": {"skills":["Python","SQL"],"experienceYears":3,"education":"master","title":"Data Engineer"},
  "offer": {"skills":["Python","PyTorch","NLP"],"requiredSkills":["PyTorch","NLP"],"experienceYears":2,"education":"master","title":"AI Engineer"},
  "cvId": "42",
  "candidatureId": "1001"
}
```
Les `requiredSkills` viennent du métier ; **non inférées** comme obligatoires depuis une description.

## Annotations et entraînement supervisé
`04_prepare_annotations.py` produit des candidats d’annotation avec `weak_label_score` (**pas** une vérité terrain). Remplir `label_score` + `label_source=human_*` avant train.
```powershell
python scripts/03_train.py --annotations data/processed/annotated_pairs.csv
```
Sans labels humains fiables, le train est refusé (sauf `--allow-weak-labels` démo expérimentale).

## Intégration plateforme
Voir `docs/INTEGRATION_CONTRACTS.md`, `docs/INTEGRATION_PLAN_P0.md` et `AUDIT_FINAL.md`.  
AI-Service est conçu pour être appelé par Spring (pas par Angular). **Aucune intégration Spring/Angular n’est appliquée sans ton autorisation.**

## Limites
- NLP dictionnaire + regex : mesurer précision/rappel sur annotations humaines.
- Score = aide à la décision recruteur, pas une probabilité d’embauche.
- Similarité d’intitulés = signal faible ; AI Engineer ≠ Data Engineer sans overlap de skills.
- Pas d’OCR ; pas de Kafka/Spring câblés dans ce repo.
- Pas de frais d’API externes ; Sentence Transformers tourne en local.
