# Phase 2 — Attribution

## Endpoints
- `POST /api/v1/tests/offres/{offreId}/assign`  
  Body: `{ "candidatureIds": [1,2,3] }`  
  → `PENDING`, `startDeadlineAt = now+48h`, notif `TEST_INVITED:{assignmentId}`
- `GET /api/v1/tests/offres/{offreId}/assignments`

## Règles
- Test doit être `READY` ou déjà `ASSIGNED`
- Candidature doit appartenir à l’offre
- Statut `WITHDRAWN` refusé
- Idempotent si déjà assigné
- Après 1ʳᵉ invitation : test passe à `ASSIGNED` (plus de regenerate)

## Notifications
Insert best-effort dans `user_db.notifications` (pas d’API POST User-Service).  
L’échec notif **ne bloque pas** l’assignment.
