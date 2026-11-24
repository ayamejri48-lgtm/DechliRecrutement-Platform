# DechliRecrutement — livraison frontend candidat

## Contenu
- Tableau de bord candidat : accueil personnalisé, statistiques, offres récentes, accès rapides, notifications.
- Mes candidatures : statistiques, recherche, filtre de statut, consultation de l'offre et retrait selon statut.
- Offres d'emploi : recherche, filtres, pagination, affichage liste/grille et correction de rafraîchissement Angular après les requêtes.
- Détail de l'offre : présentation, modal de candidature, choix du CV actif, protection contre les doubles clics.
- Mon CV : import PDF, glisser-déposer, liste, prévisualisation, téléchargement, activation d'un CV.
- Mon profil : fonctionnalités existantes conservées ; aperçu du CV actif corrigé.
- Auth, recruteur et administrateur : fichiers conservés.

## Installation sous Windows
1. Extraire le ZIP.
2. Ouvrir un terminal dans `dechli-recrutement`.
3. `npm install --legacy-peer-deps`
4. `npm start` (nécessite API Gateway et microservices opérationnels).
5. Ouvrir http://localhost:4200.

## Contrôles effectués
- Vérification TypeScript (`tsc --noEmit`) : OK.
- Compilation Angular des templates (`ngc`) : OK, avec avertissement préexistant RouterLink inutilisé dans AccountComponent.
- Build Angular complet non validé dans cet environnement Linux : le ZIP d'origine contient les binaires esbuild Windows.
- Tests d'intégration avec microservices et comparaisons pixel à pixel avec les maquettes : non exécutés.

## Points de vigilance
- Les limites d'import PDF (5 Mo dans l'interface) doivent être alignées avec la configuration réelle du User-Service.
- Les statuts de candidature proviennent du backend (PENDING, UNDER_REVIEW, ACCEPTED, REJECTED, WITHDRAWN).
- Le suivi détaillé en plusieurs étapes n'est pas simulé : seul le statut réel est affiché.
- Les informations sur les offres dans Mes candidatures peuvent apparaître sous forme d'identifiant si l'API `/offres` ne donne pas accès à l'offre concernée.
- La protection contre les doublons côté frontend ne remplace pas la validation côté backend.
- Les maquettes de référence ne sont pas fournies comme assets éditables ; une validation visuelle avec captures d'écran reste nécessaire pour garantir une fidélité stricte.
- Aucun ZIP backend n'a été modifié.
