# Phase 1 — Génération de test (LLM)

## Endpoints
- `POST /api/v1/tests/offres/{offreId}/generate` → 202, job async
- `POST /api/v1/tests/offres/{offreId}/regenerate` → 202, 1× max si READY/FAILED et 0 assignment
- `GET  /api/v1/tests/offres/{offreId}` → test + 13 questions (correctOption visible recruteur)

## Comportement
1. Lit offre + skills via Offre-Service (JWT forward)
2. Mappe `experienceYears` → difficulté / durée
3. LLM (`LLM_PROVIDER=groq|mock`) → JSON
4. Validation Python stricte (10 QCM × 3 options, 3 ouvertes)
5. Persist → `READY` (ou `FAILED` + errorMessage)

## Config
```env
LLM_PROVIDER=mock   # sans clé
# ou
LLM_PROVIDER=groq
GROQ_API_KEY=...
```
