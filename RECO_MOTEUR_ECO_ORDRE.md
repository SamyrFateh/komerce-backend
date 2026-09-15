# RECO — Cartographie du pipeline pricing vs ordre canonique (L0)

**Chantier :** Moteur économique — verrouillage ordre de calcul & invariants
**Nature :** doc only, aucun changement de code.
**Repo :** `SamyrFateh/komerce-backend` @ `main` (`33aeacbba`)

---

## 0. Constat majeur — DEUX pipelines de pricing parallèles, un seul gardé

Le repo contient **deux moteurs de pricing indépendants, non connectés entre eux** :

| | Pipeline A — legacy SKU | Pipeline B — marché réel |
|---|---|---|
| Entrée | `product_id` seul | `market_id` + fenêtre canonique |
| Fichiers clés | `pricing-recommend.js`, `pricing-engine.js`, `pricing-apply.js`, `pricing-guards.js` | `pricing-maturity.js`, `pricing-market-coverage.js`, `pricing-market-decision-policy.js`, `market-local-price-activation-service.js` |
| Routes | `POST /api/pricing/recommend(-batch)`, `PUT /api/pricing/apply-price/:id`, `PUT /api/pricing/apply-all` | `GET/POST /admin/pricing-workspace/market/:marketCode/...` |
| Formule | `coutTotal / (1 - margeCible)` (CDR/(1−marge) — exactement la formule que la doctrine veut sortir du chemin décisionnel) | maturité → structure N3 → risque période → contribution → `coverage_ratio` |
| Garde maturité/couverture | **Aucune.** `coverage_ratio`, `NOT_DECISIONAL`, `market_id` n'apparaissent nulle part dans ce pipeline. | Oui, fail-closed (`evaluateMarketDecisionFailClosed` dans `market-local-price-activation-service.js`) |
| Écrit un prix réel produit ? | **Oui** — `PUT /apply-price/:id` et `/apply-all` écrivent `products.price_kmf` + `price_history`, actifs, non dépréciés (voir en-tête `routes/pricing.js`). | Oui, via `/local-price/activate`, gardé par `decision_status` |
| Garde-fou actuel | `pricing-guards.js::getSurvivalViolation` — compare au `survival_price_kmf` **envoyé par le client**, calculé **côté front** par `pricing-engine.js`. Aucune vérification serveur de cohérence, aucun lien avec la maturité. | intrinsèque au moteur (§2 ci-dessous) |

**Conséquence :** aujourd'hui, un admin peut appliquer un prix réel via `PUT /api/pricing/apply-price/:id` (ou `/apply-all`) sans qu'aucune notion de maturité/couverture/`market_id` n'entre en jeu. Ce n'est pas un court-circuit *dans* le pipeline canonique (B) — c'est un **second chemin de sortie de prix qui n'a jamais été raccordé au pipeline canonique**. Le risque doctrinal (§0 du plan : « décision prise sur du faux ») existe donc bel et bien, mais au niveau de l'architecture globale, pas seulement d'un point interne à un pipeline.

➜ **Point à trancher avant L1–L4** (cf. note pour Opus : « si L0 révèle un écart majeur… remonte-le ») : le Pipeline A doit-il être (a) explicitement mis en `NOT_DECISIONAL`/désactivé pour les marchés couverts par le Pipeline B, (b) fusionné dans l'ordre canonique, ou (c) documenté comme dette hors-scope avec un ticket de dépréciation ? Le plan d'attaque ne mentionne que le pipeline B ; sans décision explicite, verrouiller B seul laisserait la vraie porte de sortie (A) grande ouverte.

---

## 1. Pipeline B (marché réel) — ordre réel vs ordre canonique

Ordre canonique (§0 du plan) :
1. classification unique des coûts
2. maturité / watermark
3. disposition de l'irréconciliable
4. vérité N3 de période
5. attribution par marché
6. couverture
7. pricing marché

