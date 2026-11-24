# AUDIT_FINAL — DechliRecrutement AI-Service

**Date :** 2026-11-02 (mise à jour v1.2)  
**Périmètre modifié :** uniquement `dechli-ai-service` (Python + FastAPI)  
**Services externes :** lecture seule — **aucune modification** Auth / User / Offre / Gateway / Angular

---

## 1. Synthèse

AI-Service **v1.2.0** : extraction NLP v3 (lexique élargi + sections Skills), matching hybride v3 (`scoreBand`, garde-fous required skills, `/match/batch`), fiabilité (request-id, logs sans PII, PDF content-type / encrypted), sécurité (clé ≥16 chars), tests **26 passed**.

Plan P0 d’intégration Spring/Angular : `docs/INTEGRATION_PLAN_P0.md` — **en attente d’autorisation**, non appliqué.

---

## 2. Améliorations v1.2 (cette itération)

| Zone | Changement |
|------|------------|
| NLP | Lexique dédié `skills_lexicon.py`, détection section Skills/Compétences, `normalize_skills()`, méthode `rule-based-nlp-v3` |
| Matching | `scoreBand` low/medium/high, plafond si required manquants, echo `cvId`/`candidatureId`, `POST /api/v1/match/batch` |
| Fiabilité | Middleware `X-Request-Id`, logs path/status/latency sans corps, handler 500 générique, health `supervisedModelLoaded` |
| Sécurité | Clé interne min 16 caractères ; content-type PDF ; PDF chiffré refusé |
| Docs | `INTEGRATION_PLAN_P0.md` (orchestration via Offre-Service existant, sans nouveau MS) |

---

## 3. Mesures réelles exécutées

### Tests automatisés

```powershell
$env:AI_SEMANTIC_BACKEND="tfidf"
python -m pytest -q
```

**Résultat : 26 passed** (~26 s).

### Couverture compétences (échantillon 500, post-v3)

| Corpus | Hit rate skills | Avg skills / doc |
|--------|-----------------|------------------|
| CV | **0.904** (avant v2 sample: 0.238) | 3.15 |
| Offres | **0.878** (avant: 0.506) | 3.598 |

*Amélioration due au lexique élargi + sections Skills. Toujours rule-based : pas une NER entraînée. Précision fine non mesurée sur gold labels humains.*

### CRISP-DM (inchangé depuis run précédent)

- Clean 12k CV / 12k offres : exécuté (`cleaning_report.json`)
- Annotations candidates 200 : générées (weak labels ≠ gold)
- Train supervisé métier : **non** (pas de labels humains)

### Matching (rappel mesures)

| Cas | Score |
|-----|-------|
| AI Engineer vs Data Engineer (required manquants) | ~0.17 → band **low** |
| Overlap skills ML fort | ≥0.7 → band **high** |
| ST cosine skills divergents / overlap | 0.11 / 0.87 (run antérieur) |

---

## 4. API v1.2

| Méthode | Path | Notes |
|---------|------|-------|
| GET | `/health` | + `supervisedModelLoaded` |
| POST | `/api/v1/extract/*` | NLP v3 |
| POST | `/api/v1/extract/cv/pdf` | validation renforcée |
| POST | `/api/v1/match` | + `scoreBand`, ids |
| POST | `/api/v1/match/batch` | ranking ≤50 |
| POST | `/api/v1/match/ml` | 503 si pas de modèle |

Auth : `X-Internal-Api-Key` si `AI_INTERNAL_API_KEY` défini.

---

## 5. Compatibilité plateforme (read-only)

| Composant | État |
|-----------|------|
| Offre-Service `cvId` + PDF candidature | Prêt comme ancrage P0 |
| Matching-Service Spring | Absent |
| Gateway AI | Absent (volontaire pour P0) |
| Angular Matching | Placeholder |
| Intégration E2E | **Non validée / non déployée** |

---

## 6. Limites restantes

1. Pas d’orchestration ni persistance score (hors AI-Service — plan P0 prêt).
2. Pas de gold labels → pas de modèle supervisé métier.
3. Hit rate ≠ précision : besoin d’annotation humaine pour F1.
4. Pas d’OCR ; aliases peuvent sur-détecter des termes génériques (excel, communication).
5. Batch ranking relatif au sous-ensemble fourni uniquement.

---

## 7. Prochaine étape (après ton OK)

Appliquer `docs/INTEGRATION_PLAN_P0.md` sur Offre-Service + Angular uniquement avec ton autorisation explicite.
