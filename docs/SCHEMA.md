# Schéma DB Komerce

> **Statut** : schéma canonique de la base de production
> **Source** : `pg_dump` PostgreSQL 18 — Railway — rafraîchi automatiquement par `schema-refresh.yml` à chaque merge de migration
> **Méthode** : `node scripts/db-snapshot.js` — dump Railway nettoyé des artefacts PG18, écrit dans `docs/db/railway-live-schema.sql`, committé via PR automatique.
> **Rappel** : `db/schema.sql` est supprimé depuis juin 2026. La source unique est `docs/db/railway-live-schema.sql`.

---

## 0. Gouvernance DB obligatoire

Toute modification de schéma DB doit respecter :

```txt
docs/KOMERCE_DB_SCHEMA_DOCTRINE.md
```

Une migration, une modification de table/colonne/enum/index/trigger/fonction/contrainte, ou un nouvel accès DB depuis le code est incomplète tant que :

- `docs/SCHEMA.md` décrit le schéma live vérifié ou le schéma visé par migration ;
- le mode est explicite : `verified_live_schema` ou `intended_migration_schema` ;
- **`intended_migration_schema` ne s'utilise QUE pour une colonne/enum ajoutée à une table déjà documentée** (ligne de tableau existante, ex. migrations 095/096/098 ci-dessous) — le gate de drift ne tokenise pas les colonnes, ce marqueur ne le déclenche donc jamais. **Pour un nouvel objet (table ou vue) pas encore en live, jamais de ligne de tableau directe** : utiliser un bloc `<!-- schema-pending -->` (format documenté en tête de `scripts/schema-promote.js`). Le gate tokenise la 1ère cellule de chaque ligne — une ligne directe pour un objet absent du dump live est un FANTÔME bloquant. `npm run schema:promote:write` convertit le bloc en ligne dès que l'objet est confirmé dans le dump live ;
- les headers `@db-read`, `@db-write`, `@db-txn` des fichiers lecteurs/écrivains sont à jour ;
- `docs/KOMERCE_ARCH_HEADER_GRAPH.md` et `docs/komerce-arch-header-graph.json` sont régénérés si les headers changent ;
- l'ordre migration/deploy/rollback est documenté si la production est impactée.

Règle stricte : un agent peut mettre à jour ce document depuis une migration comme schéma visé, mais il ne doit pas présenter ce changement comme vérifié en production tant qu'un extract ou une requête DB live ne l'a pas confirmé.

---

## 1. Règle d'usage

Ce document est la **réponse unique** à la question : *"qu'est-ce qui existe vraiment en base aujourd'hui ?"*.

Avant toute modification DB :

1. ouvrir ce document ;
2. localiser la table concernée dans le domaine correspondant ;
3. vérifier les colonnes, ENUMs, contraintes CHECK, triggers ;
4. ouvrir ZONE_IMPACT pour les invariants applicables ;
5. décider si la modification passe par `services/order-status-machine.js` ou un autre point d'entrée.

En cas de divergence détectée entre ce document et la DB, voir §10.

---

## 2. Vue d'ensemble

| Objet | Compte | Note |
|---|---|---|
| Tables | 238 | Vérifié sur le dump live Railway. |
| Vues | 21 | Vérifié sur le dump live Railway. |
| ENUMs | 17 | Types métier présents dans le dump live Railway. |
| Index | 536 | Performance + contraintes uniques |
| Foreign keys | 478 | Cohérence relationnelle |
| Fonctions | 134 | Fonctions présentes dans le dump live Railway. |
| Triggers | 151 | Triggers présents dans le dump live Railway. |
| Extensions | `pgcrypto`, `uuid-ossp` | UUID + chiffrement |

---

## 3. ENUMs critiques

| ENUM | Valeurs | Source de vérité |
|---|---|---|
| `order_status` | `pending`, `confirmed`, `ordered`, `preparation`, `shipped`, `in_transit`, `available`, `collected`, `cancelled`, `refunded` | `services/order-status-machine.js` |
| `parcel_status` | `draft`, `preparation`, `shipped`, `in_transit`, `arrived`, `available`, `collected`, `cancelled` | `routes/parcel-api-v2.js` + `services/parcel-service.js` |
| `payment_status` | `pending`, `paid`, `failed`, `refunded`, `partially_paid` | `routes/payments.js` |
| `payment_mode` | `stripe_eur`, `cash_relais`, `mixed_shared_cart_cash`; **Migration 169 (2026-09-07, `intended_migration_schema`)** : + `mobile_money`, rail Komerce distinct du provider opérateur. | `routes/orders/create.js` + `services/payment-mobile-money.js` |
| `scan_step` | `preparation`, `hub_preparation`, `shipped`, `in_transit`, `relais_received`, `collected` | `routes/scans.js` + `services/scan-engine.js` |
| `user_role` | définit les rôles auth | `middleware/auth.js` |
| `basket_type` | type de panier (boutique / partagé / collectif) | `routes/baskets.js` |
| `ceremony_order_type` | type de commande module cérémonie | `routes/modules.js` |
| `shared_cart_status` | `open`, `closed`, `cancelled` | `services/shared-cart-engine.js` |
| `shared_cart_contribution_status` | statut contribution panier partagé | `services/shared-cart-engine.js` |

**Règle absolue** : aucune valeur d’ENUM ne se modifie hors migration SQL. `pending_group_payment` a été retiré de `order_status` par la migration 124 ; `shared_cart_status` a été réduit à `open` / `closed` / `cancelled` par la migration 125.

---

## 4. Tables par domaine

| Objet | Rôle |
|---|---|
| `catalog_product_quality_notes` | Remarques qualité traçables (acteur, provenance Catalogue ou Relais, article remis, commentaire daté et immuable) ; migration 400 non encore vérifiée live. **Migration 400 — promue le 2026-11-08 (schema-promote, dump live verifie).** |
| `catalog_product_sale_holds` | Décisions Catalogue centrales gel/dégel global d'une référence avec justification, acteur et historique ; garde des nouvelles commandes, migration 400 non encore vérifiée live. **Migration 400 — promue le 2026-11-08 (schema-promote, dump live verifie).** |
| `relay_product_return_receipts` | Preuve immuable de reprise physique d un dossier de retour article au relais ; une attestation par dossier, quantite exacte, zone A-Z facultative et non exclusive, sans stock ni mouvement wallet. Non verifiee live. **Migration 401 — promue le 2026-11-08 (schema-promote, dump live verifie).** |


### 4.1 Logistique commande (7 tables)






| Table | Rôle |
|---|---|
| `orders` | Commande client (table maîtresse, 60+ colonnes). **Migration 315 (2026-10-22, `intended_migration_schema`)** : + `fx_snapshot` JSONB nullable (vérité monétaire figée de la transaction : montant d'origine, montant confirmé dans la devise du marché du relais, montant EUR encaissé, jambes FX sourcées ; immuable une fois posé, lu par paiements et remboursements, jamais reconverti). **Migration 313 (2026-10-22, `intended_migration_schema`)** : + `transport_pricing_snapshot` JSONB nullable (preuve figée du tarif de vente transport appliqué : devise du marché, pivot EUR, ids de ligne de tarif, jambes FX ; distinct de `display_parity_snapshot`, réservé à l'affichage). **Migration 303 (2026-10-19, `intended_migration_schema`)** : + `simulation_scope` TEXT nullable (NULL = activité réelle ; sinon périmètre de recette, ex. `RCT1`, format contrôlé, immuable une fois posé par trigger). Exclu par défaut des agrégats d'activité réelle ; inclus seulement quand le périmètre est demandé. |
| `order_items` | Lignes de commande. **Migration 091 (2026-06-25)** : 6 colonnes de classification douanière figées à la création — `customs_category_key`, `sh_code`, `douane_pct`, `tva_pct`, `taxe_add_pct`, `classification_defaulted`. Immuables comme `price_kmf`. Doctrine : `docs/doctrine/DOUANE_DECLARATION_PIVOT.md`. Invariant I-DOUANE-1. **Migration 104 (2026-07-12, `verified_live_schema` — vérifié live Railway)** : + `sku_id` UUID nullable, FK vers `product_skus(id)` avec `ON DELETE SET NULL`. `variant_combo` reste snapshot d'affichage/historique ; le pilotage stock cible passe par `sku_id`. Doctrine : `docs/specs/DECISION_MODELE_STOCK_SKU.md`. **Migration 162 (2026-09-04, `intended_migration_schema`)** : + `fulfillment_source` TEXT nullable, snapshot immuable du verdict transactionnel `LOCAL_STOCK | IMPORT` pour les nouvelles lignes ; `NULL` reste réservé aux lignes historiques/synthétiques sans provenance fiable et ne vaut jamais `IMPORT`. Doctrine : `docs/doctrine/DOCTRINE_FULFILLMENT_MIXTE.md`. |
| `order_status_history` | Trace immutable des transitions (invariant I-04). |
| `order_comments` | Commentaires opérationnels. **Migration 398 (intended_migration_schema, non encore promue live)** : colonne nullable `hub_stage_key` (po, supplier, reception, cartons, departure, remaining) pour les notes internes Hub rattachées aux étapes d’une commande ; index ciblé et trigger SQL interdisant UPDATE et DELETE directs des notes d’étape tant que la commande existe. Les commentaires historiques restent inchangés ; la cascade de suppression de la commande demeure possible. |
| `order_incidents` | Incidents commande. |
| `order_cost_entry_events` | Journal append-only des saisies/corrections manuelles de coûts (L1) et des affectations de périmètre de recette (L3) : ancienne/nouvelle valeur, provenance, motif, auteur, clé d'idempotence. **Migration 303 — promue le 2026-10-19 (schema-promote, dump live verifie).** |
| `purchase_variance_decisions` | Autorisation distincte et immuable de la directrice Hub pour dépasser le total vendeur justifié, plafonnée par l'autorisation de paiement initiale, avec motif et pièce. **Migration 407 — promue le 2026-11-13 (schema-promote, dump live verifie).** |
| `manual_purchase_executions` | Allocations vendeur réel append-only par ligne PO manuelle, quantité et montant justifiés, canal et preuve. Ne pas interpréter comme un paiement fournisseur. **Migration 404 — promue le 2026-11-13 (schema-promote, dump live verifie).** |
| `order_checkout_idempotency` | Réservation transactionnelle UNIQUE(user_id, idempotency_key) et snapshot immuable du résultat du checkout ; réémission sans double création, stock ni débit wallet. Ne pas confondre avec une table live tant que le dump Railway ne confirme pas la migration. **Migration 408 — promue le 2026-11-13 (schema-promote, dump live verifie).** |
| `pickup_collect_failures` | Compteur append-only des échecs de retrait par code (code inconnu ou incorrect) par agent et relais ; au-delà de 5 échecs en 15 minutes glissantes, collectByPickupCode répond 429. Colonnes agent_id, relais_id, created_at. Aucun code stocké. **Migration 413 — promue le 2026-11-13 (schema-promote, dump live verifie).** |
| `pickup_code_generations` | Audit append-only des codes de retrait regénérés par le client propriétaire (POST /api/pickup/customer-regenerate/:orderId) ; sert aussi de quota 5 par commande et par 24 h. Colonnes order_id, user_id, created_at. Aucun code ni hash stocké. **Migration 412 — promue le 2026-11-13 (schema-promote, dump live verifie).** |

> **Ajouté** : migration 071 (A-BE-18, 26 mai 2026). Ces tables étaient auparavant créées au runtime par `ensureRelayTables()` dans `routes/relay-dashboard.js`. Elles sont désormais versionnées dans `migrations/071_relay_dashboard_tables.sql` (idempotent). Colonnes : voir migration pour le DDL complet (types incidents, priorités, statuts, résolution). Index : `idx_incidents_order`, `idx_incidents_status`, `idx_comments_order`.
| `order_item_cost_imputations` | Imputations de coûts par item (audit). **Migration 164 (2026-09-06, `intended_migration_schema`)** : + `estimated_business_variable_cost_kmf` NUMERIC(12,2) nullable pour figer les coûts variables business (paiement + provision risque) et + `estimated_fixed_overhead_kmf` NUMERIC(12,2) nullable comme allocation analytique historique des charges fixes. `estimated_business_complete_cost_kmf` est conservé pour compatibilité legacy. Cette allocation fixe n'est jamais une dette intrinsèque du SKU ni une autorité de prix. Le backfill reste NULL lorsqu'un snapshot historique ne permet pas une reconstruction fiable ; aucune valeur 0 n'est inventée. |
| `order_item_real_cost_allocations` | Allocations coût réel (post-livraison). **Migration 303 (2026-10-19, `intended_migration_schema`)** : + `provenance` TEXT nullable — provenance déclarée du coût (ex. `FICTIF recette`, pièce) ; NULL = non déclarée (historique). Saisie manuelle L1 : `source='manual_entry'`, `allocation_method='manual'`. |


### 4.2 Logistique colis (5 tables)

| Table | Rôle |
|---|---|
| `parcels` | Colis (unité opérationnelle autonome — invariant I-09). |
| `parcel_items` | Lignes colis (FK vers `order_items`, contrainte de quantité via trigger). |
| `parcel_events` | Événements colis (création, modification, etc.). |
| `shipments` | Expéditions (groupes de colis). |
| `shipment_batches` | Lots logistiques. |
| `hub_purchase_allocations` | Snapshot economique immuable Purchase Order exacte (historique) ou ligne d achat exacte (colonne `purchase_line_id` ajoutee par la migration 265, PO regroupee) vers order item/SKU/Supplier Order Identity, Market et destination ; aucune reassignation Hub. **Migration 233,265 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `hub_physical_units` | Identite physique HUB-001 ; inbound potentiellement multi-market, outbound PACKED/DISPATCHED force mono-market depuis les allocations actives. **Migration 233 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `hub_physical_unit_placements` | Historique des placements physiques d allocations immuables ; SPLIT/MERGE/REPACK ferment les anciens placements et ajoutent les nouveaux sans reassignation economique. **Migration 233 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `hub_custody_events` | Journal append-only de custody, transitions physiques, lineage SPLIT/MERGE/REPACK et constats physiques HUB-001. **Migration 233 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `product_sku_physical_codes` | Code physique EAN/GTIN ou fournisseur identifié par SKU Komerce. Un code identifie une variante, jamais une unité ni une commande. Portée fournisseur nullable pour EAN universel, confiance DECLARED/CONFIRMED et preuve d'observation. **Migration 391 — promue le 2026-11-04 (schema-promote, dump live verifie).** |
| `hub_box_bags` | Contenance immuable sac client scellé dans KOM-BOX, avec référence scannée et identifiant du colis canonique. **Migration 394 — promue le 2026-11-04 (schema-promote, dump live verifie).** |
| `hub_box_effective_placements` | Projection des placements directs de KOM-BOX plus contenu des sacs clients physiquement rattachés, sans double comptage. **Migration 394 — promue le 2026-11-04 (schema-promote, dump live verifie).** |

