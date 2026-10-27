# KOMERCE R&D — généralisation du détecteur de contradictions sur P1–P7
Date : 27 octobre 2026

**Statut : prototype d'oracle pur, NON certification globale, NON correctif métier.** Base de processus : `docs/doctrine/KOMERCE_CARTOGRAPHIE_PROCESSUS_P1_P7.md` et `docs/recette/RCT1_GOLDEN_P1_P7_CONVERGENCE_20261021.md`. Les noms P1 à P7 ne sont pas redéfinis ici. La recherche conserve l'approche économie de tokens / petites preuves reproductibles.

## Objectif
La paire Golden « PO regroupée / PO historique » a démontré la méthode sur P3↔P4, mais **ce n'est pas l'objectif final**. Transformer les 7 processus et leurs interactions en points de comparaison exploitables par le scanner d'anomalies, puis prouver chaque signal par nominal + perturbation sur vrais propriétaires. Scanner le code et trouver des divergences ne constitue ni certification E2E ni acceptation métier.

## Plan de raccordement, sans moteur métier parallèle

Le prototype `scripts/research/p1-p7-boundary-oracle.js` contient un manifeste de 13 frontières (P7→P1 prix et exposition ; P7→P2 checkout ; P1→P2 SKU vendable ; P2→P3 besoin d'achat ; P3→P4 réception Hub ; P4→P2 remise ; P5→P2 paiement et clôture ; P3→P6 achat réel ; P4→P6 fret/douane ; P5→P6 flux argent ; P6→P1 revue humaine avant prix ; P7→P5 règlement pays). Il ne décide **jamais** lui-même du paiement, stock, couverture, fiscalité ou prix. Ces décisions appartiennent aux services existants, lus par de petits adaptateurs explicites.

Il vérifie uniquement les contradictions transversales **déjà observées** :
1. un propriétaire canonique a `BLOCKED` alors que le consommateur affirme `PROVED` ;
2. deux projections déclarent la même identité *au même grain* (SKU, order_item, purchase_line, order, marché) mais portent des IDs contradictoires ;
3. les identifiants ou preuves manquent : `EVIDENCE_GAP`, jamais un PASS ;
4. aucune lecture propriétaire installée : `NOT_WIRED`, explicitement compté ;
5. toutes les fixtures purement nominales correspondent : `NO_CONTRADICTION_OBSERVED`, **pas** une certification.

**Exceptions doctrinales :** les PO regroupées relient la commande par `purchase_lines.order_item_id` ; les colis partagés par `parcel_items.order_item_id`. Ne **jamais** exiger un `order_id` unique sur leur en-tête ou une égalité de `parcels.order_id` entre toutes les commandes. `P6→P1` signifie revue humaine, pas changement automatique de prix. `P7` est transversal, pas une dernière étape linéaire. `UNKNOWN`, `0`, `NOT_APPLICABLE`, `simulé` ne sont pas interchangeables.

## Niveaux de preuve à afficher à côté de chaque frontière

- `NOT_WIRED` : aucun adaptateur vers le service propriétaire ;
- `EVIDENCE_GAP` : propriétaire non prouvé ou information de liaison manquante ;
- `CONTRADICTION_HYPOTHESIS` : deux observations incompatibles, à instruire ;
- `REPRODUCED_PG` : vrai PostgreSQL avec test nominal, écart, retour à l'état initial prouvé ;
- `CONFIRMED_BUG` : violation de l'invariant métier validé par un second oracle indépendant, avec cause identifiée ;
- `FIXED_VERIFIED` : correctif minimal revérifié ;
- `BUSINESS_ACCEPTED` : recette écrans et parcours réels par marché, distincte des précédents.

Les derniers statuts sont **hors du prototype** : ils exigent des preuves réelles, un lien CI et un objet connu. Ne jamais les déduire de l'oracle pur.

## Ordre de travail

A. **Inventaire du dépôt et propriétaires** : reprendre `npm run audit:logic`, Feature Cards, graphe de dépendances et les rapports écriture inter-domaines. Matrice par transition/owner/table/état + périmètre explicitement non couvert. Les règles LS/LD historiques restent des suspicions, non des bugs.

B. **Raccordements read-only des 13 frontières** : les premières passerelles disponibles sont `golden-upstream-evidence`, `golden-checkout-thread`, `golden-e2e-cockpit`, `golden-identity-trail`, `order-financial-closure-reconciliation` ; P5, P6, P7 exigent en plus leurs propres lecteurs et preuves de portée. Tous les adaptateurs doivent conserver marché/rôle/version/SHA.

C. **Cas contradictoires indépendants** : injection nominale puis négative dans une base PostgreSQL jetable par domaine : mauvaise unité, mauvais marché, état impossible, double écriture/replay, couverture quantitative, preuve financière manquante, faux GO sur prix/exposition. Toujours `BEGIN/ROLLBACK` pour les sondes autorisées ; mock externe uniquement.

D. **Campagne KM, CM, CG, DJ** : aucune adaptation implicite de destination, devise, transport, fournisseur, habilitation ou preuve marché. Vérifier P7 readiness avec P1/P2/P5 ; 8 dashboards sur Chromium desktop/mobile en lecture seule après version SHA vérifiée. Données démo permanentes distinctes des transactions RCT1 temporaires.

E. **Bilan qualité du détecteur** : vrais positifs / faux positifs / non détectés, sensibilité selon mutation ; classer `SUSPICION`, `NOT_PROVEN`, `REPRODUCED`, `CONFIRMED`. Une CI verte ne vaut jamais GO métier.

## Situation actuelle et sorties attendues

- **P3↔P4 étalonnage réel existant** : run #40495565489, deux Goldens verts ; réception Hub historique `pending` acceptée quand la regroupée `draft` est en quarantaine. Issue #3057, arbitrage owner requis.
- **Autres frontières** : ce prototype montre les règles proposées et la mécanique d'évaluation, **sans preuve PostgreSQL P1–P7**.
- Aucune PR métier, aucune modification de `main`, Railway, base staging/production, secrets, fournisseurs ni paiements réels.

Ne pas transformer le prototype en nouveau Golden ou en nouvel outil d'administration. Le niveau de preuve et le prochain adaptateur doivent rester mesurables et traçables.
