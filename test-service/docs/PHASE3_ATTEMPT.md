# Phase 3 — Passage du test

## Endpoints candidat
- `GET /api/v1/tests/me/assignments`
- `GET /api/v1/tests/assignments/{id}/paper` (sans bonnes réponses)
- `POST /api/v1/tests/assignments/{id}/start`
- `PUT /api/v1/tests/assignments/{id}/answers`
- `POST /api/v1/tests/assignments/{id}/submit`
- `POST /api/v1/tests/assignments/{id}/incidents` `{ "type": "TAB_BLUR"|"EXIT_FULLSCREEN" }`
  - Réponse : `{ incidentCount, limit, blocked }` — si `blocked=true` (seuil 3), soumission forcée

## Ops
- `POST /api/v1/tests/ops/sweep-timers` (+ clé interne optionnelle)
- Scheduler daemon toutes les 30 s : expire 48 h / autosubmit fin de chrono

## Règles
- Chrono = `started_at` + `duration_sec` serveur
- Autosave seulement en `IN_PROGRESS`
- Submit → `SUBMITTED` + score QCM Python (ouvertes = Phase 4)