**Triggers de protection** : `trg_no_delete_parcels` (DELETE bloqué) + `trg_parcel_ship_guard` (transitions contrôlées) + `trg_check_parcel_item_qty` (cohérence quantités).

### 4.2 bis — Sécurité pickup — tokens éphémères (3 tables)

> **Ajouté** : migration 070 (SEC-1, 24 mai 2026). Remplace les deux Maps in-memory de `routes/pickup-secret.js` pour survivre aux redémarrages et fonctionner en multi-instance Railway.

| Table | Rôle |
|---|---|
| `pickup_print_tokens` | Token one-shot (TTL 2 min) pour accès au HTML imprimable du reçu cash après encaissement. PK = token hex 48 bytes. FK → `orders(id)` ON DELETE CASCADE. Supprimé à la première lecture. |
| `pickup_reveal_codes` | Code pickup en clair (8 chars), stocké max 30 min pour révélation one-shot après paiement Stripe/Wallet/MM. PK = `order_id`. Supprimé immédiatement après `GET /reveal-once`. |
| `pickup_verify_attempts` | Anti-bruteforce de la vérification pickup : compteur par (`attempt_key`, `token`, `ip_hash`) avec fenêtre `reset_at`. Rate-limit multi-instance (remplace un compteur in-memory). |

**Nettoyage** : `startPickupTokenCleanupCron()` toutes les 5 min dans `bootstrap/crons.js`. Multi-instance safe — aucune Map in-memory résiduelle pour ces deux flows.

**Invariant I-10** : les codes sont en clair uniquement pendant leur fenêtre TTL, avec le même niveau de confiance que `DATABASE_URL`. Voir **SEC-1** dans `STATUS.md`.

> **N4 — État vérifié code (2026-06-15)** : `migrations/072_jwt_revocation.sql` crée la table `revoked_tokens` et doit être appliquée sur Railway si la table est absente. Le câblage applicatif est présent : `routes/auth.js` génère un `jti`, insère le token au logout, `middleware/auth.js` vérifie, et `bootstrap/crons.js` purge les lignes expirées via `startJwtRevocationCleanupCron()`. **Action DB live restante** : vérifier `SELECT 1 FROM revoked_tokens LIMIT 1`; appliquer la migration si absente.

### 4.3 Wallet (5 tables)

| Table | Rôle |
|---|---|
| `wallets` | Wallet client (1 par (user, devise) depuis la migration 405 : colonne `currency` NOT NULL défaut `'KMF'`, unique `(user_id, currency)` ; les colonnes `*_kmf` portent des unités de la devise du wallet, aucune conversion implicite entre soldes ; création lazy). **Contrainte DB** `chk_balance_non_negative CHECK (balance_kmf >= 0)` ajoutée en migration 068 — filet de sécurité contre un solde négatif même en cas de requête SQL directe. **Validée en prod** (confirmé dump Railway 26 mai 2026 : contrainte sans `NOT VALID`). |
| `wallet_transactions` | Transactions immutables. |
| `wallet_credit_lots` | Lots de crédits (consommation FIFO). |
| `wallet_consumptions` | Consommations de lots (audit). **Append-only depuis migration 066** : suppression physique remplacée par marquage `reversed_at = NOW()` + `reversal_reason`. Index partiel `idx_wcons_active WHERE reversed_at IS NULL` pour filtrer les consommations actives. `wallet-service.removeFromOrder()` fait `UPDATE` et non `DELETE`. |
| `store_credits` | Crédits magasin (legacy/compat). |

Voir invariants I-05 et I-06 dans `ZONE_IMPACT.md`. Source de vérité : `services/wallet-service.js`.

### 4.4 Paiements et finance (9 tables live + 2 visées)

| Table | Rôle |
|---|---|
| `cash_collections` | Encaissements cash relais. |
| `cash_deposits` | Dépôts agents. **Migration 286 (`intended_migration_schema`)** : + `declared_amount` NUMERIC(18,2), `declared_currency` TEXT, `fx_rate_to_kmf` NUMERIC(18,6), `fx_source` TEXT, tous nullables et liés par un CHECK « tout ou rien » (KMF ⇒ taux 1) ; `amount_kmf` reste la valeur canonique KMF, NULL = saisie historique en KMF. **Migration 289 (`intended_migration_schema`)** : + `recipient_user_id` (personne habilitée destinataire d'un transfert), `destination_id` (destination finale d'une réception finale), `regularizes_deposit_id` (remise historique vérifiée que la nouvelle remise régularise) ; exactement une cible hors historique (CHECK `cash_deposits_custody_target_chk`), cible et origine immuables, statut non historique dérivé des seuls reçus. |
| `cash_reconciliation` | Réconciliation cash. |
| `invoices` | Factures / mini-factures. Contrainte UNIQUE(order_id) — une seule facture par commande. **Migration 169 (2026-09-07, `intended_migration_schema`)** : + `payment_total_amount` NUMERIC(18,4), `payment_currency` TEXT et `payment_minor_unit` INTEGER pour figer la devise réellement encaissée par les rails natifs comme Mobile Money XAF, sans réinterpréter `display_total_amount`. |
| `refunds` | Remboursements. Contraintes UNIQUE(order_id, refund_type) et UNIQUE(stripe_refund_id) pour idempotence ON CONFLICT. |
| `disputes` | Litiges. **Migration 399 (`intended_migration_schema`, non vérifiée live)** : + `return_order_item_id` UUID FK `order_items(id)`, `return_quantity` INTEGER positif, `return_reason` TEXT contrôlé ; toute demande `product_return` doit référencer un article et sa quantité, un seul dossier actif par ligne. Ce n’est ni une réception physique ni une autorisation wallet. |
| `stripe_events_processed` | Idempotence webhooks Stripe (anti-double-traitement). |
| `paypal_events_processed` | Idempotence webhooks PayPal (PK `event_id`, `status` ∈ processed/ignored/rejected/noop). Pendant PayPal de `stripe_events_processed`. |
| `transaction_documents` | Documents transactionnels hors facture : reçu remboursement (`refund_receipt`), reçu contribution panier partagé (`contribution_receipt`), reçu wallet (`wallet_receipt`), preuve retrait (`pickup_proof`), bon fournisseur (`purchase_order`), **facture douane classifiée** (`customs_invoice` — migration 093, Lot B keystone douane). Idempotence UNIQUE(document_type, subject_type, subject_id). Séquences dédiées : `refund_receipt_seq`, `wallet_receipt_seq`, `pickup_proof_seq`, `customs_invoice_seq`. |
| `market_payment_providers` | Providers Mobile Money autorisés par marché, sans credential persistée ; l'activation métier reste distincte de la configuration secrète runtime. **Migration 169 — promue le 2026-09-07 (schema-promote, dump live verifie).** |
| `mobile_money_transactions` | Tentatives et transactions Mobile Money idempotentes ; snapshot provider, marché, MSISDN, devise/montant et statut externe avant confirmation canonique paiement→stock. **Migration 169 — promue le 2026-09-07 (schema-promote, dump live verifie).** |
| `cash_confirmation_controls` | État transactionnel partagé des confirmations cash ; snapshot 1/2 approbations, acteurs distincts, finalisation atomique avec la vérité de paiement. **Migration 199 — promue le 2026-09-10 (schema-promote, dump live verifie).** |
| `market_settlements` | Vérité de règlement du Market Operating Assignment ; snapshot amount + currency immuable et cycle READY -> REQUESTED -> PAID -> RECEIVED, sans payout implicite. **Migration 208 — promue le 2026-09-10 (schema-promote, dump live verifie).** |
| `market_settlement_events` | Journal financier append-only du lifecycle settlement ; UPDATE et DELETE interdits, distinct de market_delegation_audit. **Migration 208 — promue le 2026-09-10 (schema-promote, dump live verifie).** |
| `cash_custody_receipts` | Faits append-only de réception d'une remise non historique : RECEIVED/REFUSED par le destinataire désigné, CONTROL par un acteur indépendant (clôture), REVERSAL en contre-écriture motivée. Montant annoncé distinct du montant reçu, devise et taux figés ; un transfert accepté déplace la responsabilité sur le seul montant reçu, une réception finale ne clôt qu'après contrôle. **Migration 289 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `cash_custody_losses` | Décisions centrales de perte (LOSS) et leurs contre-écritures (LOSS_REVERSAL), append-only : décideur distinct du détenteur, motif obligatoire, jamais déduites d'un montant reçu ; le détenteur ne peut pas devenir négatif. **Migration 289 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `cash_custody_movements` | Vue unique des mouvements de garde cash (COLLECTION, TRANSFER_OUT, TRANSFER_IN, FINAL_CLOSURE, LOSS) dont la somme par détenteur et Market est le solde canonique ; aucune seconde vérité, lecture seule. **Migration 289 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `market_cash_destinations` | Destinations finales autorisées des espèces par Market (BANK, MOBILE_MONEY) : proposée par un acteur, activée par un second acteur distinct (contrainte en base), suspendue/clôturée avec motif, jamais supprimée ; peut référencer un compte de paiement du même Market et de même devise sans jamais le modifier. **Migration 288 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `cash_deposit_allocations` | Grand livre de garde cash append-only : part de chaque encaissement couverte par une remise (cash_deposits reste l'autorité des remises). Allocation RECONSTRUCTED (FIFO serveur/historique) ou CONFIRMED (PR 4) ; Σ lignes vivantes ≤ encaissement, Σ lignes ≤ remise, même Market et même agent, verrous de lignes. Ne décharge jamais l'agent : la couverture reste provisoire jusqu'à la réception finale prouvée. **Migration 287 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `market_payment_accounts` | Configuration de paiement par Market indépendante du prestataire : titulaire du compte, vendeur juridique, opérateur et entité supportant les remboursements distingués ; credentials_ref est une référence de coffre, jamais un secret ; ACTIVE exige référence, base juridique et une vérification administrative préalable tracée (acteur, date, verification_ref), acte distinct de l'activation ; la validité effective du secret relève de D4b. **Migration 285 — promue le 2026-10-16 (schema-promote, dump live verifie).** |


### 4.5 Paniers et catalogue


