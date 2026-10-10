# Komerce — readiness de la contre-recette fonctionnelle des dashboards

**Cible :** `KOMERCE_CONTRE_RECETTE_FONCTIONNELLE.md` V1 (51 scénarios) · GAP `docs/audits/BACKOFFICE_CANONICAL_GAP.md`
**SHA examiné :** `main` = `10c5b0daa` (arbre identique à `a2891ef98`, diff vide)
**Méthode :** lectures ciblées, aucune modification de code. Preuves réutilisées :

- Playwright officiel (`playwright.config.js`, 16 specs, API simulée) : **147/147 verts**, exécutés le 2026-10-11 sur `10c5b0daa`.
- Unit + « From-scratch DB + integration + E2E API » : **verts en CI** sur `a2891ef98` (Required verdict = success).

Tout ce qui n'est pas couvert par ces deux preuves est marqué **NON PROUVÉ**.

---

## 1. Verdict

**NOT READY.**

Le verdict ne serait fiable sur aucun des points P0/P1 qui touchent à la vérité des chiffres.

- Des cas critiques n'ont pas de données pour les tester :
  - P-01 (commandes actives, L1 P0) ;
  - C-09, P-03, F-01 et F-02 (marge, coûts, devises) ;
  - P-02 et A-01 (signaux, L6 P1).
- Il n'existe ni environnement de recette prouvé, ni comptes, ni SHA déployé lisible.

Le delta pour devenir **READY WITH CONDITIONS** est petit (§5) : un script de seed existant à étendre, une ligne pour exposer le SHA, des comptes créés via l'API existante, et deux scénarios à déclarer hors périmètre.

## 2. Couverture

