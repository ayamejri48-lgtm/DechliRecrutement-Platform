# Architecture frontend — étape 1

- `src/main.ts` : démarre Angular, fournit le routeur et HttpClient.
- `src/app/app.component.ts` : composant racine minimal avec `router-outlet`.
- `src/app/app.routes.ts` : routes lazy-loaded, accueil redirigé vers `/signup`.
- `src/app/features/auth/signup/` : interface, styles et logique du formulaire d’inscription.
- `src/app/shared/validators/password.validator.ts` : règle de mot de passe partagée et comparaison des mots de passe.
- `src/app/core/services/auth.service.ts` : appels HTTP à Auth-Service.
- `proxy.conf.json` : redirection `/auth` vers la Gateway 8083 (développement seulement).

## Étape suivante
Ajouter Login, Forgot Password et Reset Password après vérification des DTO et de la sécurité du backend. Aucun stockage JWT n’a été ajouté dans cette étape.

## Vérification
`npm install --legacy-peer-deps`, puis `npm run build` et `npm start`.