| Table | Rôle |
|---|---|
| `products` | Catalogue produit. **Migration 095 (2026-07-02, `verified_live_schema` — vérifié live Railway)** : + `repack_volume_cm3` (NUMERIC, nullable — volume constaté après repack hub) et `repack_exempt` (BOOLEAN NOT NULL DEFAULT FALSE — exclusion doctrinale posée par admin). Doctrine : `docs/doctrine/DOCTRINE_DENSITE_VALEUR.md`. Aucune contrainte bloquante. **Migration 096 (2026-07-02, `verified_live_schema` — vérifié live Railway)** : `fragility` (texte) devient la SOURCE UNIQUE du tag manipulation (valeurs conseillées : fragile, electronique, sensible_chaleur, sensible_humidite) ; `is_fragile` DÉPRÉCIÉE, backfillée, drop planifié `migrations/scheduled/097` (exécutable 2026-07-16). Doctrine : `docs/doctrine/DOCTRINE_NON_CONFORMITE.md` §3. **Migration 098 (2026-07-03, `verified_live_schema`)** : + 5 colonnes de cuisine raffinerie, invisibles boutique — `name_source`, `description_source`, `source_locale`, `content_source` (connector_raw | ai_enriched | manual, backfill legacy = manual), `enrichment_version`. Doctrine : `docs/doctrine/DOCTRINE_CATALOGUE.md` §4-5. **Migration 104 (2026-07-12, `verified_live_schema`)** : + `inventory_model` TEXT NOT NULL DEFAULT `LEGACY_VARIANTS`, CHECK (`LEGACY_VARIANTS` | `SKU`). La bascule vers SKU est explicite et atomique ; jamais déduite de l’existence de lignes dans `product_skus`. **Migration 245 (2026-09-26, `intended_migration_schema`)** : + `boutique_category_key` et `boutique_subcategory_key` TEXT nullable. Ces deux champs portent uniquement la taxonomie de merchandising/navigation ; `products.category` conserve sa responsabilité économique/douanière historique. La lecture publique préfère les champs boutique lorsqu’ils sont présents et retombe sur `category/subcategory` pour les produits historiques. **Migration 301 (2026-10-17, `intended_migration_schema`)** : + `target_margin_pct` NUMERIC(5,2) nullable, CHECK 0 ≤ x < 100 — marge cible commerciale du produit ; NULL = marge par défaut de la catégorie puis `finance_config.target_marge_brute_pct`. Référence d’écart du pilotage par la marge ; aucun prix existant modifié ; la marge cible du moment est figée dans `order_item_cost_imputations.cost_breakdown`. **Migration 403** : `procurement_supplier_id` nullable vers l’identité fournisseur/Hub d’approvisionnement ; distincte du vendeur externe, du provider et de Supplier Order Identity, héritée en lecture par variantes et SKU. |
| `product_variants` | Variantes (taille, couleur). |
| `product_suppliers` | Lien produit ↔ fournisseurs. **Migration 239 (2026-09-17, `intended_migration_schema`)** : `supplier_price_aed` devient nullable et explicitement legacy pour les routes SKU/SOI ; le mapping conserve l'autorité sur le fournisseur opérationnel, pas sur le prix natif de la Canonical Unit. **Migration 395 (`intended_migration_schema`)** : index unique partiel `ux_product_suppliers_active_priority (product_id, priority) WHERE is_active AND deleted_at IS NULL` — une priorité par produit parmi les associations actives, donc résolution du fournisseur d'achat jamais ambiguë (`services/supplier-source-resolution.js`) ; la migration échoue explicitement si des doublons existent. |
| `baskets` | Paniers (différents `basket_type`). |
| `basket_items` | Items panier. |
| `boutique_categories` | Catégories boutique. |
| `boutique_subcategories` | Sous-catégories boutique. |
| `catalog_publication_decision_audit` | Journal append-only des décisions humaines de curation globale Catalogue ; product_ref et snapshots conservent la preuve même si le produit est supprimé, product_id devenant alors NULL. L'audit n'accorde aucune autorité de publication ni d'exposition marché. **Migration 283 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `catalog_glossary` | Glossaire EN→FR autoritaire Komerce (doctrine catalogue §4). `term_fr='='` signifie ne pas traduire. Mémoire des corrections validées : une décision Komerce gagne toujours sur une référence externe. Migration 098, confirmée live. |
| `catalog_taxonomy_audit` | Journal append-only des mutations de taxonomie admin avec acteur, surface source et snapshots avant/après ; l'audit reste observationnel et ne confère aucune autorité. **Migration 282 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `catalog_exclusions` | Éligibilité « ce que Komerce peut recevoir » (doctrine catalogue §3). Deux couches : `absolute` (douane/loi, définitif) et `restricted` (contrainte transport, ex. batteries lithium = maritime uniquement). Matching mots-clés sur la donnée source EN, étage ③ de la raffinerie. Migration 098, confirmée live. |
| `catalog_field_overrides` | Retouches manuelles par champ, réappliquées après chaque re-raffinage (doctrine catalogue §5 — rejouabilité). UNIQUE(product_id, field_name) : dernier override par champ gagne. Le CRUD admin édite cette table, jamais la fiche générée. FK `products` ON DELETE CASCADE. Migration 098, confirmée live. |
| `catalog_global_access_grants` | Grants explicites autorisant les surfaces Catalogue globales ; vérité d’autorisation résolue côté serveur. Vérifiée live Railway. |
| `product_skus` | Unités vendables canoniques en Mode SKU : une combinaison exacte d'options = un SKU, stock unique par SKU, prix SKU optionnel, SKU par défaut si variant_combo est NULL. Source de vérité stock cible selon DECISION_MODELE_STOCK_SKU. **Migration 104 — promue le 2026-07-14 (schema-promote, dump live verifie).** **Migration 224 (2026-09-12, `intended_migration_schema`)** : + `supplier_unit_ref` TEXT nullable et + `supplier_order_identity` JSONB nullable pour persister l’unité fournisseur commandable exacte. `NULL` signifie honnêtement non Supplier-Mapped ; aucun backfill heuristique n’est autorisé. Une identité persistée ne peut pas être remappée silencieusement ; doctrine : `docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md`. |
| `catalog_media` | Média canonique catalogue (PDC-8 Lot 2). Cible de promotion depuis `normalized_source_contract.media[]`. Identité stable : `product_id` + `source_media_id` lorsque connu (NULL = source pauvre, aucune identité fournisseur fabriquée, pas d'unicité applicable, ré-promotion peut dupliquer honnêtement). Legacy (`products.images` / `product_variants.images`) reste le fallback pour les produits non promus. Documentée le 2026-07-14 (drift live confirmé, aucun bloc `schema-pending` n'avait été posé). |
| `product_sku_media` | Association explicite SKU ↔ média canonique (PDC-8 Lot 5), source : `sellable_units[].media_refs` (V2). Les références explicites gagnent toujours sur un matching `option_values` heuristique. Table neuve au 2026-07-14, aucun writer avant le service de promotion (Lot 6). Documentée le 2026-07-14 (drift live confirmé, aucun bloc `schema-pending` n'avait été posé). |
| `catalog_enrichment_runs` | Trace de chaque appel d'enrichissement IA (doctrine catalogue §8 : échecs tracés, coût par produit suivi en tokens). `status` : `ok` (appliqué), `low_confidence` (appliqué + needs_review), `invalid_output` (JSON hors schéma, rien appliqué), `failed` (erreur réseau/modèle, rien appliqué). Documentée le 2026-07-14 (drift live confirmé, aucun bloc `schema-pending` n'avait été posé). |
| `product_content_profile` | Profil éditorial 1:1 par produit (fiche produit enrichie). brand, short_description, provenance globale (source/enrichment_version/reviewed) exposée par product_detail_v1.content.provenance. Cible de promotion depuis normalized_source_contract V2, jamais servi depuis le raw_payload. **Migration 111 — promue le 2026-08-12 (schema-promote, dump live verifie).** |
| `product_content_sections` | Sections éditoriales structurées + materials/care/warnings via section_key réservés (MATERIALS/CARE/WARNINGS, toujours BULLETS). UNIQUE(product_id, section_key) pour ré-promotion idempotente. content_json validé par le service de projection avant de traverser le contrat public. **Migration 111 — promue le 2026-08-12 (schema-promote, dump live verifie).** |
| `product_attributes` | Attributs structurés clé/label/valeur. kind=HIGHLIGHT alimente content.highlights, kind=SPECIFICATION alimente content.specifications (group/key/label/value/unit). UNIQUE(product_id, kind, group_key, attribute_key) pour idempotence. **Migration 111 — promue le 2026-08-12 (schema-promote, dump live verifie).** |
| `product_market_exposure` | Exposition commerciale d'un produit du catalogue global sur un Market ID donné (partenaire pays, capability catalog.expose). Le catalogue (products) reste unique ; cette table n'est qu'une projection d'exposition, même patron que commercial_exposure sur physical_offers/services. Absence de ligne = DISABLED (fail-closed). Écrite exclusivement via services/catalog-market-exposure-service.js (catalog, lifecycle owner) ; market-delegation délègue, jamais de SQL direct. **Migration 202 — promue le 2026-09-10 (schema-promote, dump live verifie).** |
| `catalog_terminology_reference` | Mémoire terminologique externe sourcée EN→FR (TERMIUM Plus en premier), multi-contextes et multi-traductions. Import filtré par corpus réel, provenance/licence conservées. Référence uniquement : n'écrase jamais catalog_glossary. **Migration 243 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `catalog_stock_sync_state` | État courant (non-journal) de la dernière observation de stock fournisseur effectivement APPLIQUÉE par product_skus.id (Mission 1, KOMERCE_AUDIT_ABSTRACTIONS_CATALOG_CHANGE_INTAKE, docs/doctrine/DOCTRINE_CATALOG_CHANGE_INTAKE.md). Alimentée exclusivement par services/catalog-stock-sync-application.js — jamais par order-payment-confirmation.js ni order-status-machine.js, qui continuent d'écrire product_skus.stock uniquement via product-stock-service.js#adjustStock (mouvement relatif). Une observation plus récente REMPLACE la ligne existante en une transaction verrouillée (FOR UPDATE sur product_skus), jamais un second insert à réconcilier. **Migration 241 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `catalog_field_sync_state` | Généralise catalog_stock_sync_state (migration 241) à tout champ du contrat Catalog Change Intake au-delà du stock (Mission 2, KOMERCE_AUDIT_ABSTRACTIONS_CATALOG_CHANGE_INTAKE). État courant (non-journal) de la dernière observation effectivement APPLIQUÉE, par (subject_type, subject_id, field_name). Les champs texte/médias sont suivis au grain product ; `purchase_price` est suivi au grain sku sous la forme native `{amount,currency}`, les deux faits devant provenir de la même capture, sans conversion implicite. Alimentée exclusivement par services/catalog-field-sync-application.js. N'écrit jamais products.cost_kmf (alimente le moteur économique actif, services/pricing-output.js) ni offer_status/is_active/option_axes/sellable_units (lié à la publication, services/catalog-promotion/*) — decision-only pour ces champs, cette table n'en porte donc jamais de ligne applied. **Migration 242 — promue le 2026-10-16 (schema-promote, dump live verifie).** |








### 4.6 Paniers partagés (5 tables)

| Table | Rôle |
|---|---|
| `shared_carts` | Panier partagé MVP. |
| `shared_cart_items` | Items panier partagé. |
| `shared_cart_events` | Événements panier partagé. |
| `cart_shares` | Partage de panier (token public). |
| `shared_cart_saved_access` | Bibliothèque « Mes listes » : listes reçues qu’un utilisateur a explicitement choisi de sauvegarder. UNIQUE(user_id, shared_cart_id). Migration 127. |

### 4.8 Pricing et économie (tables live + 2 objets visés)

| Table | Rôle |
|---|---|
| `finance_config` | **Singleton (id=1)** — source de vérité unique post-ADR-009. Intention migration 235 (non attestée live) : `taux_pln_kmf` (`NUMERIC(18,6)`) nullable, strictement positif lorsque renseigné, aucun taux par défaut. Colonne `provision_risque_pct NUMERIC(6,4) DEFAULT 0.01` ajoutée en migration 067 : taux de provision risque mensuel. **Migration 316 (2026-10-22, `intended_migration_schema`)** : `taux_change_eur_kmf` et `taux_aed_kmf` DÉPRÉCIÉES (plus de NOT NULL ni de valeur par défaut, COMMENT DEPRECATED) : jamais lues ni écrites, l'autorité FX est `services/fx-authority.js` (`currency_parities`, `fx_rate_observations`, `fx_pegs`). DROP dans une PR séparée. Les paramètres économiques de la table sont inchangés. |
| `economic_variables` | Variables économiques (legacy, voir ADR-009). |
| `exchange_rates` | Taux de change historisés. |
| `pricing_components` | Composantes de pricing. |
| `pricing_strategies` | Stratégies pricing. |
| `pricing_strategy_history` | Historique stratégies. |
| `pricing_benchmarks` | Benchmarks. |
| `pricing_category_dims` | Dimensions catégorie. |
| `pricing_category_taxes` | Taxes par catégorie. |
| `pricing_matrices_audit` | Audit matrices. |
| `cost_components` | Composantes de coûts. **Migration 191 (2026-09-08, `intended_migration_schema`)** : + `economic_nature` pour distinguer `VARIABLE` / `FIXED`, et + `allocation_perimeter` pour distinguer `DIRECT` / `MUTUALIZED`. Ces deux axes sont indépendants de la base d'allocation ; `MUTUALIZED` n'est ni une nature économique ni un synonyme de commande/colis. **Migration 303 (2026-10-19, `intended_migration_schema`)** : + `provenance` TEXT nullable — provenance déclarée de la valeur saisie ; un coût réel dérivé (commission relais) exige auteur ET provenance ; changer la valeur sans nouvelle provenance l'efface. |
| `cost_component_events` | Événements composantes coût. |
| `cost_component_market_overrides` | Overrides market-scoped de valeur/activation sur le modèle global `cost_components`; absence de ligne = héritage global. **Migration 159 — `verified_live_schema` (confirmé par dump Railway 2026-09-04).** |
| `cost_component_market_override_events` | Journal append-only des créations, mises à jour et resets d'overrides de composantes de coûts par marché. **Migration 159 — `verified_live_schema` (confirmé par dump Railway 2026-09-04).** |
| `risk_provisions` | Provisions risques. |
| `cost_benchmarks` | Seuils de part de coût attendue par famille/catégorie (`expected_share_pct`, `warn_ratio` 1.30, `alert_ratio` 1.60). Alimente les alertes d'écart coût. |
| `charges` | Charges fixes (référentiel de structure, non une preuve de période). **Migration 353 (`intended_migration_schema`)** : + `market_owner_id` UUID nullable, FK `markets(id)`, pour les références privées d'un marché ; NULL = référence partagée. Index partiel (marché, nom actif) pour empêcher les doublons. Seuls les événements de période append-only alimentent les montants réels ; une référence marché ne peut jamais recevoir un fait GROUP ou d'un autre marché. |
| `competitor_prices` | Prix concurrents globaux/informatifs ; ils ne constituent pas le corridor local d'un marché. |
| `price_history` | Historique prix. |
| `pricing_maturity_disposition_events` | Journal append-only des décisions humaines de disposition de maturité économique ; le dernier événement fait foi sans promouvoir une disposition en maturité réelle. **Migration 165 — promue le 2026-09-06 (schema-promote, dump live verifie).** |
| `economic_structure_cost_events` | Journal append-only des charges structurelles de période avec preuve, devise/FX, périmètre GROUP ou MARKET_DIRECT et corrections par événements sans mutation historique. Ces charges sont couvertes collectivement par la contribution du portefeuille ; elles ne constituent pas une dette SKU. **Migration 166 — promue le 2026-09-07 (schema-promote, dump live verifie).** |
| `economic_risk_cost_events` | Journal append-only des coûts de risque réellement constatés par marché, datés économiquement, avec preuve, devise/FX et corrections par événements ; l'absence de ligne ne vaut jamais zéro. **Migration 167 — promue le 2026-09-07 (schema-promote, dump live verifie).** |
| `economic_risk_watermark_events` | Certifications append-only de revue du risque par marché ; closed_through permet de prouver une période revue à zéro et devient stale si un fait backdaté est enregistré après certification. **Migration 167 — promue le 2026-09-07 (schema-promote, dump live verifie).** |
| `pricing_market_decision_policy_events` | Journal append-only de la politique canonique de décision par marché : largeur de fenêtre, seuil de maturité, seuil de couverture, plafond de dispositions, source, preuve, justification et date d'effet ; aucune valeur numérique implicite. **Migration 168 — promue le 2026-09-07 (schema-promote, dump live verifie).** |
| `product_market_price_drafts` | Décision commerciale de prix locale par market_id + product_id ; devise issue du marché serveur ; états DRAFT_PENDING_GATE, LOCAL_AUTHORIZED_PENDING_CUTOVER et LOCAL_ACTIVE. **Migration 170 — promue le 2026-09-07 (schema-promote, dump live verifie).** |
| `product_market_price_draft_events` | Journal append-only des décisions prix pays SET, RESET, AUTHORIZE et ACTIVATE avec acteur, raison et snapshot économique. **Migration 170 — promue le 2026-09-07 (schema-promote, dump live verifie).** |
| `market_price_observations` | Observations de prix locales market-scoped par produit, devise du marché, source, preuve et date d'observation ; source du corridor pays distincte de competitor_prices global. **Migration 192 — promue le 2026-09-08 (schema-promote, dump live verifie).** |
| `market_price_observation_events` | Journal append-only des créations et désactivations d'observations de prix marché avec acteur, raison et snapshot ; aucune réécriture historique. **Migration 192 — promue le 2026-09-08 (schema-promote, dump live verifie).** |
| `market_cost_attributions` | Journal append-only d'attribution des charges de structure mutualisées (economic_structure_cost_events scope_kind GROUP) aux marchés. Événements ATTRIBUTION/REVERSAL, FK source_event_id, gardes immutabilité et validation reversal. **Migration 267 — promue le 2026-10-16 (schema-promote, dump live verifie).** |



### 4.9 Douane (4 tables)