| Catégorie | Nombre | Scénarios |
|---|---|---|
| **Automatisés** (invariant prouvé par un test existant **exécuté et vert**) | **27/51** | C-04, C-08, C-10, C-11, P-04, A-02, A-03, A-04, M-03, O-01, O-04, O-05, L-01 à L-10, N-01, N-03, N-04, N-05, U-02 |
| **Manuels** (exécutables une fois l'environnement et les comptes fournis, données obtenables par les scripts existants) | **15/51** | C-01, C-02, C-03, C-05, C-06, C-07, C-12, A-05, M-01, M-02, O-02, O-03, F-03, N-02, U-03 |
| **Bloqués** | **9/51** | C-09, P-01, P-02, P-03, A-01, F-01, F-02, N-06, U-01 |
| **Exécutables** (automatisés + manuels, sous les conditions du §6) | **42/51** | — |

Un test automatisé ne remplace pas la confrontation sur données réelles.

- Les specs Playwright tournent sur une **API simulée** : elles prouvent le comportement de l'écran (navigation, retour contextuel, gating du menu, états), pas la justesse d'un chiffre.
- La justesse des chiffres est prouvée côté service par les tests unitaires des lots L1, L5, L6 et L7, et par l'e2e-api `dashboard.control-chain-golden` sur base reconstruite.

Pour les 27 automatisés, la recette se limite donc à une confirmation sur le jeu de données de recette, sans rejouer les tests.

Correspondance entre scénarios et preuves :

| Scénarios | Preuve existante |
|---|---|
| C-08, A-02, P-04, O-05 | `context-return-links`, `b9-ui-truth-paths` |
| C-10, N-01, N-03 | `dashboard-role-matrix` (8 rôles), `admin-menu-navigation` ; refus côté serveur prouvé par les e2e-api `market-delegation.*` |
| C-11 | `layout-canon-conformance` |
| O-01 | `operations-control-board` (files Cash à confirmer et Colis à créer → Order 360) |
| O-04 | `bootstrap-html-routes.test.js` (L3) |
| A-03, A-04 | `action-center*.test.js`, `signal-admin-service.test.js` (L6, D3 appliqué : note obligatoire, pas de « Résolu » sur les types auto-fermés) |
| L-01 à L-09 | `live-kit`, `live-projection`, `hub-dashboard-*`, `relay-dashboard-queries` (L5 : heure serveur, état périmé, écouteurs uniques, pause en onglet masqué, erreurs KPI, `in_transit`, projection sans contact, expédiées via l'historique, `is_urgent` serveur) |
| L-10 | `operations-relay-projection.test.js` (L7, D4 appliqué : `operations-workspace` est le propriétaire) |
| N-04 | `b9` (référence résolue par le serveur) |
| N-05 | `canonical-market-access.test.js` (L8a/L8b) |
| U-02 | tests du lot L10 « finitions Hero » (#2389) |

## 3. Prérequis manquants

| ID | Blocage | Preuve | Correction minimale | Responsable |
|---|---|---|---|---|
| R-01 | **F01 incomplet** : il manque `pending` et `ordered` | `scripts/seed-market-test-data.js:69-76` ne génère que 8 des 10 statuts de `services/order-status-machine.js:88-97` | Ajouter `pending` et `ordered` aux poids du seed | Sonnet |
| R-02 | **Aucun oracle indépendant de l'interface** | Le seed n'écrit aucun manifeste ; seul `audit-canonical-dashboards-staging.js` porte une assertion exacte (`supplier_payment_blocked`) | En fin de seed, émettre un manifeste JSON : fixture, marché, période, devise, comptes par statut, cash en attente, colis par état. Ce manifeste devient la valeur attendue | Sonnet |
| R-03 | **F04 absent** (signaux par sévérité, marché, auto ou manuel) | Aucun script de seed de signaux ; le seul insert de signal est dans le script d'audit (1 signal) | Option `--signals` du même seed : quelques signaux critiques, avertissements, auto-résolus et manuels sur 2 marchés, taggés pour le nettoyage | Sonnet |
| R-04 | **F03 et F08 absents** (coûts partiels, multidevise) | Le seed ne touche aucune composante de coût ; aucune fixture de coûts | Option `--costs partial|complete` sur le même seed pour les produits des commandes seedées. F08 : jouer le seed sur KM (KMF) et CM (XAF) ; EUR sans marché seedable → **N/A justifié** | Sonnet |
| R-05 | **SHA déployé illisible** | `routes/health.js:254` lit `GIT_SHA`, qui n'est défini nulle part dans le dépôt. La route renvoie `local` sauf variable posée à la main | Lire `GIT_SHA \|\| RAILWAY_GIT_COMMIT_SHA` (1 ligne + test). À défaut, relever le SHA sur la page de déploiement Railway | Sonnet |
| R-06 | **Environnement de recette non prouvé** | Les scripts `*-staging` existent ; leur accès et leur isolation ne sont pas démontrables d'ici | Désigner l'URL staging, confirmer `KOMERCE_ENV≠production` et autoriser seed et cleanup (`--cleanup`, `cleanup-e2e-staging.js`) | Propriétaire |
| R-07 | **Comptes de test inexistants** | Aucun seed de comptes. Moyens existants : `scripts/provision-market-operator.js`, `POST /api/admin/users`, `PUT /users/:id/role`, `POST /users/:id/market-scopes` (`routes/admin/users.js`), capacités par membre via l'écran Équipe | Créer : admin, `market_operator` A avec et sans `finance.read`, `market_operator` B, `agent_hub`, `agent_relais`, `finance`. Consigner identifiants **hors dépôt** | Propriétaire, ou Sonnet sur staging |
| R-08 | **N-06** : L9 n'est livré qu'en étape 1 ; D6 et D7 ne sont pas tranchés | #2388 « L9 étape 1 » ; GAP §12 D6/D7 | Déclarer N-06 **hors périmètre** de cette recette, ou trancher D6/D7 | Propriétaire |
| R-09 | **U-01** : pas de référence visuelle ; L10 « fusion CSS » non livré (seules les finitions Hero l'ont été) | Règle Prod décidée : aucune baseline avant fusion du thème ; #2389 = finitions | Déclarer U-01 **hors périmètre** jusqu'à la fusion CSS | Propriétaire |

Hors recette, mais constaté : le workflow `push` « Refresh Railway schema → SCHEMA.md » échoue sur `10c5b0daa` (ligne vide en fin de `docs/SCHEMA.md` générée par le workflow lui-même). Il n'y a aucun impact sur les dashboards.

## 4. Angles morts critiques démontrés

1. **La vérité des KPI se mesure contre le service qui les produit.** Comparer l'écran à l'API propriétaire prouve que l'écran est fidèle, pas que le chiffre est juste. Sans le manifeste R-02, P-01, O-02 et F-02 ne peuvent pas détecter une erreur commune au service et à l'écran.
2. **Playwright tourne sur API simulée.** Aucun des 147 tests ne touche une base : C-03 (fuite inter-marchés) et C-10 en HTTP réel restent à jouer en manuel avec F05. F05 s'obtient avec le seed sur 2 marchés et les comptes R-07.
3. **Responsive.** Les specs couvrent 1280, 1024 et mobile, plus une capture à 1672. **1440 n'est couvert nulle part** : C-06 reste manuel.

## 5. Instructions pour Sonnet

Un seul lot, une PR, sans nouveau framework :

1. **`scripts/seed-market-test-data.js`** (R-01 à R-04) :
   - ajouter `pending` et `ordered` ;
   - ajouter les options `--signals` et `--costs partial|complete` ;
   - écrire un manifeste JSON d'oracle sur stdout ou dans un fichier hors dépôt ;
   - conserver le garde non-production existant et l'étendre à `--cleanup` ;
   - fournir des tests unitaires du manifeste et des gardes.
2. **`routes/health.js:254`** (R-05) : `commit: process.env.GIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || 'local'`, avec un test.
3. Aucune autre modification. Ne pas toucher aux écrans, aux tests Playwright ni aux paiements. `pr:preflight` vert, puis PR et merge autonome (aucune migration).

## 6. Conditions objectives de démarrage

La recette peut démarrer lorsque **toutes** les conditions suivantes sont vraies :

- [ ] R-01 à R-05 mergés sur `main`, Required verdict vert.
- [ ] `GET /health/version` sur staging renvoie le SHA de recette, égal au HEAD de `main` gelé.
- [ ] R-06 : staging désigné, non-production confirmé, seed et cleanup autorisés.
- [ ] R-07 : comptes créés et connexion testée pour chaque rôle.
- [ ] Seed joué sur 2 marchés (KM, CM) ; manifeste conservé avec le snapshot UTC.
- [ ] R-08 et R-09 : N-06 et U-01 déclarés hors périmètre par écrit, ou D6, D7 et la fusion CSS tranchés.
- [ ] Suite Playwright verte sur le SHA de recette. Elle n'est relancée que si le SHA diffère de `10c5b0daa`.

Une fois ces conditions remplies : **49/51 scénarios exécutables** (27 automatisés à confirmer, 22 manuels), 2 hors périmètre justifiés.

---

**Réponse à la question posée.** *Pouvons-nous lancer les 51 scénarios et obtenir un verdict métier fiable, indépendant et reproductible ?*

**Non, pas aujourd'hui.**

- Les comportements d'écran sont déjà prouvés : 27 scénarios automatisés, verts.
- Il manque les données qui exercent les chiffres critiques (F01 complet, F03, F04, F08), un oracle indépendant du service (manifeste), un SHA déployé lisible, l'environnement et les comptes.

Le delta minimal : R-01 à R-05 en un lot Sonnet, R-06 et R-07 côté propriétaire, R-08 et R-09 par décision écrite.
