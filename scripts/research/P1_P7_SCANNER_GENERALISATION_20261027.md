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

## 27/10 — P5 → P2, huitième frontière (paiement client ↔ clôture financière)

Raccordement **en lecture seule** de `P5_P2_PAYMENT_CLOSURE` : `scripts/research/p5-p2-canonical-collector.js` lit la commande exacte, la porte `PAYMENT_FINAL_PROVED` du Golden checkout et le **véritable propriétaire** `services/order-financial-closure-reconciliation.reconcileOrderFinancialClose`. Il réutilise le contrôle Finance existant `services/finance-metrics/payments.js` : `stripe_eur + paid + stripe_payment_id vide` constitue un signal explicite.

La doctrine est prudente :
- L'existence de `orders.stripe_payment_id` **ne prouve pas** l'exécution et le règlement Stripe. Le scanner signale `PSP_REFERENCE_NOT_EXTERNAL_SETTLEMENT_PROOF` même si le checkout projette `PROVED`.
- Les commandes `K-GOLDEN-*` sont synthétiques, marquées `SYNTHETIC_GOLDEN_CREATE` par le propriétaire Golden. Dans ce cas, une clôture `FINANCIAL_CLOSE_MATCHED` avec `stripe_payment_id` absent est un **écart de certification** `EVIDENCE_GAP`, pas un bug de production ni une preuve de paiement réel.
- Pour une commande **non synthétique** `stripe_eur` payée mais sans identifiant PSP, une clôture `FINANCIAL_CLOSE_MATCHED` produit `CONTRADICTION_HYPOTHESIS` ; verdict définitif à confirmer avec événement signé/autorité de paiement.
- `cash_relais` : la collection en relais et l'attribution du reversement final sont deux preuves différentes. Un cash encaissé sans attribution de règlement ne donne aucun `GO` sur la clôture financière.
- Les clôtures `refund` et `cancel` ne valent jamais encaissement positif d'une commande.
- La comparaison A/B exige expressément le lecteur financier + le signal `SYNTHETIC_PAYMENT_NOT_PSP_PROOF` sur **les deux PO**, faute de quoi elle échoue.

Contre-épreuve négative PostgreSQL : depuis la commande Golden effectivement `collected/paid`, dans une transaction jetable `BEGIN/ROLLBACK`, basculer `payment_status` temporairement à `pending`. L'oracle attend `FINANCIAL_CLOSE_MISMATCH / FINANCIAL_CLOSE_CUSTOMER_PAYMENT_NOT_PAID`, ou le refus par une garde SQL de l'écriture. Après rollback, `payment_status` doit demeurer `paid`. Aucun appel Stripe, encaissement ou écriture staging.

La frontière est désormais **8/13 câblée**, mais ne constitue **pas** une certification de paiement PSP réel. Les 5 restantes sont `P3_P6_PURCHASE_COST`, `P4_P6_LOGISTICS_COST`, `P5_P6_CASH_REALITY`, `P6_P1_PRICE_REVIEW`, `P7_P5_COUNTRY_SETTLEMENT`.

### Dernière validation du huitième raccordement

