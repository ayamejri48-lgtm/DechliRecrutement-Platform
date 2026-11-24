# Phase 4 — Notation des questions ouvertes (LLM)

## Flux
1. Submit (Phase 3) → `SUBMITTED` + score QCM
2. Job async → `EVALUATING` → LLM note les OPEN via grille → `EVALUATED`
3. `score_open` + `score_total` + `evaluation_json` + feedback par réponse
4. Publication candidat = **Phase 5** (scores masqués côté candidat jusqu’à `PUBLISHED`)

## Endpoints
- Auto au `POST .../submit` (BackgroundTasks)
- `POST /api/v1/tests/assignments/{id}/evaluate` (recruteur, retry)
- `GET /api/v1/tests/assignments/{id}` (recruteur, détail + scores)
- Sweep timers ops / scheduler : évalue aussi les `SUBMITTED` / `EVALUATING`

## Mock
`LLM_PROVIDER=mock` → ~70 % du max si réponse non vide, 0 sinon.