| Table | Rôle |
|---|---|
| `customs_categories` | Catégories douane. **Migration 248 (2026-09-27, `intended_migration_schema`)** : + `classification_terms` JSONB (objet de termes/phrases pondérés utilisés par la classification fournisseur dynamique) et + `default_weight_kg` NUMERIC(8,3). La Raffinerie ne doit connaître aucune clé de catégorie métier en dur ; seules les catégories actives et leur configuration DB pilotent le classement. |
| `customs_shipments` | Expéditions douane. **Migration 092 (2026-06-25)** : workflow déclaration en deux étapes. Enum `customs_shipment_status` (`pending` → `declared` → `confirmed`). Colonne `status` (NOT NULL DEFAULT pending). `customs_paid_kmf` devient nullable (saisi lors de la déclaration, pas à la création). Colonnes `declared_at`, `declared_by` pour traçabilité. Gate : impossible de passer une commande en `available` si l'expédition liée est `pending`. Doctrine : `docs/doctrine/DOUANE_DECLARATION_PIVOT.md`. **Migration 095 (2026-07-02, `verified_live_schema` — vérifié live Railway)** : + `total_volume_m3` (NUMERIC(8,4), nullable — volume facturé transitaire, sert W/M et remplissage). Doctrine : `DOCTRINE_DENSITE_VALEUR.md`. |
| `customs_shipment_parcels` | Lien shipment ↔ colis. **Migration 095 (2026-07-02, `verified_live_schema` — vérifié live Railway)** : + `parcel_volume_cm3` (NUMERIC(12,2), nullable — volume facturé transitaire, sert W/M et remplissage). Doctrine : `DOCTRINE_DENSITE_VALEUR.md`. |
| `customs_history` | Historique taux effectifs. Migration 221 (chantier currency debt) : `customs_estimated_kmf` et `customs_real_kmf` passent de `integer` à `numeric(14,2)`. Les deux colonnes GÉNÉRÉES qui en dérivent — `customs_delta_kmf` (`customs_real_kmf - customs_estimated_kmf`) et `customs_delta_pct` — sont supprimées puis recréées à l'identique dans la même migration : Postgres refuse d'altérer le type d'une colonne dont dépend une generated column. Recréation, pas création — aucune colonne nouvelle, aucun changement de contrat pour les consommateurs. |

Trigger `trg_customs_anomaly` détecte les anomalies de taux.

### 4.10 Sourcing et fournisseurs

| Table | Rôle |
|---|---|
| `suppliers` | Fournisseurs. Migration 403 : `system_key` identifie une fiche système stable ; `central_hub` est créée et protégée contre modification, suppression et TRUNCATE. Elle représente l’équipe Hub responsable d’approvisionnement manuel, pas un vendeur tiers ni un provider. |
| `partners` | Partenaires (élargi vs suppliers, voir ADR-005). |
| `purchase_lines` | Ligne d'achat canonique ORDER_ITEM → PURCHASE_LINE → PURCHASE_ORDER (MISSION_PURCHASE_LINES, PR 1 fondation). Snapshot figé de ce qu'on achète (fournisseur, SKU/SOI, prix, Procurement Hub). Quantité effective = 0 si annulée, sinon COALESCE(settled_quantity, confirmed_quantity, quantity) ; garde anti-double-achat I1 (FOR UPDATE sur order_items) ; ligne confirmée/réglée/annulée figée ; suppression directe interdite. Backfill 1:1 depuis purchase_orders ; écriture double avec purchase_orders, aucune lecture métier en PR 1. **Migration 263 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `v_purchase_line_progress` | Vue unique de progression d'achat par ligne (MISSION_PURCHASE_LINES, PR 2) : quantité engagée brute et effective, reçu, annulée, PO et forme de PO (historical, grouped, historical_no_line). Seule définition du reçu par ligne pour les lecteurs (signaux, routes purchasing, scans Hub, complétude de réception, stock-sync) ; is_order_complete(uuid) la consomme. Les PO historiques sans ligne (avant la migration 225) y figurent avec line_id NULL. Reçu d'une PO regroupée : 0 jusqu'à la PR 3 (placements RECEIVE). **Migration 264 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `supplier_execution_orders` | Sous-ordres natifs provider liés à une Purchase Order Komerce ; porte l'identifiant canonique supplier_order_id, un code secondaire éventuel, le statut provider et des faits bornés sans secret. **Migration 279 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `supplier_execution_order_lines` | Rattachement explicite entre un sous-ordre provider et les purchase_lines Komerce couvertes, avec quantité positive ; permet de reprendre le dialogue sans dénaturer la PO métier. **Migration 279 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `supplier_execution_groups` | Parent ou groupe natif provider d'une Purchase Order Komerce ; porte supplier_parent_order_id, payment_ref, statuts et faits bornés nécessaires à la reprise. **Migration 279 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `supplier_execution_group_members` | Membership parent ↔ sous-ordre provider ; garde DB imposant la même Purchase Order Komerce et le même provider des deux côtés. **Migration 279 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `supplier_execution_events` | Journal append-only du dialogue fournisseur : opération, outcome canonique, request id et faits sanitisés pour diagnostic et reprise crash-safe, sans credentials ni payload brut. **Migration 279 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `supplier_execution_fulfillments` | Fait canonique provider-side de fulfillment lié à un supplier_execution_order ; porte quantité attendue/observée, statut provider, tracking/carrier éventuels, preuve bornée et verdict de réconciliation. Ne prouve ni réception Hub ni remise client. **Migration 284 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `supplier_execution_payments` | Fait canonique de paiement fournisseur : cible exacte ordre ou parent provider, clé idempotente locale, montant attendu/observé, devise, statut de tentative, verdict de rapprochement et preuve explicite de débit réel. Aucun appel provider ni débit n est déclenché par la table. **Migration 280 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `supplier_execution_payment_proofs` | Preuves monétaires provider liées à supplier_execution_payments ; unicité native par provider/proof_source/proof_ref ; faits bornés uniquement, sans payload brut ni secret. **Migration 281 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `purchase_orders` | Bons de commande fournisseur. **Migration 225 (2026-09-13, `intended_migration_schema`)** : + `order_item_id` UUID nullable (FK `order_items(id)` ON DELETE SET NULL), + `product_sku_id` UUID nullable (FK `product_skus(id)` ON DELETE SET NULL), + `supplier_unit_ref` TEXT nullable et + `supplier_order_identity` JSONB nullable. Ces colonnes snapshotent l’unité fournisseur exacte décidée au moment de créer la PO ; aucun backfill historique heuristique. Pour une ligne SKU, `product_suppliers` choisit le fournisseur mais ne peut pas remplacer la Supplier Order Identity du SKU vendu. Index partiel unique `(order_item_id, product_supplier_id)` pour les PO actives. **Migration 239 (2026-09-17, `intended_migration_schema`)** : + `supplier_unit_price` NUMERIC(18,4) nullable, + `supplier_currency` TEXT nullable et + `supplier_total_price` NUMERIC(18,4) généré (`supplier_unit_price × qty`) pour snapshotter la monnaie native du fournisseur sans conversion implicite vers AED. Les PO historiques portant `unit_price_aed` sont backfillées comme devise `AED`; pour une ligne SKU/SOI exacte, la Canonical Unit est l'autorité du prix/devise et `unit_price_aed` reste NULL lorsque la devise native n'est pas AED. Doctrine : `docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md`, `docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md` et `docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md`. **Migration 266 (2026-10-02, `intended_migration_schema`, forme regroupée)** : + statut `draft` au CHECK `purchase_orders_status_check` ; `order_id`, `supplier_sku` et `qty` deviennent nullables ; `chk_purchase_orders_qty` devient `qty IS NULL OR qty > 0` ; + `procurement_hub_ref` TEXT NOT NULL DEFAULT `'DXB'` (hub destinataire, recopié sur l'existant) ; + `chk_purchase_orders_header_shape` : une PO est soit historique (`order_id`, `qty`, `supplier_sku` renseignés) soit regroupée (`order_id`, `order_item_id`, `product_sku_id`, `supplier_unit_ref`, `supplier_order_identity`, `qty`, `supplier_sku`, `supplier_unit_price`, `supplier_currency` tous NULL ; le détail vit sur `purchase_lines`). Trigger `trg_purchase_lines_a_groupable` (garde I4) sur `purchase_lines`. Écrite uniquement derrière `KOMERCE_GROUPED_PURCHASING`. **Migration 357 (`intended_migration_schema`)** : + `market_id` UUID nullable (FK `markets`), marché unique de toute nouvelle PO regroupée, immuable. **Migration 358 (`intended_migration_schema`)** : + `sent_at` TIMESTAMPTZ, + `sent_channel` TEXT (`email`, `whatsapp`, `phone`, `api`, `other`), + `sent_by` UUID (FK `users`), + `sent_note` TEXT nullables : preuve de l'envoi réellement effectué au fournisseur, immuable une fois posée, seulement sur une PO soumise ; `NULL` = bon émis ou préparé, transmission non prouvée. |
| `sourcing_candidates` | Candidats sourcing. **Migration 105 (2026-07-12, `verified_live_schema` — vérifié live Railway)** : + `normalized_source_contract` JSONB nullable, snapshot du `NormalizedSupplierProduct V2` validé sans dupliquer `raw_payload`. Préserve `media`, `option_axes` et `sellable_units` source ; ne constitue ni le catalogue canonique ni la vérité de stock. **Migration 403** : `supplier_id` nullable conserve le fournisseur réel ou le responsable Hub transmis par l’import, sans créer une identité provider. |
| `sourcing_candidate_events` | Événements candidats. |
| `supplier_catalog_imports` | Imports catalogues et audit de batch JSON : profil, hash source, version connecteur, statut, compteurs et findings. Migration 110, vérifiée lors du pilote production ING-6 du 2026-07-16. **Migration 403** : `supplier_id` nullable conserve l’identité fournisseur/Hub de l’import. |
| `supplier_catalog_import_rejections` | Rejets de lignes ou contrats non représentables, séparés des candidats promouvables. Conserve le payload brut, les findings et la cause automatisable ; unicité `(import_id, source_index)`. Migration 110. |
| `sourcing_candidate_observations` | Historique immuable des observations fournisseur par batch et profil, avec hash de ligne et snapshot du contrat normalisé. Migration 110. |
| `fabrics` | Tissus (module cérémonie). |
| `garment_models` | Modèles vêtements (module cérémonie). |
| `supplier_catalog_sync_checkpoints` | Checkpoints reprenables par fournisseur, synchronisation et catégorie pour alimenter le pool CJ propre plafonné à 1000 références sans publication automatique. **Migration 163 — promue le 2026-09-05 (schema-promote, dump live verifie).** |
| `supplier_oauth_connections` | Connexion OAuth fournisseur persistée côté serveur ; access/refresh tokens chiffrés AES-256-GCM, expirations et rotation, sans secret exposé au navigateur. **Migration 218 — promue le 2026-09-12 (schema-promote, dump live verifie).** |
| `sourcing_sources` | Instances de sources de sourcing avec adapter, acquisition/continuity et reference externe de credential ; aucune autorite runtime en PR 1A. **Migration 226 — promue le 2026-09-14 (schema-promote, dump live verifie).** **Migration 238 (2026-09-16, `intended_migration_schema`)** : + `autopilot_enabled` BOOLEAN NOT NULL DEFAULT false, autorisation explicite de collecte automatique récurrente ; `false` garantit qu’aucune source historique ne démarre sans action opérateur. |
| `sourcing_source_provides` | Capabilities relationnelles catalog/offers/units d'une source ; invariant api => units en base. **Migration 226 — promue le 2026-09-14 (schema-promote, dump live verifie).** |
| `sourcing_source_execution_modes` | Modes d'execution supportes human/api, distincts de la readiness instantanee. **Migration 226 — promue le 2026-09-14 (schema-promote, dump live verifie).** |
| `sourcing_captures` | Runs/lots d'acquisition d'une source ; lifecycle operationnel mutable, sans verite produit. **Migration 226 — promue le 2026-09-14 (schema-promote, dump live verifie).** |
| `sourcing_observations` | Observations immuables product/offer/unit ; source unique via capture. Migration 226 vise aussi l'enum sourcing_observation_grain. **Migration 226 — promue le 2026-09-14 (schema-promote, dump live verifie).** |
| `sourcing_observation_evidence` | Index d'evidence derive, namespaced et reconstructible pour le futur Candidate Retrieval ; non autoritatif. **Migration 226 — promue le 2026-09-14 (schema-promote, dump live verifie).** |
| `supplier_payment_settlements` | Faits append-only de règlement fournisseur en KMF réellement débités (payment hors frais ; goods_refund, fee_refund, other_refund typés) rattachés à un supplier_execution_payment, avec preuve et clé idempotente ; frais d'opération portés à part ; taux effectif calculé (Σ KMF / Σ devise), jamais stocké ni dérivé d'un taux de référence. **Migration 294 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `sourcing_commercial_principals` | Identite commerciale canonique shadow partageable entre plusieurs sources. **Migration 227 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `sourcing_source_principal_refs` | Mapping source-scoped principal_ref vers un commercial principal Komerce commun. **Migration 227 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `sourcing_canonical_entities` | Supertype shadow des identites canoniques Product Offer Unit avec lifecycle ACTIVE/SUPERSEDED. **Migration 227 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `sourcing_canonical_entity_refs` | References externes namespaced par source et ref_kind. **Migration 227 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `sourcing_match_proposals` | Propositions append-only de comparaison Observation/candidat avec evidence. **Migration 227 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `sourcing_resolution_decisions` | Decisions append-only LINK DISTINCT REVIEW_REQUIRED MERGE SPLIT. **Migration 227 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `sourcing_resolution_bindings` | Projection courante Observation vers identite canonique. **Migration 227 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `sourcing_identity_constraints` | Contraintes MUST_LINK et CANNOT_LINK reversibles par decision auditee. **Migration 227 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `sourcing_merge_policies` | Politique de projection de champs par grain sans selection d'offre. **Migration 227 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `v_purchase_line_market` | Marche d origine de chaque ligne d achat (order_item vers order vers market_id), lecture seule ; le marche n est ni porte par l en-tete de PO ni cle de regroupement, et ne se reassigne jamais via Purchasing. **Migration 266 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `sourcing_source_requests` | Fournisseurs demandés par l'opérateur sans connecteur Komerce (statut unique `connector_required`). Jamais une source : aucun autopilot, aucune capacité, aucune capture, aucun lien avec sourcing_sources. Unicité sur lower(btrim(provider_name)). Écrite exclusivement par services/sourcing-source-registry.js. **Migration 260 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `provider_credentials` | Coffre applicatif des credentials fournisseurs (Provider Credential Authority). Une ligne = un credential versionné ; l'enveloppe est un JSON chiffré AES-256-GCM (IV aléatoire, tag, AAD = provider + credential_ref + version + auth_type) sous la clé maître serveur KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY, jamais en base. Statuts pending/active/superseded/revoked/failed ; seuls pending et active peuvent porter une enveloppe (crypto-shredding des autres, imposé par CHECK). Les credentials oauth ne portent aucun token : ils référencent la session chiffrée de supplier_oauth_connections via oauth_session_key. Écrite exclusivement par services/provider-credential-service.js ; jamais relue par le navigateur. **Migration 262 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `sourcing_provider_control_events` | Journal append-only des changements Discovery Sync Import Production avec avant/après, opérateur, motif et horodatage. **Migration 255 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `import_runtime_runs` | Identite et chronologie d'un run d'import reel Sourcing vers Catalogue, avec business ref KIR et projection live fail-closed. **Migration 257 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `import_runtime_item_events` | Evenement par produit d'un run d'import (debut, fin, issue, prix source) pour le cockpit live, telemetrie best-effort sans autorite metier. **Migration 258 — promue le 2026-10-16 (schema-promote, dump live verifie).** |


