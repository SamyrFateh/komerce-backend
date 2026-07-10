# tests/e2e/authenticated/

Convention pour les specs E2E nécessitant une **vraie session** (compte de
test dédié + `storageState`), séparées des tests publics.

## Pourquoi ce dossier existe

Les flows suivants nécessitent une identité connue côté backend (cookie
`kmrc_jwt` posé après OTP — voir `js/b-identity.js`) :

- wallet (solde, historique réel, débit) ;
- commandes personnelles ;
- groupe privé (au-delà du "charge sans crash" déjà couvert en public) ;
- checkout identifié (si applicable).

Automatiser un vrai flow OTP dans **chaque** test serait lent, fragile (SMS
réel) et risquerait de solliciter un compte réel. La convention Playwright
adoptée ici est donc :

1. `tests/e2e/auth.setup.js` s'exécute une fois (projet `setup`), authentifie
   un **compte de test dédié** (jamais un compte personnel) et sauvegarde la
   session dans `playwright/.auth/user.json`.
2. Le projet `authenticated` (voir `playwright.config.js`) dépend de `setup`
   et injecte ce `storageState` dans chaque test — la session existe déjà,
   pas de re-login.
3. Seuls les fichiers `tests/e2e/authenticated/*.spec.js` sont exécutés par
   ce projet.

## État actuel

Ce dossier est un **scaffold** : aucun test n'y a encore été déplacé/écrit.
Les specs existantes (`wallet.spec.js`, `group.spec.js`, `tracking.spec.js`)
testent aujourd'hui volontairement des **états publics/sans session** (ex.
`E10 — Wallet 401 sans session → gate d'identification`) et doivent le rester
dans `tests/e2e/`. Si de nouveaux tests exigent une session réelle et des
données spécifiques au compte (solde wallet réel, historique de commandes,
etc.), les écrire ici plutôt que dans les specs publics.

## Ce qu'il ne faut jamais faire ici

- Déclencher une commande, un paiement ou un débit wallet réel en production.
- Utiliser un compte personnel ou un OTP de production.
- Committer `playwright/.auth/*.json` (déjà exclu via `.gitignore`).

Les flows destructifs/financiers doivent tourner contre **staging** ou avec
des mocks réseau déterministes (voir `blockAllApi`/`hangAllApi` dans
`tests/e2e/helpers/boutique.helpers.js`), jamais contre la production
publique avec de vraies données.
