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

## 27/10 — Premiers câbles réellement raccordés

Le manifeste contient 13 frontières. Les **4 premières** sont connectées au même article `order_items.id`, avec un marché sélectionné et une référence de commande explicites :

- P7→P1 prix : `market-control-plane.getControlPlane` face à `resolveActiveProductMarketPricingById`.
- P7→P1 exposition : contrôle du marché face à `catalog-market-exposure-service.getExposure`.
- P7→P2 checkout : contrôle marché/readiness/livrabilité face à `golden-upstream-evidence.projectUpstreamEvidence` et l'identité réelle `orders.market_id`.
- P1→P2 produit/SKU : SKU réel de `product_skus`, gate catalogue existant, exposition `ENABLED` et prix `LOCAL_ACTIVE` face à `order_items` et la preuve d'origine du checkout.

Le lecteur `scripts/research/p1-p7-canonical-collector.js` utilise les services propriétaires sans HTTP storefront, et **sans filtrer la commande par le marché demandé**. Une carte de preuves incomplète, ou deux côtés tous deux `BLOCKED`, donne `EVIDENCE_GAP`, **jamais PASS**. Le gate catalogue `CATALOG_RELEASE_PROVED` est nécessaire pour appeler un SKU vendable ; la seule présence d'un SKU et d'un prix ne suffit pas.

### Preuves exécutées