### 4.11 Scans et opérations terrain (5 tables)

| Table | Rôle |
|---|---|
| `scans` | Scans terrain (legacy/compat). |
| `scan_events` | Événements scan (modèle moderne, protégé par `prevent_scan_event_delete`). **Migration 096 (2026-07-02, `verified_live_schema` — vérifié live Railway)** : + `photo_urls` (text[], DEFAULT '{}', miroir de disputes.photo_urls). Usage doctrinal : event_type=seal_photo au scellé Dubaï = borne 1 des fenêtres de responsabilité (avant : fournisseur ; après : transport). Alimenté par POST /api/hub/photo. Doctrine : `docs/doctrine/DOCTRINE_NON_CONFORMITE.md` §2. **Migration 381 (2026-11-03, `intended_migration_schema`)** : + `entry_mode` TEXT généré (stocké) depuis `metadata->>'entry_mode'`, défaut `scan` ; valeurs fermées `scan` | `manual_confirmation` ; une confirmation manuelle exige `metadata.manual_reason` (CHECK). Trace du mode dégradé : confirmation depuis l'interface via le même scan-engine, jamais un second writer. |
| `relais` | Points relais. |
| `inventory_items` | Inventaire hub. |
| `carriers` | Transporteurs. |

### 4.12 Utilisateurs et fidélité (7 tables)

| Table | Rôle |
|---|---|
| `users` | Utilisateurs (rôle via ENUM `user_role`). **Migration 320 (`intended_migration_schema`)** : ajoute la valeur `finance` à `public.user_role` pour le portail interne, sans créer d'utilisateur ni accorder de membership ou de capability. `sourcing` provient de la migration 148a ; `agent_transitaire` existe dans l'ENUM historique. **Migration 368 (`intended_migration_schema`)** : + `account_activation_required` BOOLEAN NOT NULL DEFAULT FALSE (nouveaux comptes collaborateurs invités bloqués avant consommation du lien) et + `credentials_changed_at` TIMESTAMPTZ nullable (borne serveur de révocation de tous les JWT antérieurs à un changement/récupération de mot de passe) ; les utilisateurs existants restent activés à l'application de la migration. |
| `otp_codes` | Codes OTP. |
| `user_pickup_authorizations` | Autorisation nominative courante de retrait exceptionnel, propriété auth-identity. Une ligne par utilisateur ; aucun numéro, copie ou donnée de pièce d’identité conservé. Migration 121. |
| `revoked_tokens` | Révocation JWT (logout) : `jti` révoqué, `expires_at` pour purge. Câblage : `routes/auth.js` insère au logout, `middleware/auth.js` vérifie, cron de purge dans `bootstrap/crons.js`. Migration 072. |
| `recipients` | Destinataires (peuvent être ≠ user). |
| `loyalty_tiers` | Niveaux fidélité. |
| `loyalty_rewards` | Récompenses. |
| `credential_action_tokens` | Jetons d'activation et de récupération à usage unique (empreinte SHA-256 seulement, finalité et expiration, consommation atomique), propriété auth-identity. Migration 367, intended_migration_schema. **Migration 367 — promue le 2026-11-04 (schema-promote, dump live verifie).** |

### 4.12 bis — Marchés, autorisations globales, délégation et Passkeys

| Table | Rôle |
|---|---|
| `markets` | Référentiel canonique des marchés/pays opérés par Komerce. Vérifiée live Railway. **Migration 278 (`intended_migration_schema`)** : + `lifecycle_status` TEXT NOT NULL, cycle canonique `PROVISIONING | ACTIVE | SUSPENDED | CLOSED` ; `is_active` reste une projection de compatibilité contrainte à TRUE pour `ACTIVE`/`SUSPENDED` et FALSE sinon. + `storefront_texts` JSONB objet pour le contenu/configuration storefront, sans autorité implicite. |
| `operator_market_scopes` | Projection de compatibilité des autorisations marché. Vérifiée live Railway. **Migration 195** : + `projected_from_membership_id` UUID nullable, FK vers `assignment_memberships(id)`. **Migration 271 (schema-pending)** : toute nouvelle ligne active doit avoir `projected_from_membership_id`; `NULL` n’est toléré que pour une ligne legacy déjà révoquée (`revoked_at IS NOT NULL`), via CHECK `NOT VALID` pour ne pas invalider l’historique existant. |
| `currency_parities` | Parités de devise par marché utilisées par la Currency Boundary. Vérifiée live Railway. |
| `dashboard_global_access_grants` | Grants explicites pour les surfaces Dashboard globales ; aucune élévation globale implicite. Vérifiée live Railway. |
| `webauthn_credentials` | Credentials Passkey/WebAuthn persistés pour l’authentification et leur révocation. Vérifiée live Railway. |
| `webauthn_challenges` | Challenges WebAuthn éphémères persistés pour garantir single-use et séparation des cérémonies. Vérifiée live Railway. |
| `sourcing_global_access_grants` | Grants persistés autorisant explicitement les surfaces Sourcing globales ; aucune autorité globale implicite. **Migration 149 — promue le 2026-08-29 (schema-promote, dump live verifie).** |
| `pricing_global_access_grants` | Grants persistés autorisant explicitement le Pricing Workspace global ; aucune élévation implicite depuis le navigateur. **Migration 152 — promue le 2026-08-29 (schema-promote, dump live verifie).** |
| `decision_signal_global_access_grants` | Grants persistés autorisant explicitement l’Action Center global et les signaux de décision transverses. **Migration 153 — promue le 2026-08-29 (schema-promote, dump live verifie).** |
| `capability_registry` | Registre exécutable des capabilities DELEGATION / EXECUTION / BOUNDARY, de leur portée et de leur statut ; le KPI d’autonomie ne prend que DELEGATION au dénominateur. **Migration 193 — promue le 2026-09-09 (schema-promote, dump live verifie).** **Migration 270 (2026-10-03, `intended_migration_schema`)** : + `effect` TEXT NOT NULL DEFAULT 'ACT' (CHECK READ|ACT ; effet déclaré une par une) et + `amount_bearing` BOOLEAN NOT NULL DEFAULT FALSE (`execution.cash.confirm`, `settlement.receive`, `finance.act`). **Migration 272 (`intended_migration_schema`)** : ajoute `execution.transit.confirm` (EXECUTION / MARKET / DELEGABLE / ACT), l’inscrit dans le template et les ceilings actifs sans l’auto-accorder à aucune membership. |
| `market_operating_assignments` | Mandat d’exploitation économique d’un Market ID ; au plus une ligne ACTIVE par marché. **Migration 194 — promue le 2026-09-09 (schema-promote, dump live verifie).** **Migration 276 (`intended_migration_schema`)** : + `central_referent_user_id` UUID nullable, désignation du référent central uniquement ; ce champ ne confère aucun droit ni capability implicite. |
| `assignment_capability_ceiling` | Plafond effectif des capabilities MARKET/DELEGABLE concédées par le central à un assignment. **Migration 194 — promue le 2026-09-09 (schema-promote, dump live verifie).** **Migration 276 (`intended_migration_schema`)** : + `limit_amount` NUMERIC(20,6) nullable ; uniquement pour une capability `amount_bearing=true`, valeur >= 0, `NULL` = plafond illimité legacy/explicite. |
| `assignment_memberships` | Membres agissant sous un Market Operating Assignment, avec historique explicite de révocation. **Migration 194 — promue le 2026-09-09 (schema-promote, dump live verifie).** **Migration 276 (`intended_migration_schema`)** : + `is_operating_lead` BOOLEAN (désignation seulement, aucun droit implicite ; un seul lead ACTIVE par assignment) et + `effective_until` TIMESTAMPTZ nullable, strictement postérieur à `granted_at` lorsqu’il est renseigné. |
| `membership_capabilities` | Capabilities actives de chaque membership, structurellement bornées par le ceiling de l’assignment. **Migration 194 — promue le 2026-09-09 (schema-promote, dump live verifie).** **Migration 276 (`intended_migration_schema`)** : + `limit_amount` NUMERIC(20,6) nullable ; uniquement pour une capability amount-bearing, ne peut pas dépasser un ceiling fini et devient obligatoire lorsqu’un ceiling fini existe. |
| `ceiling_templates` | Templates versionnés de plafond central ; un seul template peut être courant. **Migration 194 — promue le 2026-09-09 (schema-promote, dump live verifie).** |
| `ceiling_template_capabilities` | Association entre un template de ceiling et ses capabilities autorisées. **Migration 194 — promue le 2026-09-09 (schema-promote, dump live verifie).** |
| `market_delegation_audit` | Journal append-only des mutations de délégation, distinct des faits économiques. **Migration 194 — promue le 2026-09-09 (schema-promote, dump live verifie).** |
| `market_team_invitations` | Invitations d’équipe expirantes pour un Market Operating Assignment ; seul le hash SHA-256 du token est persisté et les capabilities demandées sont revalidées à l’acceptation. **Migration 196 — promue le 2026-09-09 (schema-promote, dump live verifie).** **Migration 277 (`intended_migration_schema`)** : + `phone_e164` TEXT nullable pour le destinataire WhatsApp au format E.164, + `channel` EMAIL|WHATSAPP, + `invited_by_user_id` pour tracer l’invitant central ou membre, + `grants_operating_lead` pour porter explicitement l’intention de désignation sans créer de capability implicite ; email peut être nullable lorsque le canal est WHATSAPP. |
| `market_cash_control_policies` | Politique de contrôle cash définie par le partenaire pour son assignment ; cash activé/désactivé et mode SINGLE ou DUAL_ALWAYS. **Migration 198 — promue le 2026-09-10 (schema-promote, dump live verifie).** **Migration 288 (2026-10-11, `intended_migration_schema`)** : + `custody_max_days` INTEGER nullable (1–365), délai de garde des espèces du Market ; `NULL` = défaut central ; toujours borné par la limite centrale côté service. |

### 4.13 Monitoring et alertes (10 tables)

| Table | Rôle |
|---|---|
| `notification_log` | Log notifications (email, push). |
| `client_notifications` | Notifications in-app essentielles rattachées à une commande, acquittables, sans canal externe ni contenu sensible. Unicité `(user_id, event_key, entity_type, entity_id)` ; statuts `open` / `acknowledged` / `resolved`. Migration 132, vérifiée live sur Railway le 2026-08-16. |
| `sms_log` | Log SMS. |
| `signals` | Signaux opérationnels et décisionnels. **Migration 222 (2026-09-12, `intended_migration_schema`)** : + `market_id` UUID nullable, FK `markets(id)` ; `NULL` signifie explicitement signal global, une valeur non NULL borne le lifecycle au Market ID canonique résolu côté serveur. L’identité active devient `(signal_type, market_id, entity_type, entity_id)` pour éviter tout écrasement cross-market. |
| `alerts` | Alertes. |
| `incidents` | Incidents. **Migration 230 (2026-09-15, `intended_migration_schema`)** : + `origin_domain`, `resolver_domain` et `resolution_class` pour persister dès la création le domaine d'origine, l'autorité capable de fournir la prochaine vérité/preuve valide et la classe de résolution (`PHYSICAL_PROOF` / `UPSTREAM_TRUTH`). Les historiques `reconciliation_error` ambigus restent explicitement `UNCLASSIFIED` plutôt que d'inventer une autorité. **Migration 231 (2026-09-15, `intended_migration_schema`)** : + `due_at` TIMESTAMPTZ nullable pour persister l'échéance SLA des nouveaux incidents gouvernés sans inventer d'échéance historique, et + `escalation_level` INTEGER NOT NULL DEFAULT 0 comme marqueur durable/idempotent d'escalade ; une échéance dépassée augmente l'urgence mais ne crée jamais la vérité nécessaire à une résolution. |
| `unsold_items` | Items invendus. |
| `business_rules` | Règles métier. |
| `business_rules_history` | Historique règles. |
| `economic_snapshots` | Snapshots économiques. |

### 4.14 Discovery locale — stock Komerce local & offres tierces (Vague 2)

> **État Railway** : migrations 154–157 confirmées live dans le dump Railway ; les objets `local_stock`, `providers`, `services`, `inquiries`, `physical_offers` et `local_stock_allocations` sont des vérités de schéma vérifiées, plus des intentions `schema-pending`.

| Table | Rôle |
|---|---|
| `local_stock` | Stock physique vendable détenu par Komerce par marché et localisation ; distinct du stock import/SKU et de l’inventaire de transit. Migration 157 ajoute commercial_exposure et le cycle d’allocation. **Migration 154 — promue le 2026-08-29 (schema-promote, dump live verifie).** |
| `providers` | Tiers local payable portant l’exécution d’un service ou d’une offre physique ; identité distincte de users. **Migration 155 — promue le 2026-08-29 (schema-promote, dump live verifie).** |
| `services` | Prestations de travail proposées par un provider ; exposition commerciale désactivée par défaut. **Migration 155 — promue le 2026-08-29 (schema-promote, dump live verifie).** |
| `inquiries` | Demandes adressées à un provider, sans réservation de ressource ; migration 156 ajoute la cible physical_offer. **Migration 155 — promue le 2026-08-29 (schema-promote, dump live verifie).** |
| `physical_offers` | Produits physiques proposés par un tiers local, séparés des prestations de service. **Migration 156 — promue le 2026-08-29 (schema-promote, dump live verifie).** |
| `local_stock_allocations` | Engagements de commandes sur local_stock avant paiement, avec cycle allocate/consume/release anti-survente. **Migration 157 — promue le 2026-08-29 (schema-promote, dump live verifie).** |


---

