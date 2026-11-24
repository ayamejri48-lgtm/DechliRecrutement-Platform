# QA manuelle — Test-Service

## Prérequis
- Test-Service `:8005` (health OK)
- Gateway `:8083`
- Front : `npm start` (proxy `/api`)
- Offre + User + Auth up

## Recruteur (Roua)
1. `/recruiter/evaluations` — choisir une offre
2. Générer le test → statut READY
3. Inviter un candidat (nom visible)
4. Après submit candidat → Corriger si besoin → Publier

## Candidat (Yasmine)
1. Sidebar **Tests techniques** (icône + shell visible)
2. Notif invitation → démarre le test
3. Répondre, chrono, soumettre
4. Notif résultats → voir le score

## Groq (état final)
- `.env` : `LLM_PROVIDER=groq` + `GROQ_API_KEY=gsk_...` → health doit montrer `"llmProvider":"groq"`
- Les tests **anciens** (mock) restent figés — **régénérer / générer une nouvelle offre** pour des questions réelles
- Exemple prêt : offre **#20 Développeur Full Stack Java / Angular** (généré Groq, invitation Yasmine)
- Après submit : pas de préfixe `[MOCK]` dans questions / feedback ; scores ouverts = vraie note LLM