[GitHub Actions #40509973372](https://github.com/SamyrFateh/komerce-backend/actions/runs/40509973372), **vert** : 104/104 tests purs, deux Goldens PostgreSQL réussis, quatre tests de colis partagés réussis, rapprochement A/B `NO_ASYMMETRY_OBSERVED`. Dans chaque Golden, `observed=8`, `notWired=5`, `contradictions=0`, zéro erreur de lecture propriétaire. P5→P2 = `EVIDENCE_GAP` : Golden synthétique `paid/stripe_eur` sans `stripe_payment_id`, alors que le propriétaire financier retourne `FINANCIAL_CLOSE_MATCHED`. Les contre-épreuves PostgreSQL déclenchent dans les deux cas `FINANCIAL_CLOSE_MISMATCH / FINANCIAL_CLOSE_CUSTOMER_PAYMENT_NOT_PAID` lorsque `payment_status` est basculé à `pending`, puis restaurent `paid` par rollback.

**Issue de recherche [#3063](https://github.com/SamyrFateh/komerce-backend/issues/3063)** : cohérence finance GAP 3a ↔ clôture, doctrine Stripe payée sans référence PSP, et chaîne webhook signée à reconstituer sur un scénario non synthétique avant de qualifier bug métier. Conserver l'observation de fixture comme lacune, jamais comme attestation d'encaissement externe.

**Suivant** : P3→P6 coût achat fournisseur, puis P4→P6 transport/douane, P5→P6 réalité cash, P6→P1 revue humaine des prix, P7→P5 règlement par marché. La formule `8/13` désigne des **frontières instrumentées**, pas huit processus entièrement certifiés.

## 27 octobre — P3 → P6, neuvième frontière raccordée et premier écart d'intégrité coût

Le lecteur `scripts/research/p3-p6-canonical-collector.js` relie :
- `purchase_lines.order_item_id` et la PO réellement confirmée (P3),
- `order_item_real_cost_allocations` à **l'article exact** (P6),
- `services/cost-allocation/real-margin-shadow.computeOrderRealMarginShadow(orderId,{client})` (moteur existant) qui utilise `supplier_payment_settlements` pour les **KMF effectivement débités**, y compris ventilation des PO regroupées, remboursements de marchandises et frais séparés.

Il ne somme pas une PO regroupée pour attribuer artificiellement toute sa valeur à un article. La comparaison des montants est limitée à une commande avec un seul article, une seule ligne d'achat active et un coût réel fournisseur prouvé. Pour toutes les autres situations, le résultat reste une preuve incomplète explicitement comptabilisée.

### Double étalonnage sur PostgreSQL 16

[GitHub Actions #40511487766](https://github.com/SamyrFateh/komerce-backend/actions/runs/40511487766) : 119/119 tests purs, deux Goldens verts, 9/13 frontières observées, 4 non raccordées. Dans chaque Golden, `order_item_real_cost_allocations` contient une allocation `product_purchase` marquée `is_actual=true` de 7 000 KMF avec source `supplier_execution_payment`, **sans** règlement append-only `supplier_payment_settlements`. Le propriétaire économique retourne `shadow_purchase_state=estimated_only`, `real_kmf=null` ; l'oracle correctement fail-closed produit `ACTUAL_ALLOCATION_WITHOUT_SETTLEMENT_PROOF` et `EVIDENCE_GAP`. Il n'y a **pas** de débit fournisseur externe certifié dans cette fixture.

[GitHub Actions #40511947278](https://github.com/SamyrFateh/komerce-backend/actions/runs/40511947278) : **121/121 tests purs, deux Goldens PG et matrice 4/4 colis partagés verts**, comparateur A/B `NO_ASYMMETRY_OBSERVED`. Contre-épreuve SQL : ajouter temporairement une autre commande B, déplacer l'`order_id` de l'allocation (qui conserve son `order_item_id` de commande A), puis lire la contradiction via le scanner. **L'UPDATE est accepté** sur les deux formes de PO ; le scanner remonte `COST_ALLOCATION_FOREIGN_ORDER`. `ROLLBACK` et restauration de la valeur d'origine vérifiés. Le comparateur exige désormais cette preuve négative sur **les deux** Golden ; une absence identique de preuve n'est plus acceptée comme équivalence.

**Issue [#3064](https://github.com/SamyrFateh/komerce-backend/issues/3064)** : garde d'intégrité commande/article/coût manquante en DB, reproductible en PostgreSQL. Ne pas prétendre qu'une telle ligne existe en production. Ne pas corriger avant revue owner / inspection de l'historique et de la stratégie de migration. Contrairement aux PO regroupées ou aux colis partagés, **l'allocation de coût et son `order_item_id` doivent désigner la même commande**.

### État

**9/13 frontières instrumentées**, 4 toujours `NOT_WIRED` :
- `P4_P6_LOGISTICS_COST` (coûts transport/douane par appartenance aux colis),
- `P5_P6_CASH_REALITY` (encaissements, reversements et actuals),
- `P6_P1_PRICE_REVIEW` (décision humaine de prix versus écriture marché),
- `P7_P5_COUNTRY_SETTLEMENT` (autorité marché pour règlements pays).

La cartographie instrumentée et les contre-épreuves restent une **R&D L4**, pas une certification métier complète, ni un audit autorisé sur les données de production.

## 27 octobre — P4 → P6 : dixième couture, colis → coûts fret/douane

**Lecture réelle en PostgreSQL** : `scripts/research/p4-p6-canonical-collector.js` lit l'appartenance au propriétaire `parcel-order-membership.listParcelsRepresentingOrder`, les lignes `parcel_items` de l'article exact, les allocations `freight`/`customs` de `order_item_real_cost_allocations`, leur relation `customs_shipment_parcels`, et les montants de `services/cost-allocation/real-margin-shadow.computeOrderRealMarginShadow`. Aucun algorithme parallèle de ventilation au poids, volume, CIF ou FX n'a été ajouté.

**Doctrine anti-faux positif :** `parcels.order_id` peut désigner une autre commande porteuse d'un colis partagé ; un colis sans `parcel_items` peut également représenter sa commande porteuse via la règle historique. Les comparaisons coût/articule exigent `parcel_items.order_item_id`. Une marge `order` ne se compare à un seul article **que pour une commande mono-article**. Les estimations `is_actual=false` ne deviennent pas des coûts réels. Une absence de douane documentée ou une ventilation encore provisoire reste `EVIDENCE_GAP`, pas zéro KMF et pas `PASS`.

### Étalonnage et contradiction SQL

[Run double Golden #40515819395](https://github.com/SamyrFateh/komerce-backend/actions/runs/40515819395), **vert : 134/134 tests purs, 2/2 PostgreSQL**, `observed=10`, `notWired=3`, `contradictions=0`. Nominal pour chacune des deux PO : un colis membre, une ligne de colis, **fret réel=1 500 KMF**, **douane réelle=2 500 KMF**, et concordance avec le shadow économique par type.

[Run adversarial #40516532131](https://github.com/SamyrFateh/komerce-backend/actions/runs/40516532131), **138/138 tests purs**, deux Goldens PostgreSQL et comparateur `NO_ASYMMETRY_OBSERVED`. En `BEGIN/ROLLBACK`, insérer un colis B appartenant à la commande via son en-tête historique mais **sans cet article** et **sans lien à l'expédition d'origine**. `UPDATE order_item_real_cost_allocations SET parcel_id=B` sur la ligne freight : accepté, puis lecture du scanner `LOGISTICS_COST_PARCEL_NOT_CONTAINING_ITEM` et `LOGISTICS_COST_SHIPMENT_PARCEL_UNLINKED`. Après rollback, la ligne fret pointe à nouveau le colis A ; B n'existe plus. Reproduit dans les deux formes de PO, sans écriture persistante. Ce n'est **pas** `LOGISTICS_COST_FOREIGN_PARCEL` : l'appartenance historique par en-tête est légitime, mais ne justifie pas une imputation d'article ni de shipment.

**Issue [#3065](https://github.com/SamyrFateh/komerce-backend/issues/3065)** : anomalie d'intégrité persistable de coût/article/colis/expédition, à arbitrer avec Logistics/Economic Engine et à auditer dans les données historiques **avant** toute garde/migration. Aucune preuve qu'une telle imputation existe en production ; aucune modification de code métier, de main, de staging ou Railway.

Les trois frontières qui restent à instrumenter sont `P5_P6_CASH_REALITY`, `P6_P1_PRICE_REVIEW`, `P7_P5_COUNTRY_SETTLEMENT`. **10/13** signifie coutures câblées et étalonnées ; pas 10 processus acceptés en recette réelle.

## 27 octobre — P5 → P6, onzième frontière raccordée (cash / PSP / frais de paiement)

**Les CI en attente après P4→P6 sont vertes** : [ECO #40517281513](https://github.com/SamyrFateh/komerce-backend/actions/runs/40517281513), [double Golden #40517281056](https://github.com/SamyrFateh/komerce-backend/actions/runs/40517281056).

**Nouveau collecteur** : `scripts/research/p5-p6-canonical-collector.js`, injecté dans le rapport général par `p1-p7-canonical-collector.js`. Il lit sur le **même order_id** les données P5 `orders.payment_mode/payment_status`, `cash_collections`, `cash_deposit_allocations` et `cash_deposits`, puis appelle le propriétaire P6 `services/cost-allocation/real-margin-shadow.computeOrderRealMarginShadow` pour `costs.by_type.payment`. Aucune émission de paiement, aucun recalcul parallèle de la marge, aucune conversion FX indépendante.

### Invariants / pièges exclus

- **Fonds client encaissés** ≠ **frais de paiement**. Ne jamais comparer le montant d'une collection cash au coût `payment` dans le shadow ; comparer plutôt les identités commande, marché, article, les preuves d'attribution et les montants de *même nature*.
- `stripe_eur` avec `stripe_payment_id` n'est **pas** une preuve de virement ou de réception d'un événement Stripe signé. Les Golden synthétiques (`SYNTHETIC_GOLDEN_CREATE`) restent `EVIDENCE_GAP`.
- La **ventilation d'une remise** n'est pas nécessairement une remise finale. `cash_deposit_allocations.allocation_basis='RECONSTRUCTED'` ne décharge jamais la garde ; une allocation `CONFIRMED` n'atteste pas seule la réception et le contrôle de destination `FINAL`. Pas de vert sur une chaîne de custody finale non attribuable à cette commande.
- `is_actual=true` pour un coût `payment` doit être distingué de son **preuve de provenance** et de son affectation `order_item_id / order_id`. L'autorité économique reste `real-margin-shadow`.
- Les commandes avec plusieurs articles ne deviennent pas « sans frais » parce qu'une seule ligne est absente. Le lecteur agrège par commande mais ne déclare pas la certification externe de ces frais.
- Aucun `GO` de paiement PSP réel ou de reversement final n'est produit par ce câble.

### Preuves nominales et contradictoires sur PostgreSQL

[CI ECO #40519405912](https://github.com/SamyrFateh/komerce-backend/actions/runs/40519405912) : tests des propriétaires et 12 cas P5→P6 (Stripe, cash intégral, paiement insuffisant, dépôt reconstitué, marché étranger, coût financier imputé au mauvais article, distinction frais/encaissement).

[CI double Golden #40519725602](https://github.com/SamyrFateh/komerce-backend/actions/runs/40519725602), **verte : 155/155 tests purs, deux Golden PostgreSQL, matrice colis partagés, aucune asymétrie A/B**. Le rapport donne **11/13 frontières raccordées, 2 NOT_WIRED et zéro contradiction nominale**. En Golden synthétique `stripe_eur` : aucune collection cash, aucun frais de paiement réel démontré, aucune preuve PSP signée ; **P5→P6 = EVIDENCE_GAP** sur les deux PO.

**Vraie contre-épreuve SQL P5→P6** sur les deux variantes : `BEGIN`, insertion d'une ligne `cash_collections` de 25 000 KMF liée à la commande Golden `stripe_eur` ; **PostgreSQL accepte**, puis le scanner détecte `STRIPE_ORDER_HAS_CASH_COLLECTION` ; `ROLLBACK` suivi de `SELECT` vérifie l'absence de collection persistée. Le writer normal `services/cash-operations.collectCash` refuse déjà une commande dont le mode n'est pas `cash_relais`, mais la relation persistée ne protège pas ce scénario. Aucune preuve que ce mauvais rail existe en production ni qu'un endpoint ordinaire le crée.

**Issue [#3068](https://github.com/SamyrFateh/komerce-backend/issues/3068)** : réconcilier la protection du writer avec l'intégrité DB et la gestion des historiques. Rechercher de façon read-only les collections sur commandes non-cash avant de définir une éventuelle garde DB, puis tests négatifs, sans perturber les chemins de règlement légitimes.

### Restant à raccorder

**2 frontières sur 13** :
- `P6_P1_PRICE_REVIEW` : impacts de marge à la décision humaine de prix, puis mutation effective de la projection marché uniquement après décision ;
- `P7_P5_COUNTRY_SETTLEMENT` : droits / marché opérationnel et isolement des flux de règlement pays.

**11/13 instrumentées ne signifie pas 11/13 certifiées en vrai parcours client**. Aucun merge `main`, déploiement Railway, paiement réel ni écriture staging.

## 27 octobre — Clôture du câblage scanner P1–P7 : **13/13 frontières instrumentées**

**Validation du dernier lot** : [GitHub Actions #40524045088](https://github.com/SamyrFateh/komerce-backend/actions/runs/40524045088), CI ECO verte pour les tests P6→P1/P7→P5 ; et [double Golden #40524441346](https://github.com/SamyrFateh/komerce-backend/actions/runs/40524441346), **vert : 175/175 tests purs, deux Golden PostgreSQL isolés, tests réels des colis partagés, comparateur A/B sans asymétrie, 13/13 observées, zéro `NOT_WIRED`, zéro erreur lecteur et zéro contradiction nominale**. `main`, staging et production sont inchangés.

### P6 → P1 : marge économique → décision humaine de prix

`scripts/research/p6-p1-canonical-collector.js` lit `real-margin-shadow.computeOrderRealMarginShadow` (signal par commande) et la **décision locale** détenue par `product_market_price_drafts` + les événements audit `product_market_price_draft_events` (propriétaires : `market-commercial-price-service` et `market-local-price-state-transition`). Il n'appelle **aucun writer** : un écart de marge ne crée jamais un prix actif, et un brouillon `DRAFT_PENDING_GATE` ou `LOCAL_AUTHORIZED_PENDING_CUTOVER` n'est pas un prix effectif acheteur.

**Golden nominal** : marge shadow = **56 %** ; aucun brouillon ni activation humaine, donc `P6_P1_PRICE_REVIEW = EVIDENCE_GAP`, aucun prix inventé, aucun changement `products.price_kmf` attribué.

**Vraie contre-épreuve PostgreSQL** : dans `BEGIN/ROLLBACK`, insertion d'un **événement** `ACTIVATE` pour le vrai couple produit/marché avec `actor_id=NULL` ; SQL accepte, puis le scanner remonte `UNATTRIBUTED_PRICE_ACTIVATE_EVENT`. ROLLBACK et absence d'événement ensuite vérifiés. **L'expérience ne modifie pas le prix effectif** : elle montre une fragilité de la piste d'audit si un autre writer SQL injecte une activation sans acteur. Issue [#3071](https://github.com/SamyrFateh/komerce-backend/issues/3071).

### P7 → P5 : marché/mandat → règlement pays

`scripts/research/p7-p5-canonical-collector.js` lit le contrôle de marché `market-control-plane.getControlPlane` et les faits `market_settlements` reliés à `market_operating_assignments`, gardés par la migration 208 et le propriétaire `market-settlement-service`. Un règlement pays n'est **jamais** déduit d'une commission, d'un total de ventes ni d'un indicateur cash. `READY` = attestation centrale, `REQUESTED` = demande pays, `PAID` = paiement central déclaré, `RECEIVED` = accusé pays ; **aucun** statut ne constitue ici une pièce bancaire externe vérifiée. Les mandats historiques `ENDED/SUSPENDED` ne deviennent pas automatiquement invalides.

**Golden nominal** : aucun settlement ni mandat actif dans la fixture ; `P7_P5_COUNTRY_SETTLEMENT = EVIDENCE_GAP`. Cela ne signifie pas qu'un paiement est dû ; le scénario n'inclut simplement aucun règlement pays.

**Vraie contre-épreuve PostgreSQL** : dans `BEGIN/ROLLBACK`, créer un mandat **DRAFT jamais activé** sur le marché KM, puis attester un settlement `READY` avec la bonne devise/acteur. SQL **accepte** ; le scanner retrouve `NEW_READY_SETTLEMENT_ON_INACTIVE_ASSIGNMENT`. Le writer canonique `market-settlement-service.createReadySettlement` exige pourtant un mandat `ACTIVE`. ROLLBACK et disparition du mandat test vérifiés. **Issue [#3072](https://github.com/SamyrFateh/komerce-backend/issues/3072)**.

### Bilan général — ne pas confondre couverture et certification

| Mesure | Résultat |
| --- | --- |
| Frontières P1–P7 cartographiées et branchées aux lectures propriétaires | **13/13** |
| Golden PO regroupée / PO historique | **2/2** |
| Tests purs de la CI finale | **175/175** |
| Erreurs de lecture propriétaire sur double Golden | **0** |
| Contradictions dans le parcours nominal Golden synthétique | **0** |
| Contre-épreuves contradictoires SQL isolées | **Exécutées avec ROLLBACK** |
| Certification réelle storefront + OTP + checkout client + PSP + prix humain + règlement bancaire + Chromium | **Non effectuée par cette R&D** |

Les anomalies SQL confirmées sont des **états persistables dans PostgreSQL de test**, pas des anomalies constatées dans les données de production, ni des preuves de fraude ou d'écriture via les API publiques. La matrice ne prétend pas prouver que toutes les fonctionnalités métier existantes ont été parcourues ou sont sans bugs. Une frontière `EVIDENCE_GAP` est volontairement comptée comme **observée**, jamais comme `GO`. Une comparaison A/B identiquement incomplète n'est pas autorisée à déclarer une preuve absente acquise.

**Registre issu de cette série** : [#3057](https://github.com/SamyrFateh/komerce-backend/issues/3057) Hub anticipé (arbitrage), [#3062](https://github.com/SamyrFateh/komerce-backend/issues/3062) relais scan (arbitrage), [#3063](https://github.com/SamyrFateh/komerce-backend/issues/3063) Stripe sans PSP sur fixture (lacune), [#3064](https://github.com/SamyrFateh/komerce-backend/issues/3064) coût/article de commande étrangère (SQL), [#3065](https://github.com/SamyrFateh/komerce-backend/issues/3065) fret/article/colis/expédition incohérents (SQL), [#3068](https://github.com/SamyrFateh/komerce-backend/issues/3068) encaissement cash sur commande Stripe (SQL), [#3071](https://github.com/SamyrFateh/komerce-backend/issues/3071) événement activation sans acteur (SQL), [#3072](https://github.com/SamyrFateh/komerce-backend/issues/3072) règlement READY sous mandat DRAFT (SQL).

**Prochaine phase séparée de la R&D de raccordement** : arbitrage des invariants par propriétaires, audit read-only des données réelles autorisé, correction *owner-local* avec migrations contrôlées si nécessaire, puis véritable recette utilisateur et navigateur. Pas de correction automatique, pas d'activation automatique de prix, pas de mutation de production sans revue.

## 27 octobre — Première version du scanner business indépendant (phase suivante à P1–P7)

Une première implémentation autonome est livrée **dans** `tools/business-auditor/` (pas encore dépôt séparé). Son moteur SQL, son registre de règles, ses tests et son CLI n'importent aucun service métier Komerce ; le scan statique est exécuté comme **sous-processus isolé** à l'aide du moteur lexical existant.

- Commande : `npm run audit:logic:full`, qui lance **code-only** par défaut, sans accès BD.
- `--mode data` ou `--mode all` : demande explicite de `DATABASE_URL`, `NODE_ENV=test` et `KOMERCE_DISABLE_CRONS=true`, refus du cloud/staging/production et de toute base autre que `localhost/komerce_test`.
- `engine.js` : seuls des SELECT prédéfinis, bornés à `sample-limit + 1`, transaction `REPEATABLE READ READ ONLY` contrôlée sur serveur puis `ROLLBACK` systématique. Ne déclenche aucune contre-épreuve destructive.
- 7 détecteurs indépendants initiaux `KBA-001…KBA-007` : coût mauvaise commande, fret/douane mauvais colis, frais hors expédition, cash sur Stripe, événement activation sans acteur, READY sur mandat DRAFT, scan mauvais relais.
- Rapport `business-audit.json` et `business-audit.md` avec provenance, références échantillonnées, cardinalité minimale et statut de **signal à examiner**, jamais « bug confirmé » automatiquement.
- Aucun portage de la logique métier ni calcul alternatif, aucune fusion sur main ou usage de données Railway.

**Preuve [CI indépendante #40532393776](https://github.com/SamyrFateh/komerce-backend/actions/runs/40532393776), verte :** 16/16 tests du moteur/CLI, **1 483 fichiers** analysés par l'auditeur statique existant, **22 suspicions lexicales non qualifiées**, 7 règles SQL exécutées, **0 signal** sur une base locale **jetable et propre**. Ce dernier zéro n'atteste rien sur les données réelles. Rapports JSON/Markdown archivés dans les artifacts GitHub Actions.

**Preuve [double Golden #40532212148](https://github.com/SamyrFateh/komerce-backend/actions/runs/40532212148), vert :** pour PO groupée et historique, les 7 règles KBA détectent chacune **leur état contradictoire en PostgreSQL** à l'intérieur des transactions d'étalonnage, puis `ROLLBACK`. Le nominal demeure 13/13 observé, 0 erreur de lecture. Il s'agit de tests avec données volontairement corrompues, pas d'un inventaire d'anomalies présentes.

**État exact du besoin initial :** outil séparé du runtime, commandes et rapports utilisables, calibrations PG positives/négatives : **OUI**. Scanner de tous les invariants business / toutes les tables / toutes les routes et audit de base réelle autorisé : **NON, restant à bâtir**. Les 22 suspicions statiques doivent être triées par propriétaire ; les vérifications SQL devront être généralisées progressivement depuis les preuves indépendantes, sans scanner aveuglément les données sensibles ni inventer des invariants.
