# Phase 5 — Publication des résultats

## Flux
1. Assignment `EVALUATED` (Phase 4)
2. Recruteur publie → `PUBLISHED` + `published_at`
3. Notif candidat `TEST_PUBLISHED:{assignmentId}`
4. Candidat consulte scores + feedback

## Endpoints recruteur
- `POST /api/v1/tests/assignments/{id}/publish`
- `POST /api/v1/tests/offres/{offreId}/publish-results`  
  Body optionnel : `{ "assignmentIds": [1,2] }` (sinon tous les EVALUATED)

## Endpoint candidat
- `GET /api/v1/tests/me/assignments/{id}/result`  
  → 409 si pas encore `PUBLISHED`

## Règles
- Idempotent si déjà publié
- Scores masqués dans `GET /me/assignments` tant que non publié