### 4.15 Infrastructure technique — Outbox transactionnel (HUB-000 F0)

| Objet | Rôle |
|---|---|
| `outbox_events` | Primitive outbox transactionnelle. Un fait métier et son événement (physical_outcome_reported) écrits dans la même transaction côté appelant (services/outbox-producer.js) ; livraison at-least-once, retry durable (attempts/last_error), append-only. **Migration 228 — promue le 2026-10-16 (schema-promote, dump live verifie).** |
| `physical_outcome_receipts` | Reçu d'audit durable du consumer minimal réel F0 (services/outbox-worker.js), sans effet métier. Idempotence garantie par UNIQUE(event_id, consumer_key). **Migration 228 — promue le 2026-10-16 (schema-promote, dump live verifie).** |




---

### 4.16 Tables promues depuis les blocs schema-pending (lot C, dump live vérifié)

| Table | Rôle |
|---|---|
| `cash_custody_provenance_edges` | Revendications de provenance explicites (portions de collecte cash rattachées aux réceptions de garde), append-only ; ne certifie pas la clôture financière. Migration 304. |
| `catalog_media_recovery_audit` | Preuve append-only de la restauration explicite de médias fournisseur sur un ensemble `catalog_media` vide ; ni décision de publication ni autorisation marché. Migration 351. |
| `demo_kpr_backup_20261024` | Sauvegarde ponctuelle de démo du 2026-10-24 ; vidage validé par l'utilisateur (classification staging-reset), pas de DROP. Hors flux applicatif. |
| `demo_kpr_exposure_backup_20261024` | Sauvegarde ponctuelle de démo du 2026-10-24 (exposition) ; vidage validé par l'utilisateur (classification staging-reset), pas de DROP. Hors flux applicatif. |
| `e2e_test_accounts` | Comptes de test E2E marqués ; écrit uniquement par `scripts/recette/staging-e2e-provision.js`, lu par `services/simulation-visibility.js`. Migration 397. |
| `financial_movement_documents` | Pièces justificatives d'un mouvement financier (plusieurs par mouvement, sans doublon). Migration 360. |
| `financial_movements` | Journal financier canonique : projection idempotente des faits métier (natif + EUR + taux figés + état + provenance), pas de partie double. Migration 360. |
| `fx_pegs` | Seul peg admis USD→DJF (Banque centrale de Djibouti), append-only, daté (`valid_from`). Migration 311. |
| `fx_public_reference_quotes` | Cotations EUR/XXX BCE datées, sourcées, ingérées automatiquement et immuables ; distinctes des observations manuelles. Migration 319. |
| `fx_rate_observations` | EUR→USD flottant sourcé, daté, approuvé par une 2e personne ; distinct de `currency_parities`. Migration 311. |
| `hub_authorization_grants` | Grants d'autorisation directrice Hub (`purchase_commitment`, `supplier_payment`) attribués/révoqués par l'Admin central ; aucun rôle ajouté. Migration 380. |
| `international_n1_reconciliations` | Snapshot idempotent du N1 international réel par expédition ; ne prévoit ni N3 ni prévision. Migration 355. |
| `international_shipment_charges` | Faits de frais documentaires d'expédition internationale, non ventilés au N1 tant que le rapprochement douane n'est pas certifié. Migration 354. |
| `international_shipment_events` | Journal d'événements/preuves de l'expédition internationale. Migration 354. |
| `international_shipment_hub_units` | Lien carton KOM-BOX (`hub_physical_units`) → expédition internationale du même marché. Migration 358. |
| `international_shipment_relay_receipts` | Attestations de réception relais par article d'expédition (attendu/reçu), écart traçable via `incidents`. Migration 364. |
| `international_shipments` | Transport international réel séparé des déclarations douanières ; progression par preuves et frais de fret facturés. Migration 354. |
| `market_central_collection_modes` | Moyens d'encaissement central (`stripe_eur`, `paypal_eur`) autorisés par marché ; absence ou `revoked_at` = refus. Migration 307. |
| `market_delivery_attestations` | Preuve centrale, vérifiable et révocable, qu'une liaison de transport et un tarif applicable existent pour un marché. Migration 305. |
| `market_transport_sale_rates` | Tarif de vente transport par Market (devise du marché, par kg) ; absent = refus hors KMF ; distinct du coût de fret attesté. Migration 313. |
| `order_item_refund_reservations` | Réservations partielles de remboursement par article adossées à une attestation relais et à une intention PSP durable ; aucune sortie de fonds automatique. Migration 365. |
| `purchase_order_authorizations` | Décisions append-only de la directrice Hub sur un bon de commande (`purchase_commitment` ou `supplier_payment`) ; UPDATE/DELETE refusés. Migration 380. La migration 408 ajoute `commitment_pdf`, document privé figé à la validation des nouveaux engagements. Les décisions historiques conservent une valeur NULL. |
| `refund_execution_intents` | Intention de remboursement durable avant appel Stripe/PayPal ; aucun backfill legacy automatique. Migration 317. |

## 5. Vues critiques

| Vue | Rôle | Consommée par |
|---|---|---|
| `v_order_margins` | Marges par commande (estimée + réelle). | Pilotage / dashboards admin |
| `v_order_fulfillment` | Statut fulfillment agrégé. | Control Tower |
| `v_parcel_trace` | Trace complète colis. | Suivi client + relais |
| `v_hub_transit` | Vue transit hub. | Dashboard hub |
| `v_sourcing_pipeline` | Pipeline sourcing. | Admin sourcing |
| `v_unsold_pipeline` | Pipeline invendus. | Admin / alertes |
| `v_loyalty_summary` | Synthèse fidélité par user. | Admin loyalty |
| `v_ceremony_orders` | Vue agrégée commandes cérémonie. | Admin modules |
| `v_customs_analysis` | Analyse douane. | Admin douane |
| `v_active_product_suppliers` | Fournisseurs actifs par produit. | Sourcing |
| `customs_effective_rates` | Taux douane effectifs. | Pricing |
| `customs_taux_actuel` | Taux douane actuel. | Pricing |
| `customs_taux_mensuel` | Évolution mensuelle. | Admin |
| `suppliers_stats` | Stats fournisseurs. | Admin |
| `product_variants_ordered` | Variantes commandées. | Admin |
| `v_parcel_reconciliation` | Réconciliation colis (dernier event, poids, écarts). Détectée non documentée et non déployée par gate:migration-doc le 2026-07-03. **Migration 094 — promue le 2026-07-14 (schema-promote, dump live verifie).** | Admin logistique |
| `v_shipment_density` | Densité par shipment : poids, volume, tonnage taxable W/M, fill_rate_pct, margin_kmf_per_m3 (KPI doctrinal). Lecture seule, tolère les volumes NULL. Doctrine : DOCTRINE_DENSITE_VALEUR. **Migration 095 — promue le 2026-07-14 (schema-promote, dump live verifie).** | Admin logistique / calibration V-5 (docs/ops/NOTE_OPS_CALIBRATION_DENSITE_V5.md) |


---

## 6. Triggers et garde-fous DB

Au-delà du code applicatif, la DB enforce elle-même plusieurs invariants :

| Trigger | Table | Rôle |
|---|---|---|
| `trg_no_delete_parcels` | `parcels` | Bloque DELETE direct. |
| `trg_parcel_ship_guard` | `parcels` | Contrôle transitions colis. |
| `trg_check_parcel_item_qty` | `parcel_items` | Vérifie cohérence quantité colis vs commande. |
| `trg_compute_real_margin` | `orders` | Recalcule marge réelle. |
| `trg_customs_anomaly` | `customs_history` | Flag anomalies taux douane. |
| `prevent_incident_delete` | `incidents` | Anti-suppression incidents. |
| `prevent_scan_event_delete` | `scan_events` | Anti-suppression scans. |
| `auto_unsold` | déclenché | Bascule auto en `unsold_items`. |
| `set_updated_at` × 17 tables | divers | Maintien `updated_at` automatique. |
| `sync_has_variants` | `products` | Synchronise flag variantes. |

---

## 7. Contraintes CHECK notables

| Contrainte | Garantie |
|---|---|
| `cost_components_family_category_consistency` | Cohérence `family` ↔ `category` du composant coût. |
| `cost_components_allocation_check` | Méthode d'allocation valide. |
| `cost_components_island_check` | Île valide. |
| `competitor_target_check` | Prix concurrent : produit OU catégorie obligatoire. |
| `parcels_type_check` | Type de colis valide. |

---

## 8. Conventions transverses

- **Identifiants** : `uuid` partout.
- **Timestamps** : `created_at`, `updated_at`, timestamps d'événement nommés `<step>_at`.
- **Devises** : suffixe explicite `_kmf`, `_eur`, `_aed`; les snapshots fournisseur multi-devise utilisent le couple explicite `supplier_unit_price` + `supplier_currency`, sans conversion implicite.
- **Statuts** : ENUMs typés, pas de string libre.
- **Soft-delete** : pas de DELETE pour `parcels`, `incidents`, `scan_events`.
- **Idempotence** : `idempotency_key` pour wallet, `stripe_events_processed` pour webhooks Stripe.

---

## 9. Liens avec les autres documents socle

- **`KOMERCE_DB_SCHEMA_DOCTRINE.md`** — gouvernance obligatoire des migrations et du schéma vivant.
- **`KOMERCE_ARCH_GRAPH_DOCTRINE.md`** — synchronisation obligatoire avec headers et graphe.
- **`CARTOGRAPHY_360.md`** — domaines API et points de vérité.
- **`ZONE_IMPACT.md`** — invariants I-01 à I-10 qui protègent ce schéma au niveau code.
- **`CONTRACTS.md`** — services qui consomment et mutent ces tables.
- **`SCHEMA_GAP_KOMERCE.md`** — analyse historique des divergences `schema.sql` / migrations / runtime.
- **`ADR-009-source-verite-unifiee.md`** — `finance_config` comme singleton.

---




## 10. Règle de divergence schéma ↔ code ↔ doc

Voir `AGENTS.md` § "Règle de divergence". En résumé :

1. La **DB live** fait foi.
2. Ce document doit être régénéré contre la DB à chaque fin de session qui modifie le schéma.
3. Si un développeur trouve une divergence : signaler dans `docs/chantier/STATUS.md` section "Pièges critiques", ne pas modifier silencieusement.

---

## 11. Pipeline de régénération du dump (depuis juin 2026)

Le dump Railway n'est plus jamais généré à la main. Le pipeline est entièrement automatisé.

### Déclenchement automatique

À chaque merge d'une migration sur `main`, GitHub Actions lance `schema-refresh.yml` :

1. `node scripts/db-snapshot.js` — se connecte à Railway via `RAILWAY_DATABASE_URL` (secret GitHub), exécute `pg_dump --schema-only`, neutralise les artefacts PG18 (`\\restrict`, `transaction_timeout`), écrit atomiquement dans `docs/db/railway-live-schema.sql`.
2. `node scripts/check-schema-freshness.js` — vérifie que toutes les colonnes, tables et vues déclarées dans `migrations/*.sql` sont présentes dans le dump lorsqu'elles doivent déjà être live. Bloque si le dump est partiel.
3. PR automatique `chore/schema-refresh-auto` créée si le dump a changé — à merger sans délai.

### Déclenchement manuel

```bash
# Depuis GitHub Actions → schema-refresh.yml → Run workflow
# ou en local si RAILWAY_DATABASE_URL est disponible :
npm run db:snapshot
node scripts/check-schema-freshness.js
```

### Ce qui NE doit plus jamais être fait

```bash
# ❌ SUPPRIMÉ — ne plus utiliser
pg_dump "$DATABASE_URL_PROD" > db/schema.sql
scripts/refresh-schema.sh
```

`db/schema.sql` est supprimé du repo. `docs/db/railway-live-schema.sql` est la seule source.

### Utilisation en CI (ci.yml)

Le job `integration` charge le dump committé et applique les migrations post-snapshot :

```bash
psql "$DATABASE_URL" -f docs/db/railway-live-schema.sql
node scripts/ci-migrate.js   # baseline git dynamique + migrations nouvelles
```

`ci-migrate.js` calcule via `git log/ls-tree` les migrations déjà présentes dans le dump au moment de son dernier commit — il ne rejoue jamais une migration déjà dans le dump.

---

## 12. Dette schéma connue

1. **2 dossiers de migrations** (`db/migrations/` legacy + `migrations/` actif) — non bloquant mais à clarifier.
2. **Collisions de numéros** dans `migrations/` : `060.sql` + `060_add_pending_at_confirmed_at.sql` ; `061.sql` + `061_boutique_categories.sql`.
3. **`db/schema.sql`** est obsolète (mars 2026, v1.3). Ce document le remplace comme référence d'état réel.
4. **Présence DB live de `revoked_tokens`** : à vérifier sur Railway. Le code et la migration sont prêts ; la DB live reste la source de vérité finale.
5. **Trou apparent** dans la numérotation migrations entre 025 et 033 — vérifier l'historique git si nécessaire.















### boutique_subcategories canonical imagery

The canonical boutique taxonomy owns stable navigation imagery at subcategory level.

- `boutique_subcategories.image_url`: versioned canonical visual used by boutique subcategory navigation; independent from supplier/product ingestion.
- `boutique_subcategories.image_alt`: descriptive alternative text for the canonical subcategory visual.
- Source migration: `252_boutique_subcategory_canonical_images.sql`.
- These fields are presentation metadata only; they do not change product taxonomy matching or sourcing identity.


### Registre opérateur des sources (migration 260)

- `sourcing_sources.connection_test_status`: dernier test de connexion opérateur (`ok` / `failed`), nullable ; informatif, jamais une certification runtime.
- `sourcing_sources.connection_test_code`: code métier court du dernier échec (jamais de message fournisseur brut ni de secret).
- `sourcing_sources.connection_tested_at`: horodatage du dernier test de connexion.


### Cycle de vie des sources (migration 261)

