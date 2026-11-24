# Phase 6 — Angular + Gateway

## Gateway (`api-gateway` :8083)
Route :
```
Path=/api/v1/tests/** → http://127.0.0.1:8005
```
Redémarrer le gateway après changement de `application.properties`.

## Frontend
- Proxy : `/api` → gateway
- Interceptor JWT : `/api/v1/tests/**`
- Service : `src/app/core/services/test-api.service.ts`
- Recruteur : `/recruiter/evaluations` (génération, assign, publish)
- Candidat : `/candidate/tests` (start, chrono, submit, résultats)

## Démarrage local
1. MySQL `test_db` + schema
2. `uvicorn` Test-Service :8005
3. Gateway :8083
4. `ng serve` (proxy.conf.json)
