# Golden E2E — SKU vendu → achat fournisseur (R&D ÉCO)

**Date :** 26 octobre 2026  
**Verdict du protocole :** vrai problème de cohérence du *projecteur Golden Purchasing* reproduit et corrigé en PR brouillon. **Aucune certification des parcours production, staging ou HTTP**.

## Hypothèse indépendante

La preuve « chaque ligne client est couverte par le fournisseur » exige que la quantité **et la référence SKU exacte** des lignes d'achat correspondent aux `order_items` vendus. Le contrôle amont `CUSTOMER_ORDER_PROVED` recherche déjà `SKU_SUBSTITUTION`, mais `services/golden-e2e-cockpit.js` calculait sa preuve Purchasing à partir des seules quantités de `purchase_lines`.

Ce cas a été sélectionné par comparaison des gardes entre deux chemins Golden d'une même commande, et non par recapture d'une sortie supposée correcte.

## Preuve A/B SQL réelle

Protocole : [golden-purchase-sku-postgres.js](golden-purchase-sku-postgres.js). Les données de test sont créées dans `komerce_test` PostgreSQL 16 et détruites par `ROLLBACK`. L'extracteur exécute le SELECT du vrai `purchaseResult` de `golden-e2e-cockpit.js`, et `evaluatePurchaseCoverage` du même service. Chaque scénario est rejoué deux fois.

| Intention | Avant | Après |
|---|---|---|
| Commande variante A, achat variante A, quantité 1 | Purchasing PASS (2/2) | Purchasing PASS (2/2) |
| Commande variante A, achat variante B, quantité 1 | Purchasing PASS **à tort** (2/2) | Purchasing FAIL, `purchased_qty=0` (2/2) |

- [**Avant correction — job vert #40412537302**](https://github.com/SamyrFateh/komerce-backend/actions/runs/40412537302) ; [preuve JSON](https://github.com/SamyrFateh/komerce-backend/actions/runs/40412537302/artifacts/12694022540).
- [**Après correction — job vert #40412919335**](https://github.com/SamyrFateh/komerce-backend/actions/runs/40412919335) ; [preuve JSON](https://github.com/SamyrFateh/komerce-backend/actions/runs/40412919335/artifacts/12693868315). Suite Jest Golden de 16 tests sur 16.
- [**PR #3025**](https://github.com/SamyrFateh/komerce-backend/pull/3025) : deux fichiers, `services/golden-e2e-cockpit.js` et `tests/unit/golden-e2e-cockpit.test.js`. Deux clauses SQL identiques `oi.sku_id IS NOT NULL AND pl.product_sku_id = oi.sku_id` pour `purchased_qty` et `paid_qty`, sans requête ni schéma supplémentaires.

## Scanner transversal étalonné

`scripts/research/golden-continuity-fingerprint.js` compare désormais les preuves :
- `CUSTOMER_ORDER_PROVED=ANOMALIE` pour un SKU acheté différent **et**
- `PURCHASING.passed=true` dans le cockpit Golden.

Cette paire produit le signal `UPSTREAM_PURCHASE_SKU_ANOMALY_VS_GOLDEN_PURCHASING_PASS`. Après la garde, `PURCHASING.passed=false` ne crée plus de contradiction ; les preuves manquantes restent classées `EVIDENCE_GAP` et ne deviennent jamais un GO.

[Run de calibration #40413423429](https://github.com/SamyrFateh/komerce-backend/actions/runs/40413423429) : **12/12 tests purs du scanner et collecteur + 60/60 tests Golden des trois projections**.

## Limites / parcours à poursuivre

Le protocole injecte les lignes PO/achat directement dans la base isolée ; il n'établit pas que le vrai sourcing, le checkout HTTP, le règlement fournisseur, la réception Hub, la remise au client ou la clôture financière ont tous accepté cet achat incohérent. Le projecteur Golden est **en lecture seule** ; la PR corrige une preuve, non un writer fournisseur.

La prochaine vérification doit garder **les mêmes identifiants** `order_item_id → purchase_line_id → supplier_fulfillment_id → hub_purchase_allocation / hub_unit_id → parcel_item → scan de remise`, puis comparer les verdicts déjà canoniques `reconcileHubInbound`, `reconcileCustomerHandoff` et `reconcileOrderFinancialClose`. Ne pas inventer de liens manquants. La source de vérité d'un prix ou d'un volume n'est pas réécrite par le scanner.

Aucun Railway, aucune vraie commande, aucune purge, pas de nouvel outil de recette parallèle. **PR #3025 non fusionnée**.
