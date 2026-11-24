# DechliRecrutement

Frontend Angular — design turquoise/ivoire.

## Démarrage

```bash
npm install --legacy-peer-deps
npm start
```

API Gateway attendue sur `http://localhost:8083`.

## Authentification

- Access token et refresh token conservés uniquement en mémoire (pas de localStorage).
- Interceptor : JWT sur les API internes protégées et renouvellement automatique **une seule fois** après une réponse 401.
- Les requêtes concurrentes partagent le même appel de refresh.
- Sur un rechargement de page, une reconnexion est nécessaire (choix de sécurité tant qu'aucun cookie HttpOnly n'est implémenté côté backend).
- Le backend reste responsable de toutes les permissions.

## Limites

Les dashboards métiers et les intégrations fonctionnelles User/Offre seront développés dans les étapes suivantes. Le proxy est préparé pour ces API.