- `sourcing_sources.display_name`: libellé opérateur (affichage uniquement, NULL = libellé du connecteur, 1 à 80 caractères) ; jamais un identifiant.
- `sourcing_provider_control_events.capability`: accepte désormais `lifecycle` (archivage / restauration d'une source ; `old_value`/`new_value` = « source active »). Une source archivée garde `status='disabled'` : captures, observations, KIR, capacités et certification restent intacts ; aucune ligne n'est supprimée.

### Coffre des identifiants fournisseur (migration 262)

- `sourcing_sources.credential_ref`: colonne existante depuis la migration 226, désormais liée par clé étrangère (`sourcing_sources_credential_ref_fk`, `NOT VALID` : aucune valeur historique n'est imposée, toute nouvelle écriture est protégée) au credential actif de la source. Jamais un secret : seulement une référence `cred_<32 hex>`.
- `sourcing_provider_control_events.capability`: accepte désormais `credentials` (configuration, remplacement, révocation, liaison OAuth ; `old_value`/`new_value` = « credential valide avant / après »). Aucun secret n'est tracé.


### Provider control policy (migration 255)

- `sourcing_sources.discovery_enabled`: autorisation opérateur explicite de découverte automatique; défaut OFF.
- `sourcing_sources.sync_enabled`: autorisation opérateur explicite de synchronisation fournisseur; défaut OFF.
- `sourcing_sources.import_enabled`: autorisation opérateur explicite de passage automatique vers l'import canonique; défaut OFF.
- `sourcing_sources.production_enabled`: autorisation opérateur de production; défaut OFF et activation fail-closed tant qu'une preuve runtime par fournisseur n'existe pas.


### Provider runtime certification (migration 256)

- `sourcing_sources.production_certified_capture_id`: référence la capture `complete` exacte ayant produit une preuve runtime fournisseur `CANONICAL_RESOLVED`; NULL tant qu'aucune preuve réelle n'existe.
- `sourcing_sources.production_certified_at`: horodatage durable de cette certification runtime; NULL par défaut.
- La certification n'est jamais saisie manuellement : elle est écrite uniquement après un import API dont la comptabilité sourcing est équilibrée, dont toutes les identités shadow sont résolues et dont aucun produit n'a échoué.
- `production_enabled=true` reste impossible sans ces deux champs.

### Import runtime runs (migration 257)

Projection opérationnelle d'un import réel pour l'écran live `/admin/import-runtime`. La table ne duplique pas la comptabilité métier : elle conserve seulement l'identité du run, son rattachement à l'import, les horodatages des jalons et un snapshot d'intake ; les compteurs sont recalculés depuis les autorités Sourcing/Certification existantes.


### Import runtime item events (migration 258)

Télémétrie best-effort d'un import réel : un événement par produit traité (début, fin, issue, prix source affiché). Ce n'est pas une autorité métier : le cockpit `/admin/import-runtime` l'affiche pour montrer le produit en cours et les durées, et retombe sur la projection historique quand le run n'a aucun événement.





### Boutique commercial object matching (migration 290)

`boutique_subcategories.object_classification_terms` (`jsonb`, non-null, default `{}`) stores administrator-editable weighted object phrases for boutique routing, independent from `customs_categories.classification_terms`. Active boutique categories/subcategories are eligible; only product-title evidence may be used. A unique match can propose a boutique subcategory; ambiguous/no matches remain unresolved. Migration 290 also adds `Auto / Accessoires` when `Auto` is active, without customs affinity. No supplier import, catalogue publication or customs reclassification is performed by this migration.

### Supplier commercial category correspondence (migration 292)

| Objet | Rôle |
|---|---|
| `supplier_commercial_category_mappings` | Mapping commercial fournisseur + chemin source normalisé vers paire boutique active, statut de validation et proposition de libellé français ; aucune autorité douanière ou publication. **Migration 292 — promue le 2026-10-16 (schema-promote, dump live verifie).** |


`supplier_commercial_category_mappings` records source provider and normalized original path, optional source ID, source locale, optional French proposal label, and an active Komerce boutique category/subcategory pair. `status` is `PROPOSED`, `REVIEW_REQUIRED` or `CONFIRMED`; only confirmed mappings targeting active boutique taxonomy are eligible for automatic routing. This mapping is independent from customs, tax, economic margins, publication and supplier KIR certification. Missing categories must be kept for review rather than rejected.


## Sourcing candidate independent boutique attachment (migration 293)

`sourcing_candidates.commercial_taxonomy_review` (`jsonb`, nullable, `intended_migration_schema`) stores a confirmed active boutique category/subcategory from supplier-path mapping independently of `komerce_category`, scan outcome and customs qualification. Existing candidate rows remain unchanged until the explicit audited batch attachment; journal entries are added to `sourcing_candidate_events` only for newly attached candidates. No KIR historical mutation or catalogue publication is implied.


### Customs financial correction audit (migration 295)

| Objet | Rôle |
|---|---|
| `customs_shipment_financial_audit` | Append-only evidence of customs shipment financial corrections with old/new JSONB snapshots, optional actor and reason, and same-transaction trigger. **Migration 295 — promue le 2026-10-16 (schema-promote, dump live verifie).** |


`customs_shipment_financial_audit` records a transactionally captured immutable before/after snapshot when a shipment's customs amount, freight or allocation method/configuration changes. Actor and reason are copied only from explicit transaction context; absent context stays NULL. The audit is evidence, not a replacement for the customs allocation engine, estimated customs rates, or the real-margin shadow calculator.



### Visual French media review evidence (migration 296)

| Objet | Rôle |
|---|---|
| `catalog_media_visual_fr_reviews` | Preuve de relecture visuelle francaise associee a une image, sa variante, son auteur et sa date ; aucune publication automatique. **Migration 296 — promue le 2026-10-16 (schema-promote, dump live verifie).** |


`catalog_media_visual_fr_reviews` records human review of source image text linked to `catalog_media`, keeping source URL, variant, author and review date. An image or variant change invalidates its review at reading time. No automatic backfill or publication authority.



### Customs typed shipment fees (migration 297)

| Objet | Rôle |
|---|---|
| `customs_shipment_fees` | Append-only typed customs fee journal (charge/credit, proof and idempotency required, currency traced, KMF borne is authoritative) feeding conserved port_transitaire allocations. **Migration 297 — promue le 2026-10-16 (schema-promote, dump live verifie).** |


`customs_shipment_fees` is an append-only journal of real, justified customs-side fees per shipment (`handling`, `storage`, `forwarder`, `local_tax`, `exceptional`, `other`). No row for a type means unknown; a `charge` at 0 means confirmed zero; `credit` rows correct downwards. Global customs duties stay in `customs_shipments.customs_paid_kmf` and freight in `freight_kmf` (no double count). Fees are allocated to order items as `port_transitaire` (source `customs_shipment_fees`) by the existing conserving allocator; estimates, customer prices and margin writers are untouched.


Migration 300 ajoute `customs_shipment_fees.post_closure` (boolean, défaut false) : marque les lignes de frais enregistrées après clôture de l'expédition (status confirmed) ; correction tracée par nouvelle ligne avec motif obligatoire, le montant d'origine n'est jamais réécrit.

### Customs shipment parcel membership events (migration 299)

| Objet | Rôle |
|---|---|
| `customs_shipment_parcel_events` | Append-only attach/detach journal for parcels of an open customs shipment (actor, reason required), supporting traceable groupage composition changes. **Migration 299 — promue le 2026-10-16 (schema-promote, dump live verifie).** |


`customs_shipment_parcel_events` is an append-only journal of parcel attach/detach events on an open customs shipment (groupage). Every event carries actor, date and a mandatory reason; UPDATE/DELETE are refused. It deliberately has no foreign key (like `customs_shipment_financial_audit`) so the evidence survives deactivation. Cost lines are re-allocated by the existing conserving allocator in the same transaction; prices and margin writers are untouched.


<!-- schema-pending: cash_custody_provenance_edges (migration 304, now live) -->
### Cash custody provenance edges (migration 304 — intended_migration_schema)

`cash_custody_provenance_edges` is a new append-only table proposed by migration 304. It associates explicit collection-level cash portions with custody receipt events, with optional parent edges for multi-hop transfers, conservation ceilings and Market consistency. It is not a second custody balance authority and does not establish final financial closure. Migration remains draft and requires isolated PostgreSQL verification for reversals, losses, concurrency and end-to-end traceability before merge.
<!-- /schema-pending -->

<!-- schema-pending: hub_authorization_grants (migration 380, now live) -->
### Hub authorization grants (migration 380 — intended_migration_schema)

`hub_authorization_grants` is a new table proposed by migration 380. It records which Hub account holds which directrice authorization (`purchase_commitment` or `supplier_payment`), granted and revoked by the central Admin (`granted_by`, `revoked_by`, `revoke_reason`). At most one active grant per user and type. It adds no role: it only states who may take the two distinct decisions recorded in `purchase_order_authorizations`.
<!-- /schema-pending -->

<!-- schema-pending: e2e_test_accounts (migration 397, now live) -->
### E2E test accounts (migration 397 — intended_migration_schema)

`e2e_test_accounts` is a new table proposed by migration 397. It marks the test accounts provisioned for E2E recette (`user_id` primary key referencing `users`, `created_by`, `created_at`). It is written only by `scripts/recette/staging-e2e-provision.js` (idempotent, staging guards); no route or screen writes to it. It is read by `services/simulation-visibility.js` (`isE2eTestAccount`): only a marked account sees `orders.simulation_scope` orders in the operations workspace queues. Empty table = nobody sees simulation.
<!-- /schema-pending -->

<!-- schema-pending: purchase_order_authorizations (migration 380, now live) -->
### Purchase order authorizations (migration 380 — intended_migration_schema)

`purchase_order_authorizations` is a new append-only table proposed by migration 380. Each row is one directrice decision on a purchase order (`purchase_commitment` or `supplier_payment`) with decider, timestamp, amount, currency and proof reference. One decision per type and PO; UPDATE and DELETE are refused. A submitted PO is never an implicit commitment, and a payment is never implicitly authorized.
<!-- /schema-pending -->

<!-- schema-pending: market_delivery_attestations (migration 305, now live) -->
### Market delivery attestations (migration 305 — intended_migration_schema)

`market_delivery_attestations` is a new table proposed by migration 305 (Lot B, audit P1–P7). It carries the central proof that a Market is deliverable: a referenced carrier (`carriers`), mode, origin, strictly positive freight rate with currency/unit, transit days, documentary evidence reference, bounded validity and the central attestor; revocation is explicit (`revoked_at/by/reason`). It is not a boolean flag and has no backfill. Checkout refuses a Market without a valid attestation (or, for Markets with real collected-order history, the HISTORY basis). Writers: `services/market-delivery-proof-service.js` via central-admin routes only.
<!-- /schema-pending -->

<!-- schema-pending: market_central_collection_modes (migration 307, now live) -->
### Market central collection modes (migration 307 — intended_migration_schema)

`market_central_collection_modes` is a new table proposed by migration 307 (lot 3, stabilisation multi-pays). It states, per Market, which central collection mode (`stripe_eur`, `paypal_eur`) is authorised, with a mandatory `evidence_ref`, the authoriser and an explicit `revoked_at`. Absence of a row means refusal (fail-closed). Backfill: KM only, to preserve current behaviour; CM/CG/DJ receive no authorisation until the owner defines the fund holder. Reader: `services/market-payment-collection-gate.js` (checkout, Stripe intent, PayPal create-order).
<!-- /schema-pending -->

<!-- schema-pending: fx_rate_observations (migration 311, now live) -->
### Taux EUR→USD observés (migration 311 — intended_migration_schema)

`fx_rate_observations` est une nouvelle table **not yet live** : EUR→USD flottant, sourcé, daté, approuvé par une deuxième personne, append-only, aucune valeur pré-remplie. Lecteur : `services/fx-chain-service.js` (fail-closed `fx_rate_unavailable`). Doctrine : `docs/doctrine/FX_CHAIN_DJF.md`.
<!-- /schema-pending -->

<!-- schema-pending: fx_pegs (migration 311, now live) -->
### Pegs de change (migration 311 — intended_migration_schema)

`fx_pegs` est une nouvelle table **not yet live** : seul peg admis USD→DJF (Banque centrale de Djibouti), daté, append-only. Lecteur : `services/fx-chain-service.js`. Migration 312 : bande 100–300, TRUNCATE interdit. Migration 314 : 2e peg USD→AED (3,6725, bande 3–4,5), unicité (devise, valid_from).
<!-- /schema-pending -->

<!-- schema-pending: market_transport_sale_rates (migration 313, now live) -->
### Tarifs de vente transport par Market (migration 313 — intended_migration_schema)

`market_transport_sale_rates` est une nouvelle table **not yet live** : tarif de vente du transport par Market (clés `SEA_KMF_PER_KG_COMMERCIAL` / `AIR_KMF_PER_KG_TAXABLE` de `business_rules`, par kg dans la devise du marché, convertis en KMF de base par la voie gouvernée : parités fixes ou chaîne FX DJF), avec pièce justificative obligatoire, un seul tarif actif par (Market, clé), révocable. Absence de tarif = refus fail-closed hors marché KMF ; le coût de fret attesté n'est jamais un prix. Lecteur : `services/market-transport-sale-rates.js` (checkout).
<!-- /schema-pending -->


<!-- schema-pending: refund_execution_intents (migration 317, now live) -->
### Intentions de remboursement (migration 317 — intended_migration_schema)

`refund_execution_intents` est une nouvelle table **not yet live**. Elle conserve l'intention avant tout appel PSP Stripe/PayPal : commande, marché, capture, événement stable, montant EUR et statut. Les anciennes lignes `refunds` sont à rapprocher avant activation. Service propriétaire : `services/refund-intent-ledger.js` (non activé). Contrat : `docs/architecture/REFUND_EXECUTION_AUTHORITY.md`.
<!-- /schema-pending -->


<!-- schema-pending: fx_public_reference_quotes (migration 319, now live) -->
### Cotations officielles EUR/XXX — migration 319 (`intended_migration_schema`)

`fx_public_reference_quotes` est une nouvelle table **not yet live**, déclarée par `migrations/319_fx_public_reference_quotes.sql`. Cotations publiques BCE EUR/XXX ingérées automatiquement, identifiées par `(base_ccy, quote_ccy, as_of)` ; champs `id`, `rate`, `source_label`, `source_ref`, `ingested_at`. Seules les cotations BCE officielles datées sont acceptées, sans imposer de validation humaine fictive. Invariants : append-only, pas de DELETE/TRUNCATE, pas de réécriture rétroactive, horodatage de collecte ; parités fixes KMF/XAF maintenues exclusivement dans `currency_parities`. Écrivain : `services/fx-public-reference-feed.js` ; lecteur : `services/fx-chain-service.js` ; snapshot transactionnel via `services/fx-authority.js`. Le bloc doit être promu par `schema-promote` lorsque la migration est réellement attestée dans le dump live Railway.
<!-- /schema-pending -->


<!-- schema-pending: catalog_media_recovery_audit (migration 351, now live) -->
### Catalogue — audit de réintégration des médias (migration 351, en attente de promotion)

`catalog_media_recovery_audit` conserve l'identité produit, la référence candidat fournisseur, l'acteur, la liste des identités médias fournisseur et l'empreinte SHA-256 du sous-ensemble média, avec les comptages avant/après. Le service `catalog-media-recovery` n'ajoute des médias à un brouillon inactif précédemment vide qu'après preuve source V2, sous autorisation Catalogue + Sourcing et transaction commune avec la ligne d'audit. Aucune publication ni exposition marché. Migration en PR, **non appliquée au staging** à ce stade.
<!-- /schema-pending -->

### Expéditions internationales — migration 354 (intended_migration_schema)

<!-- schema-pending: international_shipments (migration 354, now live) -->

`international_shipments` — Transport international réel : transitaire, mode, étape prouvée, volume, facture fret, suivi conteneur/BL et ETA ; dossier douane distinct.

<!-- /schema-pending -->

<!-- schema-pending: international_shipment_parcels (migration 354, not yet live) -->

`international_shipment_parcels` — Composition physique : un colis par dossier, volume Hub et identité conservée.

<!-- /schema-pending -->

<!-- schema-pending: international_shipment_events (migration 354, now live) -->

`international_shipment_events` — Preuves append-only de transitions, acteur et horodatage ; ETA révisable avec historique.

<!-- /schema-pending -->

<!-- schema-pending: international_shipment_charges (migration 354, now live) -->

`international_shipment_charges` — Frais réels d'arrivée et de transport local, documentés, idempotents et append-only ; non ventilés en N1 sans rapprochement.

<!-- /schema-pending -->

### Rapprochement économique N1 international — migration 355 (pending live)

<!-- schema-pending: international_n1_reconciliations (migration 355, now live) -->

`international_n1_reconciliations` — Dernière empreinte documentaire réconciliée par expédition internationale, conservation du fret, frais d'arrivée et transport local ; reprise idempotente, jamais estimation N3.

<!-- /schema-pending -->

<!-- schema-pending: international_n1_allocation_links (migration 355, not yet live) -->

`international_n1_allocation_links` — Provenance exclusive des allocations N1 `order_item_real_cost_allocations` depuis un transport international ; isolation des écritures douane existantes, liens de colis et de lignes de commande.

<!-- /schema-pending -->

### Libellés de coûts par marché — migration 356 (intended_migration_schema)

<!-- schema-pending: cost_component_market_overrides.label_override (migration 356, not yet live) -->
<!-- schema-pending: cost_component_market_overrides.description_override (migration 356, not yet live) -->

La migration 356 ajoute des libellés et descriptions spécifiques aux marchés, historisés et sans mutation du référentiel global.

<!-- schema-pending: international_shipment_hub_units (migration 358, now live) -->
### Hub P0 — lien carton KOM-BOX → expédition (migration 358 — intended_migration_schema)

`international_shipment_hub_units` is a new table proposed by migration 358 (#3247). It links a packed single-market KOM-BOX (`hub_physical_units`, `unit_type = MARKET_PARCEL`) to at most one `international_shipments` row of the same market while the shipment is still `hub_ready`. Columns: `shipment_id`, `physical_unit_id` (UNIQUE), `attached_by`, `attached_at`. Triggers refuse a non-packed unit, a cross-market link, a closed shipment, any UPDATE, and a DELETE after handover.
<!-- /schema-pending -->


### Ouverture des dossiers Hub et remise attestée — migration 359 (intended_migration_schema)

La migration 359 ajoute **`international_shipments.hub_draft`** (booléen, défaut `false`) et autorise `forwarder_name` / `transport_mode` nuls uniquement avant la remise (`hub_ready`). Un brouillon Hub peut être créé sans carton et sans transitaire, sur un marché résolu côté serveur. Les anciens dossiers de transport (`hub_draft=false`) conservent leurs références `parcel_refs`.

Le journal `international_shipment_events` accepte les événements `opened`, `box_attached` et `box_detached` avec preuve documentaire NULL (faits opérateur), sans jamais confondre ces événements avec le transfert de garde. La transition `handed_over` exige toujours une **preuve réelle** ; pour un brouillon Hub elle exige aussi un transitaire, un mode et au moins un KOM-BOX `DISPATCHED` sans anomalie (garde du service **et** trigger PostgreSQL). Les liens carton deviennent immuables après la remise (migration 358). La douane et N1 restent la suite #3250, hors du scope 359.

### Fournisseurs locaux du Hub — migration 362 (intended_migration_schema)

La migration 362 ajoute **`suppliers.owner_scope`** (`NULL` = catalogue global géré par l'admin ; `hub` = fournisseur local créé par le Hub, plateforme `local`/`whatsapp`, sans `auto_order`) et **`suppliers.created_by`** (utilisateur créateur). Le périmètre Hub ne modifie jamais le catalogue global et le déclencheur d'achat automatique ignore les fournisseurs `owner_scope = 'hub'`.

<!-- schema-pending: financial_movements (migration 360, now live) -->
<!-- schema-pending: financial_movement_documents (migration 360, now live) -->
### Journal financier canonique — migration 360 (intended_migration_schema)

`financial_movements` is a new append-only journal (migration 360, Lot 5). One row per projected business fact, idempotent on `movement_key = source_kind:source_id:facet`. It keeps the **native amount and currency**, the EUR amount (`amount_eur`, `fx_status` ∈ snapshot / converted / native_eur / unavailable) with the frozen FX `fx_legs`, the business `state` (planned → committed → observed → settled → reversed, forward-only), the `provenance` and the links (market, order, purchase order, shipment, parcel, supplier, relay). A trigger freezes identity, native amounts, EUR and rates, forbids DELETE and any state regression. It is **not a double-entry ledger** (no debit/credit accounts). `financial_movement_documents` stores the supporting documents (proof references) of a movement, unique per (movement, kind, reference).
<!-- /schema-pending -->


### Migration 361 — intention de schéma : coûts documentés par expédition (staging)

La **migration 361** harmonise le transport canonique KOM-BOX et la projection économique :
- `international_n1_reconciliations.total_customs_kmf` : droits/taxes de douane **réellement documentés** pour l'expédition, pas une allocation par article.
- `international_n1_reconciliations.total_customs_fees_kmf` : coûts annexes facturés dans le dossier douane, consolidés sans doublon.
- `international_n1_reconciliations.documented_total_kmf` : somme des **postes documentés** du dossier. Ne pas assimiler à un total définitif si des postes sont inconnus.
- `international_n1_reconciliations.financial_closed_at`, `financial_closed_by`, `financial_close_proof_ref` : clôture économique datée, avec acteur et justificatif, séparée de la réception physique au relais.
- `international_shipment_events.event_type = customs_amount_confirmed` : événement audité portant la preuve de déclaration des droits d'expédition, distinct des changements d'état physiques.
- `international_shipment_parcels` et `international_n1_allocation_links` : anciennes tables de jointure **retirées uniquement si vides** ; abort explicite de migration sinon. Le modèle canonique physique est `international_shipment_hub_units`. Toute imputation automatique de fret/douane aux lignes de commande est supprimée pour les expéditions internationales.
La projection N1 prévisionnelle du pricing reste intacte ; l'ajustement prévision/réel se lit au niveau expédition/marché/période sans doubler les charges.

<!-- schema-pending: international_shipment_relay_receipts (migration 364, now live) -->
### Attestations de réception relais (migration 364 — intended_migration_schema)

`international_shipment_relay_receipts` est une nouvelle table (migration 364, Relais live). Une ligne = l'attestation immuable d'un agent relais pour un article d'une expédition internationale : `expected_qty` (placé en KOM-BOX de l'expédition), `received_qty`, `proof_ref` obligatoire, `incident_id` en cas d'écart. Unicité `(shipment_id, order_item_id)` ; UPDATE/DELETE refusés par trigger. L'étape `relay_received` du parcours en découle ; elle n'est posée ni par l'admin ni par l'agent Hub.
<!-- /schema-pending -->

### Migration 366 — intention de schéma : réception locale sans expédition fictive

Mode : `intended_migration_schema` (pas encore vérifié dans le dump live). La migration 366 remplace **la fonction existante** `public.check_parcel_item_quantities()` (déclencheur `trg_check_parcel_item_qty`, migration 022) sans créer de table ou de colonne. Elle conserve les contraintes quantités de l'import. Exception stricte : `parcel_items.qty_received > qty_shipped` est autorisée seulement si la ligne `order_items.fulfillment_source='LOCAL_STOCK'` et si un scan `relais_received` de ce même colis/commande, avec acteur identifié, existe dans la transaction. Les colis locaux restent à `qty_shipped=0` ; aucun passage fictif par Hub/transitaire/douane. Rollback : remettre la définition exacte de `check_parcel_item_quantities()` de la migration 022 après arrêt du flux local.


### Migration 390 — retrait de la capacité `execution.order.mark_ordered`

Le writer `mark-ordered` a été retiré par L1 : la commande import payée génère une ligne de besoin et la PO reste un objet distinct.
La capability obsolète est supprimée de `capability_registry`, `membership_capabilities`, `assignment_capability_ceiling` et `ceiling_template_capabilities`. Les anciens audits conservent un snapshot `market_delegation_audit.retired_capability` (lecture historique uniquement, aucune autorité). La FK historique utilise `ON DELETE SET NULL` ; les grants actifs ne peuvent plus référencer cette capability.


<!-- schema-pending: order_item_refund_reservations (migration 365, now live) -->
### E7 — réservations de remboursement par article (migration 365 — intended_migration_schema)

Une réservation pour une quantité d'article réellement manquante au relais, reliée à une attestation immuable `international_shipment_relay_receipts.incident_id` et à une intention PSP déjà enregistrée, avec `operation_key` UUID stable et unique par commande. Les montants KMF/EUR dérivent de l'encaissement d'origine ; aucune nouvelle conversion. Un verrou de commande sérialise les décisions concurrentes et interdit de dépasser la quantité manquante ou le montant capturé. `status=reserved` **ne signifie pas remboursé** ; paiement, preuve PSP et journal `refunds` doivent suivre un circuit distinct avant `confirmed`. La colonne `order_items.qty_refunded` est créée par la même migration, avec contrainte `qty_refunded + qty_collected <= quantity` ; elle n'augmente qu'au même COMMIT que la preuve PSP confirmée et l'écriture du journal financier. Un reliquat manquant peut être remboursé lorsque d'autres quantités ont déjà été remises.
<!-- /schema-pending -->



### Migration 391 — correspondance physique code/SKU (appliquée Railway staging 2026-11-04)

`product_sku_physical_codes` est appliquée sur Railway staging (`schema_migrations`, 2026-11-04 13:09 UTC). Elle conserve le lien code physique → variante Komerce, éventuellement sous fournisseur. Les référentiels commerciaux SKU fournisseur déjà présents restent autoritaires, et une validation manuelle est nécessaire avant d'utiliser un code déclaré comme constat physique. Les commandes clientes restent affectées via les allocations Hub.

### Migration 392 — sac client mono-commande (appliquée Railway staging 2026-11-04)

`hub_physical_units.order_id` (UUID nullable, FK orders) ne s'applique qu'aux `HANDLING_UNIT` utilisés comme sacs clients. L'identifiant de commande est immuable après affectation ; le trigger de placement refuse une quantité réservée à une autre commande. Ce contrôle opère dans PostgreSQL, même si l'appelant contourne l'interface.

### Migration 393 — preuve de dépôt et plan figé du sac (appliquée Railway staging 2026-11-04)

`hub_physical_units.bag_plan` (JSONB nullable) décrit les couples `order_item_id` / `quantity` destinés à cette préparation, y compris partielle. Le plan est immuable après création.

`hub_physical_unit_placements` ajoute `evidence_method` (SCAN, MANUAL, COUNT_ON_MANIFEST), `evidence_code`, `evidence_ref` : toute insertion de quantité dans un sac client exige un code confirmé et conforme au SKU/fournisseur ou une preuve manuelle référencée. La preuve est immuable. Avant PACKED, PostgreSQL vérifie que le contenu actif correspond exactement au plan du sac. Les KOM-BOX restent soumises à leurs invariants existants ; le transport du sac fermé et son lien au relais constituent un jalon distinct à certifier.


### Migration 394 — sac client physiquement contenu dans une KOM-BOX (appliquée Railway staging 2026-11-04)

`hub_box_bags` matérialise le lien immuable entre `HANDLING_UNIT` sac client déjà PACKED, `MARKET_PARCEL` KOM-BOX, et `parcels` colis client. Le scan des références des deux contenants est exigé et vérifié, de même que la mono-commande, le marché, la destination et la correspondance des `parcel_items`.

`hub_box_effective_placements` est une projection SQL de tous les articles physiquement présents dans un carton : placements directs de la KOM-BOX ou placements encore actifs dans les sacs réellement liés. Les allocations ne sont jamais dupliquées ou déplacées fictivement. Les calculs `hub_item_physical_proof`, `hub_item_handed_over`, `sync_parcel_items_from_physical`, la composition de l'expédition et la réception relais utilisent cette projection.

Migrations 391–394 appliquées sur Railway staging le 2026-11-04 à 13:09 UTC (vérifié dans `public.schema_migrations`) ; ne pas les rejouer. Certification E2E staging (marché, réception relais, cas d'erreur) en cours.


<!-- schema-pending: order_comments.hub_stage_key (migration 398, intended_migration_schema; not yet live) -->


<!-- schema-pending: relay_return_compensations (migration 406) -->
### relay_return_compensations (migration 406 — intended_migration_schema)

`relay_return_compensations` is a new append-only table proposed by migration 406. It records one admin-motivated after-handover compensation decision per product-return dispute. Wallet credits commit with the decision. Migration 409 links a PSP decision to its durable `refund_intent_id` and `refund_amount_kmf`; settlement is read from the refund ledger. Migration 410 links a no-charge replacement via `replacement_order_id` and records `order_items.replacement_source_item_id` for the exact original item. The `sav_replacement` payment mode has no client capture.
<!-- /schema-pending -->

### purchase_line_received_quantity (migration 414)

`purchase_line_received_quantity(line_id)` est l'unique définition SQL de la quantité reçue d'une ligne d'achat : placements actifs hors unités `QUARANTINED`/`SUPERSEDED` et hors `outcome_type`. `v_purchase_line_progress.received_quantity` (branche ligne), la répartition de réception d'une PO regroupée et le refus de confirmation sous le reçu l'utilisent. La garde `purchase_lines_guard_groupable` refuse désormais toute ligne sans `product_sku_id`, cas manuel `central_hub` compris (code `purchase_line_variant_required`).
