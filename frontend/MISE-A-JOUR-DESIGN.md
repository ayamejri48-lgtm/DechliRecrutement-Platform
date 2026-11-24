# DechliRecrutement — version frontend (design candidat)

Cette archive repart du frontend livré précédemment. Les changements concernent les vues HTML, les feuilles SCSS, les illustrations et des styles intégrés à la vue de détail d'offre. **Aucun code métier TypeScript, appel API, guard, interceptor, route ou backend n'a été modifié.**

## Modifications
- Dashboard candidat : barre latérale, cloche, bannière illustrée, statistiques, offres récentes, carte de profil et accès rapides redessinés.
- Offres d'emploi : suppression visuelle de la colonne secondaire pour afficher des cartes d'offres plus larges.
- Mes candidatures, Mon CV et Mon profil : harmonisation des styles avec la charte de la maquette.
- Détail de l'offre et modale Postuler : harmonisation des couleurs, bordures et espacements.

La bannière du dashboard utilise un recadrage de la capture de référence fournie. Les informations restent dynamiques. Le pourcentage de complétion n'est **pas inventé** : le cercle affiche un tiret jusqu'à disponibilité d'un calcul réel.

## Vérifications
- Vérification TypeScript et templates Angular via `ngc --noEmit` : OK, avertissement existant `RouterLink` non utilisé dans `AccountComponent`.
- Build complet non confirmé dans l'environnement de livraison : les dépendances installées ici contiennent un binaire esbuild Windows incompatible avec Linux. Faire `npm install --legacy-peer-deps`, puis `npx ng build` sous Windows.
- Vérifier visuellement à la résolution de la maquette et sur mobile, puis les parcours métiers avec le backend en fonctionnement.

## Démarrage
```
npm install --legacy-peer-deps
npx ng serve --proxy-config proxy.conf.json
```
