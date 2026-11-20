# Reset staging : portées `prudent`, `full`, `activity`

Workflow `.github/workflows/staging-reset.yml` (manuel, propriétaire seul) -> `scripts/recette/staging-reset.js` -> `scripts/controlled-business-purge.js`.
Classement de toutes les tables : `scripts/recette/staging-reset-classification.js` (une table non classée bloque le reset et fait échouer le test de dérive).

| Portée | Effet |
| --- | --- |
| `prudent` (défaut) | Vide toutes les classes `purge_*` (activité **et** catalogue/sourcing), retire les fixtures reconnues. |
| `full` | Comme `prudent`, plus retrait de tout compte hors allowlist et purge nominative de colonnes de fondation. |
| `activity` | Vide **l'activité seulement**. Catalogue, sourcing, prix et médias sont **préservés**. |

## Portée `activity`

Purgé : commandes et lignes, paniers, achats et exécution fournisseur, Hub (unités, sacs, KOM-BOX, allocations, réceptions), expéditions, douane, relais/colis/retraits, cash (collectes, garde, dépôts, contrôles), paiements, remboursements, wallets, écritures comptables et financières, alertes, notifications, réservations de stock (`local_stock_allocations`), SAV et invendus.

Préservé (48 tables, liste dans `ACTIVITY_PRESERVED_GROUPS`) : `products`, `product_skus`, `product_variants`, `product_attributes`, `product_suppliers`, `product_content_*`, `catalog_*` (médias, overrides, audits de publication, sync stock), `product_sku_media`, `product_market_exposure`, `product_market_price_drafts` et events, prix (`pricing_strategies`, `price_history`, `competitor_prices`, `market_price_observations`), `local_stock`, tout `sourcing_*` de données, `supplier_catalog_imports`. Les sources (`sourcing_sources`) restent en fondation et leur autopilote n'est **pas** désactivé.

### Garde cascade
Les préservées sont retirées des racines **et** ajoutées aux tables protégées. `TRUNCATE ... CASCADE` suit les clés étrangères depuis les racines ; si la fermeture atteint une table préservée, `PURGE_ABORTED_PROTECTED_CASCADE` interrompt le dry-run comme l'execute. Vérifié contre le schéma PostgreSQL réel : la fermeture ne touche aucune des 48.

### Arbitrages FK (tables catalogue qui référencent l'activité)
- `catalog_product_quality_notes` (-> `order_items`) : notes SAV, classée **activité**, purgée.
- `pricing_maturity_disposition_events` (-> `orders`) : classée **activité**, purgée.
- Aucune table d'activité n'est référencée par une table préservée (sinon la cascade l'aurait atteinte).

### Stock
`staging-reset-stock.js`, dans la transaction de purge et avant le `TRUNCATE` : une commande `confirmed` à `collected` a décrémenté `product_skus.stock` (modèle SKU) ou `products.stock` + `product_variants.stock` (legacy) ; les allocations locales consommées ont décrémenté `local_stock.qty_physical`. Ces quantités sont restituées (reliquats annulés déduits ; `pending`, `cancelled`, `refunded` ignorés : déjà neutres). Le dry-run affiche `stock_restoration_preview`. Limite : une commande Stripe payée mais bloquée par stock insuffisant n'a jamais décrémenté et serait sur-restituée : relire l'aperçu avant execute.

### Fixtures
Retirées comme en `prudent`. Un compte de test qui a signé une ligne préservée (ex. `price_history.applied_by`) est **conservé** et rapporté (`users_retained_due_to_preserved_catalog`) : aucune ligne préservée n'est modifiée pour retirer un auteur.

### Gardes inchangées
Dry-run par défaut ; execute exige la confirmation texte `RESET-STAGING-BUSINESS-DATA`, `PURGE_BUSINESS_DATA_KEEP_FOUNDATION`, l'épingle de base `STAGING_DB_PIN` et l'identité live (empreinte de base). Le rapport porte `code_sha` (`GITHUB_SHA`), `preserved_activity_tables`, `stock_restored`. Vérification indépendante : `staging-verify-empty.js` lit la même portée.

Preuves : `tests/unit/staging-reset-activity-scope.test.js`, `tests/integration/staging-reset-real-db.test.js` (bloc « portée activity »).

## Reprovisionnement E2E automatique après un reset `execute`

Un reset (surtout `activity`/`full`) supprime des comptes E2E (20/11 : responsable Hub, transitaire, finance, sourcing) et le M01 suivant échoue en 401. Le workflow `staging-reset.yml` enchaîne donc le job `provision` :

- **Condition** : `mode=execute`, job `reset` réussi avec statut `RESET_OK`, et `skip_provision` différent de `true`. En `dry-run`, rien n'est exécuté : le workflow affiche seulement le plan.
- **Réutilisation** : appel de `staging-e2e-provision.yml` (`workflow_call`, `secrets: inherit`), donc exactement le même script `staging-e2e-provision.js` et les mêmes secrets `E2E_*`. Aucune copie.
- **Marchés** : KM toujours ; entrée `provision_markets` (défaut `CM,CG`, vide = KM seul).
- **Confirmation** : aucune saisie supplémentaire. La confirmation `RESET-STAGING-BUSINESS-DATA` du reset, vérifiée par le job `reset`, vaut confirmation ; `PROVISION-STAGING-E2E` est passée en interne par le workflow, jamais saisie. Le provisionnement garde son propre contrôle de cette valeur.
- **Vérification finale (lecture seule)** : `staging-e2e-verify-accounts.js` contrôle les 8 comptes (admin, agent Hub, responsable Hub, agent relais, transitaire, responsable marché, finance, sourcing) : existence, rôle, marqueur E2E, périmètres de marché (KM + `provision_markets`), relais, autorisations Hub, autorité Sourcing. Un compte manquant fait échouer le workflow. Aucune valeur de secret n'est affichée.
- **Gardes inchangées** : propriétaire du dépôt, SHA (`code_sha`), épingle `STAGING_DB_PIN`, identité live. Si les secrets du responsable Hub manquent, le provisionnement le saute et la vérification échoue (compte attendu).
- Reprise manuelle : `staging-e2e-provision` seul reste utilisable.

Preuves : `tests/unit/staging-reset-provision-chain.test.js`.
