# Komerce — Golden Continuity Fingerprint R&D ECO (26 octobre 2026)

**Statut : prototype de recherche vérifié, PAS une certification Golden E2E ni un nouveau moteur métier.**

## But

Raccorder un analyseur de continuité entre **trois projections déjà canoniques**, sans modifier leur calcul, ni créer de service, de schéma, de commande, de paiement ou de jeu de données staging :

- `services/golden-upstream-evidence.js` : origine Sourcing, Raffinerie, Catalogue, Boutique ; portes PROVED / NON_PROUVE / ANOMALIE.
- `services/golden-checkout-thread.js` : commande client, SKU, OTP, marché, paiement et trace_id.
- `services/golden-e2e-cockpit.js` : paiement client, Purchasing, fournisseur, réception Hub, douane, relais, remise et clôture finance.

**Moteur pur :** `scripts/research/golden-continuity-fingerprint.js`.  
**Adaptateur read-only des propriétaires existants :** `scripts/research/golden-continuity-collector.js`, appelable avec un exécuteur DB injecté et des identifiants produit/marché/commande explicites.

## Checkpoints expérimentaux

| Point | Frontière | Oracle partiel | Si incomplet |
|---|---|---|---|
| P1_SOURCE_TO_CATALOGUE | Produit → fil Golden + 4 portes amont | Identité produit/trace et statuts déclarés par propriétaires | `EVIDENCE_GAP`, jamais PASS |
| P2_BOUTIQUE_TO_ORDER | Marché sélectionné, référence choisie, vraie commande | `orders.market_code` vs marché de sélection et marché de projection checkout ; IDs et références | `EVIDENCE_GAP` ou `CONTRADICTION_HYPOTHESIS` |
| P3_TO_P6_PAYMENT_TO_FINANCE | Paiement prouvé → Purchasing → Hub → remise → Finance | Paiement authentifié par projection checkout, steps réels du cockpit de commande | `EVIDENCE_GAP` ; si `ANOMALIE` canonique alors que paiement déclaré PASS : hypothèse à instruire |

**Règle scientifique :** la cohérence de deux projections ne prouve pas leur justesse ; une divergence exige un oracle indépendant, des identités reliées et une contre-épreuve. Le module expose toujours `RESEARCH_ONLY_NOT_CERTIFICATION` et `no_go_granted:true`.

## Premier étalonnage réel : marché de commande

**Défaut découvert via analyse transversale des parcours :** marché du cockpit KM ; commande réelle CM ; projection checkout initialement `PROVED` malgré cette discordance.

1. **Avant — vrai code du projecteur, DB simulée L2 :** [run #40409555172](https://github.com/SamyrFateh/komerce-backend/actions/runs/40409555172), `selected=KM`, `orders.market=CM`, `checkout=PROVED`, `fingerprint=CONTRADICTION_HYPOTHESIS`.
2. **Correction propre :** [PR #3023](https://github.com/SamyrFateh/komerce-backend/pull/3023) (brouillon, 2 fichiers) : `order_matches_selected_market` depuis la ligne SQL canonique déjà chargée ; en cas de divergence explicite, `ANOMALIE:ORDER_MARKET_MISMATCH`. Aucune nouvelle requête.
3. **Après — 60/60 tests des trois projections + 9/9 tests du comparateur et de son adaptateur** : [run #40411270799](https://github.com/SamyrFateh/komerce-backend/actions/runs/40411270799).
4. **Après — PostgreSQL 16 isolé avec fixture transactionnelle, vraie projection checkout, 2 x nominal + 2 x perturbation** : [run #40410899027](https://github.com/SamyrFateh/komerce-backend/actions/runs/40410899027), [preuve JSON](https://github.com/SamyrFateh/komerce-backend/actions/runs/40410899027/artifacts/12693371926). CM→CM est PROVED ; KM→CM est ANOMALIE ; `ROLLBACK` vérifié.

**Nuance importante :** aucun test HTTP authentifié, capture Chromium, règle d'habilitation de l'UI ou acceptation humaine n'a été produit ici ; ne pas déclarer une faille publique ni un GO staging.

## Ce qui est réellement branché, et ce qui ne l'est pas

L'adaptateur `collectGoldenContinuity(db,{productId,marketCode,orderReference})` appelle les **fonctions read-only existantes**, lit la vraie commande par sa référence **sans filtrer silencieusement sur le marché demandé**, et interdit implicitement toute sonde storefront (fetchImpl=null). Il ne crée ni endpoint ni bouton et ne s'exécute pas automatiquement en production.

Nous n'avons **pas** certifié la chaîne P1→P7 complète : il manque encore les mêmes IDs produit/SKU/PO/unité/colis/transfert/relais/finance sur des données non synthétiques, une preuve d'environnement/commit (via `/health/version`), les véritables écrans desktop/mobile et la validation humaine.

Prochaine extension *économique* : brancher **deux points supplémentaires** au Golden existant avec des traces de même commande : (1) produit exposé au bon marché → SKU commandé ; (2) PO / livraison Hub / couverture physique → remise / clôture. Réutiliser `tests/e2e-cash/order-to-cash-thread.spec.js` et les services de rapprochement au lieu de construire une seconde suite.

Doctrine sources : `docs/recette/RCT1_GOLDEN_P1_P7_CONVERGENCE_20261021.md` ; `docs/audits/FULL_RECETTE_E2E_EVIDENCE_REGISTER.md`. **RCT1 n'est pas une preuve de vente/achat/réception réels.**

Aucun service Railway, aucun `main` modifié, aucune purge, aucun secret fournisseur requis, aucune nouvelle dépendance npm.