Ordre réel observé dans `pricing-market-coverage.js::computeMarketCoverage` :
1. `computeMarketMaturityWatermark()` — maturité + disposition (étapes 2+3 fusionnées, gaté par `market_id` dès l'entrée)
2. `computePeriodStructureTruth()` — vérité N3 de période, scoping `market_id` (étape 4, incluant en pratique l'attribution — étape 5 — via `allocationPolicies`)
3. `computePeriodRiskTruth()` — risque réalisé de période
4. `loadMatureOrderIds` + `loadMatureContributionTruth` — contribution réconciliée (uniquement commandes `mature`)
5. Six gardes séquentielles avant calcul du ratio (`maturity.decision_status`, `maturity_ratio < threshold`, `structure.market_n3_decisional`, mismatch de set de commandes mûres, coût variable inconnu non nul, risque non décisionnel) → chacune renvoie `NOT_DECISIONAL` + `coverage_ratio: null` immédiatement
6. `ratio = reconciled_contribution / n3` → `coverage_status` COVERED/UNCOVERED (étape 6)
7. Le pipeline B **ne va pas jusqu'au pricing (étape 7)** — `evaluateMarketDecision` s'arrête à une `authorization` (ALLOW/DENY), consommée ensuite par `market-local-price-activation-service.js` pour autoriser/refuser l'activation d'un prix local déjà proposé ailleurs. Aucun calcul de prix marché réel n'existe encore dans ce pipeline (cohérent avec l'anti-objectif du plan : « ne pas implémenter le nouveau pricing ici »).

**Écart avec l'ordre canonique :** aucun réordonnancement observé — le pipeline B respecte déjà 1→6 dans l'ordre, et gate strictement en `market_id` de bout en bout. C'est un pipeline **déjà bien formé**, pas un pipeline à réordonner. Le travail de L1–L4 sur ce pipeline consiste surtout à **transformer une bonne pratique implicite en invariant structurel + testé + gaté en CI**, plutôt qu'à corriger une violation active. Confirmé : aucun accès direct trouvé à `coverage_ratio`/prix hors de `computeMarketCoverage` qui court-circuiterait ces gardes (`grep` négatif sur les autres fichiers listés en §2).

---

## 2. Localisation des invariants (pour L1–L4)

| Invariant | Fichier / fonction |
|---|---|
| `coverage_ratio` (calcul + `null`) | `services/pricing-market-coverage.js::computeMarketCoverage` (retour `notDecisional()` à 6 points de sortie distincts, ligne ~236-320) |
| Watermark de maturité | `services/pricing-maturity.js::deriveMaturityWatermark` + `computeMarketMaturityWatermark` |
| Gate par `market_id` | Systématique : `marketId` est un paramètre obligatoire de `computeMarketMaturityWatermark`, `computePeriodStructureTruth`, `computePeriodRiskTruth`, `computeMarketCoverage` — jamais de requête cross-marché observée |
| N3 / vérité de période | `services/pricing-period-structure.js::computePeriodStructureTruth` (non lu en détail dans ce passage — à approfondir en L3) |
| `contribution = prix − (N1+N2)` | `pricing-market-coverage.js::loadMatureContributionTruth` — `contribution_before_risk_kmf = revenue - transactionVariable` (N1+N2 via `RECONCILIABLE_VARIABLE_COST_TYPES`), puis réconciliation avec le risque réel avant division par N3 |
| Disposition irréconciliable | `pricing-maturity.js` — `DISPOSITION_STATES`, `recordMaturityDisposition`, `normalizeDispositionPolicy` (gate de volume par `max_ratio` de politique externe) |
| Décision finale marché (authorization) | `services/pricing-market-decision-policy.js::evaluateMarketDecision` |
| Fail-closed sur panne d'évaluation | `services/market-local-price-activation-service.js::evaluateMarketDecisionFailClosed` (retombe explicitement sur `NOT_DECISIONAL`/DENY en cas d'exception — bon pattern, à généraliser en L1) |
| **Fallback CDR/(1−marge) actif** | `services/pricing-recommend.js` lignes 251-252 et 468 (`prixRecommandeBrut = coutTotal / (1 - margeCible)`) — **hors pipeline B, jamais gardé** |
| Point d'écriture de prix réel non gardé | `services/pricing-apply.js::applyPrice/applyAll`, garde uniquement `services/pricing-guards.js::getSurvivalViolation` (seuil transmis par le client) |

## 3. N3 rattaché à un shipment/SKU ? (pour L3)

Pas de violation trouvée dans le pipeline B à ce stade de lecture : `computeMarketCoverage` récupère N3 via `computePeriodStructureTruth` (scope période×marché déclaré), et la contribution SKU (`loadMatureContributionTruth`) n'inclut explicitement que N1 (coût variable transactionnel) et retire le risque réel — N3 n'entre qu'au dénominateur, jamais mêlé à la contribution. **À vérifier en profondeur en L3** : le détail interne de `pricing-period-structure.js` et `cost-allocation/*.js` n'a pas encore été audité ligne à ligne pour d'éventuels rattachements résiduels à un `shipment_id`/`sku_id`.

## 4. Court-circuits potentiels identifiés

1. **[MAJEUR]** `PUT /api/pricing/apply-price/:product_id` et `PUT /api/pricing/apply-all` (routes/pricing.js) → `pricing-apply.js` → écriture réelle de prix, **zéro référence à maturité/couverture/market_id**. Voir §0.
2. `POST /api/pricing/recommend(-batch)` alimente potentiellement l'UI qui sert de base au prix appliqué manuellement ensuite via `/apply-price` — chaîne humaine non technique, mais le nombre affiché à l'admin n'a jamais de statut `NOT_DECISIONAL` possible : il sort toujours un prix (avec juste des `warnings` textuels en cas de données absentes).
3. Aucun court-circuit trouvé *à l'intérieur* du pipeline B lui-même (cf §1) — mais rien n'empêche aujourd'hui, **structurellement**, qu'un futur appel à `computeMarketCoverage` sans passer par tous les awaits dans l'ordre soit refactoré par erreur ; il n'y a pas de barrière de type/état forçant l'enchaînement (c'est précisément l'objet de L2).

## 5. Vocabulaire

Le terme « charge économique de période » n'a pas encore été confirmé comme présent dans le code (recherche à faire en L3/L5 — non fait dans cette passe L0, `pricing-period-structure.js` non lu en détail).

---

## Priorisation recommandée pour L1–L4

- **L1 doit couvrir les DEUX pipelines**, pas seulement B : soit en fermant/gate-ant A, soit en documentant explicitement pourquoi A reste hors-scope (mais alors la Definition of Done du plan — « Aucun fallback silencieux vers CDR/(1−marge cible) » — n'est pas atteinte tant que `pricing-recommend.js`/`pricing-apply.js` restent actifs et non gardés).
- L2 (ordre verrouillé) a le plus de valeur immédiate sur le pipeline B, qui est déjà correct dans les faits mais pas structurellement protégé contre une régression future.
- L3/L4 : confirmation à faire, pas de violation active détectée dans cette passe — probablement les lots les plus rapides une fois L0 validé.

## Décision humaine à prendre avant d'aller plus loin

Le plan d'attaque original ne mentionne nulle part `pricing-recommend.js` / `pricing-apply.js` / `pricing-engine.js` (Pipeline A). Soit ils étaient hors radar au moment de la rédaction du plan, soit ils sont sciemment exclus. Dans les deux cas, **une clarification explicite est nécessaire avant L1** : le périmètre du "moteur économique" à verrouiller inclut-il ce chemin de sortie de prix legacy encore actif ?