- [CI ECO #40500266009](https://github.com/SamyrFateh/komerce-backend/actions/runs/40500266009) : 34 tests purs et 60 projections Golden verts au premier raccordement.
- [Double Golden PG #40500271555](https://github.com/SamyrFateh/komerce-backend/actions/runs/40500271555) : deux Goldens complets en PostgreSQL 16 isolé, lecture des 4 nouveaux raccordements sans erreur des propriétaires, verdict final FINANCIAL_CLOSE_MATCHED.
- [Contre-épreuve renforcée #40500645721](https://github.com/SamyrFateh/komerce-backend/actions/runs/40500645721) : 4 frontières observées, **4 EVIDENCE_GAP dans chaque parcours**, 9 NOT_WIRED, zéro lecture en erreur. Ce n'est pas un échec : la fixture Golden construit directement une commande, sans offrir la chaîne réelle de publication/OTP/paiement nécessaire à une certification de vendabilité. L'oracle corrigé n'affiche plus NO_CONTRADICTION_OBSERVED quand les deux propriétaires refusent la preuve.

### Point d'entrée opérable, limité à une base de test locale

Commande (remplacer les quatre identités par des identifiants réellement présents) :

```bash
NODE_ENV=test KOMERCE_DISABLE_CRONS=true DATABASE_URL=postgresql://localhost:5432/komerce_test \
  npm run audit:logic:p1p7 -- --market KM --product UUID_PRODUIT \
  --order-ref REFERENCE_COMMANDE --order-item UUID_LIGNE
```

Exigences : PostgreSQL local `komerce_test` uniquement, un article exact, `REPEATABLE READ READ ONLY`, `ROLLBACK` inconditionnel ; URL Railway et bases non-test interdites. Le script `audit:logic` historique reste inchangé et conserve ses signaux LS/LD. Les 9 autres raccordements ne sont **pas exécutés** ; le compte des processus cartographiés ne signifie pas couverture métier.

**Suite prioritaire** : équiper P2→P3 et P3→P4 avec les identités `order_item_id`, `purchase_line_id`, `hub_allocation_id` et les verdicts de leurs propriétaires, puis P4→P2 et les frontières finance P5/P6. Les scénarios de marché KM/CM/CG/DJ et la recette réelle Chromium demeurent nécessaires.

### Vérification finale du point d’entrée local

[GitHub Actions #40501030224](https://github.com/SamyrFateh/komerce-backend/actions/runs/40501030224) : **40/40 tests purs et 60/60 tests de projections Golden**, y compris les gardes du CLI local, le refus des bases distantes et le ROLLBACK même si un lecteur échoue. Tests du CLI exécutés avec doubles injectés ; l'appel complet aux lecteurs sur PostgreSQL a été vérifié séparément par le double Golden #40500645721. Aucun nouveau bug métier confirmé dans ce lot.

## 27/10 — P2 → P3 → P4 raccordés au vrai PostgreSQL

Deux frontières supplémentaires ont été reliées, **6 / 13 raccordées, 7 encore NOT_WIRED**. Le lecteur est `scripts/research/p2-p4-canonical-collector.js`, intégré à `p1-p7-canonical-collector.js`. Il n'invente aucun moteur d'achat ou de stock :

- **P2 → P3 :** `order_items.id / sku_id` → `purchase_lines.order_item_id / product_sku_id`, PO rattachée, sans exiger `purchase_orders.order_id` sur une PO regroupée. Le paiement client provient de la porte canonique `PAYMENT_FINAL_PROVED`, jamais du seul `orders.payment_status = paid`.
- **P3 → P4 :** `purchase_line_id / product_sku_id` → `hub_purchase_allocations`, `v_purchase_line_progress` (quantité physiquement utilisable), et `hub-inbound-reconciliation.reconcileHubInbound`. Les allocations historiques sans `purchase_line_id` ne sont liées que par **PO ET order_item**. Plusieurs lignes ou fulfillments non résolus produisent des lacunes, pas une première ligne choisie arbitrairement.
- Les contradictions d'identité de SKU, commande/PO, fournisseur, allocation et source sont remontées à l'oracle transversal. Les contrôles réels ne sont pas une preuve de commande/paiement fournisseur externe.
- **Nuance temporelle importante :** `INBOUND_MATCHED` est une preuve de réception historique au Hub ; `v_purchase_line_progress.received_quantity` décrit la quantité utilisable actuelle. Leur différence après mouvement/sortie physique est un **signal de maturité à expliquer**, pas automatiquement un bug.
- **Anti-faux positif synthétique :** la fixture K-GOLDEN est marquée `SYNTHETIC_GOLDEN_CREATE` par le service canonique. Sa porte de paiement non probante est `EVIDENCE_GAP`, pas une violation confirmée d'encaissement.

### Preuves observées

[Run PostgreSQL #40503339530](https://github.com/SamyrFateh/komerce-backend/actions/runs/40503339530) — deux Goldens verts, `6/13` frontières lues, `0` contradiction après qualification de la fixture, `7` frontières non raccordées. Sur les deux formes de PO : **une ligne, une allocation, une fulfillment, `INBOUND_MATCHED`, quantité effective=1 et utilisable=1** ; P3→P4 est `NO_CONTRADICTION_OBSERVED`. P2→P3 est `EVIDENCE_GAP` car le paiement/checkout réel n'est pas certifié par cette fixture synthétique.

[CI ECO #40503339702](https://github.com/SamyrFateh/komerce-backend/actions/runs/40503339702) — tests purs et projections existantes verts, y compris mauvais SKU, mauvaise commande, preuve Hub absente, achat multi-lignes non agrégé et provenance synthétique.

Le comparateur A/B est renforcé : absence identique de ces deux frontières sur les deux parcours, absence d'allocation physique ou de verdict propriétaire `INBOUND_MATCHED` = **échec de comparaison**, pas une fausse équivalence. Aucune mutation de main, Railway, base staging ou partenaire réel.

### Prochaine frontière

**P4 → P2 :** appartenance d'un colis éventuellement partagé à la commande exacte, arrivée relais et scan de remise client. Raccorder `parcel_items.order_item_id`, `scans.order_id / parcel_id` et le propriétaire de la remise. Garder l'exception des colis partagés : `parcels.order_id` n'a pas à correspondre à toutes les commandes transportées.

## 27 octobre — P4 → P2, septième frontière raccordée

Le scanner suit maintenant `P4_P2_RELAY_HANDOFF` grâce aux **lecteurs propriétaires existants** :
- `parcel-order-membership.listParcelsRepresentingOrder` récupère les colis par appartenance réelle. Pour un colis partagé, `parcels.order_id` peut désigner une autre commande porteuse. La preuve est `parcel_items.order_item_id → order_items.order_id`.
- `customer-handoff-reconciliation.reconcileCustomerHandoff` retourne le verdict de remise officiel, et l'observateur vérifie indépendamment `scans.order_id`, `scans.parcel_id`, `scans.pickup_relais_id` par rapport à la commande et au colis.
- Avant scan ou avec remise partielle, `HANDOFF_PENDING` reste `EVIDENCE_GAP`. Si une ancienne commande n'a pas de ligne de colis, un colis d'en-tête peut être présent mais **n'est pas certifié au grain order_item**.
- Les contradictions de scan sur colis étranger, de scan sur un autre relais, de fausse couverture ou de mauvaise commande sont des **hypothèses**, jusqu'à preuve PostgreSQL indépendante.

### Preuve nominale et contre-épreuve

[Run PostgreSQL #40506072944](https://github.com/SamyrFateh/komerce-backend/actions/runs/40506072944) : **86/86 tests purs**, deux Goldens, `7/13` frontières lues, `0` contradiction nominale, `6` non raccordées. `P4_P2_RELAY_HANDOFF = NO_CONTRADICTION_OBSERVED` avec un colis membre, une ligne, un scan et `HANDOFF_MATCHED` sur les deux formes de PO.

**Contre-épreuve vraie PostgreSQL :** créer un autre relais sur le marché, modifier `scans.pickup_relais_id` du scan de retrait vers ce relais dans `BEGIN/ROLLBACK`. Le service canonique retourne encore `HANDOFF_MATCHED` alors que le scanner rapporte `COLLECTION_SCAN_FOREIGN_RELAY`. Retour à l'original vérifié en SQL ; aucune donnée persistée. L'issue [#3062](https://github.com/SamyrFateh/komerce-backend/issues/3062) suit l'arbitrage avec l'owner Logistics / Orders. **Défaut métier à qualifier**, pas une preuve d'incident réel ni une autorisation de modifier le service sans décision sur les transferts exceptionnels de relais.

**Périmètre restant** : 6/13 : P5→P2, P3→P6, P4→P6, P5→P6, P6→P1, P7→P5. La certification réelle nécessite encore la chaîne publication/checkout authentique, finance et navigation Chromium. Aucun changement de `main`, staging, production, PSP ou fournisseur.

### Complément de preuve : colis réellement partagé en PostgreSQL

[GitHub Actions #40506461210](https://github.com/SamyrFateh/komerce-backend/actions/runs/40506461210) : workflow vert, **86/86 tests purs, Golden regroupé 1/1, Golden historique 1/1, matrice multi-commandes 4/4**, comparateur final sans asymétrie. Le test multi-commandes crée une PO/commande porteuse et une autre commande non porteuse partageant le même colis : le propriétaire de remise retrouve celui-ci au moyen de `parcel_items`, l'observateur retrouve le colis au grain `order_item_id` et classe la remise non encore effectuée en `EVIDENCE_GAP` (pas une erreur d'en-tête ni une fausse remise). Le test du mauvais relais reste rollbacké et confirmé dans les deux Golden.
