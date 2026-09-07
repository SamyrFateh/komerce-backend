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
| Tables | 126 | Vérifié sur le dump live Railway. |
| Vues | 17 | Vérifié sur le dump live Railway. |
| ENUMs | 16 | Types métier présents dans le dump live Railway. |
| Index | 342 | Performance + contraintes uniques |
| Foreign keys | 209 | Cohérence relationnelle |
| Fonctions | 17 | Fonctions présentes dans le dump live Railway. |
| Triggers | 34 | Triggers présents dans le dump live Railway. |
| Extensions | `pgcrypto`, `uuid-ossp` | UUID + chiffrement |

---

## 3. ENUMs critiques

| ENUM | Valeurs | Source de vérité |
|---|---|---|
| `order_status` | `pending`, `confirmed`, `ordered`, `preparation`, `shipped`, `in_transit`, `available`, `collected`, `cancelled`, `refunded` | `services/order-status-machine.js` |
| `parcel_status` | `draft`, `preparation`, `shipped`, `in_transit`, `arrived`, `available`, `collected`, `cancelled` | `routes/parcel-api-v2.js` + `services/parcel-service.js` |
| `payment_status` | `pending`, `paid`, `failed`, `refunded`, `partially_paid` | `routes/payments.js` |
| `payment_mode` | `stripe_eur`, `cash_relais`, `mixed_shared_cart_cash` | `routes/orders/create.js` |
| `scan_step` | `preparation`, `hub_preparation`, `shipped`, `in_transit`, `relais_received`, `collected` | `routes/scans.js` + `services/scan-engine.js` |
| `user_role` | définit les rôles auth | `middleware/auth.js` |
| `basket_type` | type de panier (boutique / partagé / collectif) | `routes/baskets.js` |
| `ceremony_order_type` | type de commande module cérémonie | `routes/modules.js` |
| `shared_cart_status` | `open`, `closed`, `cancelled` | `services/shared-cart-engine.js` |
| `shared_cart_contribution_status` | statut contribution panier partagé | `services/shared-cart-engine.js` |

**Règle absolue** : aucune valeur d’ENUM ne se modifie hors migration SQL. `pending_group_payment` a été retiré de `order_status` par la migration 124 ; `shared_cart_status` a été réduit à `open` / `closed` / `cancelled` par la migration 125.

---

## 4. Tables par domaine

### 4.1 Logistique commande (7 tables)

| Table | Rôle |
|---|---|
| `orders` | Commande client (table maîtresse, 60+ colonnes). |
| `order_items` | Lignes de commande. **Migration 091 (2026-06-25)** : 6 colonnes de classification douanière figées à la création — `customs_category_key`, `sh_code`, `douane_pct`, `tva_pct`, `taxe_add_pct`, `classification_defaulted`. Immuables comme `price_kmf`. Doctrine : `docs/doctrine/DOUANE_DECLARATION_PIVOT.md`. Invariant I-DOUANE-1. **Migration 104 (2026-07-12, `verified_live_schema` — vérifié live Railway)** : + `sku_id` UUID nullable, FK vers `product_skus(id)` avec `ON DELETE SET NULL`. `variant_combo` reste snapshot d’affichage/historique ; le pilotage stock cible passe par `sku_id`. Doctrine : `docs/specs/DECISION_MODELE_STOCK_SKU.md`. **Migration 162 (2026-09-04, `intended_migration_schema`)** : + `fulfillment_source` TEXT nullable, snapshot immuable du verdict transactionnel `LOCAL_STOCK | IMPORT` pour les nouvelles lignes ; `NULL` reste réservé aux lignes historiques/synthétiques sans provenance fiable et ne vaut jamais `IMPORT`. Doctrine : `docs/doctrine/DOCTRINE_FULFILLMENT_MIXTE.md`. |
| `order_status_history` | Trace immutable des transitions (invariant I-04). |
| `order_comments` | Commentaires opérationnels. |
| `order_incidents` | Incidents commande. |

> **Ajouté** : migration 071 (A-BE-18, 26 mai 2026). Ces tables étaient auparavant créées au runtime par `ensureRelayTables()` dans `routes/relay-dashboard.js`. Elles sont désormais versionnées dans `migrations/071_relay_dashboard_tables.sql` (idempotent). Colonnes : voir migration pour le DDL complet (types incidents, priorités, statuts, résolution). Index : `idx_incidents_order`, `idx_incidents_status`, `idx_comments_order`.
| `order_item_cost_imputations` | Imputations de coûts par item (audit). **Migration 164 (2026-09-06, `intended_migration_schema`)** : + `estimated_business_variable_cost_kmf` NUMERIC(12,2) nullable pour figer N2 (paiement + provision risque) et + `estimated_fixed_overhead_kmf` NUMERIC(12,2) nullable pour figer N3 séparément. `estimated_business_complete_cost_kmf` est conservé pour compatibilité legacy. Le backfill reste NULL lorsqu'un snapshot historique ne permet pas une reconstruction fiable ; aucune valeur 0 n'est inventée. |
| `order_item_real_cost_allocations` | Allocations coût réel (post-livraison). |

### 4.2 Logistique colis (5 tables)

| Table | Rôle |
|---|---|
| `parcels` | Colis (unité opérationnelle autonome — invariant I-09). |
| `parcel_items` | Lignes colis (FK vers `order_items`, contrainte de quantité via trigger). |
| `parcel_events` | Événements colis (création, modification, etc.). |
| `shipments` | Expéditions (groupes de colis). |
| `shipment_batches` | Lots logistiques. |

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

> **N4 — État vérifié code (2026-06-15)** : `migrations/072_jwt_revocation.sql` crée la table `revoked_tokens` et doit être appliquée sur Railway si la table est absente. Le câblage applicatif est présent : `routes/auth.js` génère un `jti`, insère le token au logout, `middleware/auth.js` vérifie `revoked_tokens`, et `bootstrap/crons.js` purge les lignes expirées via `startJwtRevocationCleanupCron()`. **Action DB live restante** : vérifier `SELECT 1 FROM revoked_tokens LIMIT 1`; appliquer la migration si absente.

### 4.3 Wallet (5 tables)

| Table | Rôle |
|---|---|
| `wallets` | Wallet client (1 par user, création lazy). **Contrainte DB** `chk_balance_non_negative CHECK (balance_kmf >= 0)` ajoutée en migration 068 — filet de sécurité contre un solde négatif même en cas de requête SQL directe. **Validée en prod** (confirmé dump Railway 26 mai 2026 : contrainte sans `NOT VALID`). |
| `wallet_transactions` | Transactions immutables. |
| `wallet_credit_lots` | Lots de crédits (consommation FIFO). |
| `wallet_consumptions` | Consommations de lots (audit). **Append-only depuis migration 066** : suppression physique remplacée par marquage `reversed_at = NOW()` + `reversal_reason`. Index partiel `idx_wcons_active WHERE reversed_at IS NULL` pour filtrer les consommations actives. `wallet-service.removeFromOrder()` fait `UPDATE` et non `DELETE`. |
| `store_credits` | Crédits magasin (legacy/compat). |

Voir invariants I-05 et I-06 dans `ZONE_IMPACT.md`. Source de vérité : `services/wallet-service.js`.

### 4.4 Paiements et finance (9 tables)

| Table | Rôle |
|---|---|
| `cash_collections` | Encaissements cash relais. |
| `cash_deposits` | Dépôts agents. |
| `cash_reconciliation` | Réconciliation cash. |
| `invoices` | Factures / mini-factures. Contrainte UNIQUE(order_id) — une seule facture par commande. |
| `refunds` | Remboursements. Contraintes UNIQUE(order_id, refund_type) et UNIQUE(stripe_refund_id) pour idempotence ON CONFLICT. |
| `disputes` | Litiges. |
| `stripe_events_processed` | Idempotence webhooks Stripe (anti-double-traitement). |
| `paypal_events_processed` | Idempotence webhooks PayPal (PK `event_id`, `status` ∈ processed/ignored/rejected/noop). Pendant PayPal de `stripe_events_processed`. |
| `transaction_documents` | Documents transactionnels hors facture : reçu remboursement (`refund_receipt`), reçu contribution panier partagé (`contribution_receipt`), reçu wallet (`wallet_receipt`), preuve retrait (`pickup_proof`), bon fournisseur (`purchase_order`), **facture douane classifiée** (`customs_invoice` — migration 093, Lot B keystone douane). Idempotence UNIQUE(document_type, subject_type, subject_id). Séquences dédiées : `refund_receipt_seq`, `wallet_receipt_seq`, `pickup_proof_seq`, `customs_invoice_seq`. |

### 4.5 Paniers et catalogue

| Table | Rôle |
|---|---|
| `products` | Catalogue produit. **Migration 095 (2026-07-02, `verified_live_schema` — vérifié live Railway)** : + `repack_volume_cm3` (NUMERIC, nullable — volume constaté après repack hub) et `repack_exempt` (BOOLEAN NOT NULL DEFAULT FALSE — exclusion doctrinale posée par admin). Doctrine : `docs/doctrine/DOCTRINE_DENSITE_VALEUR.md`. Aucune contrainte bloquante. **Migration 096 (2026-07-02, `verified_live_schema` — vérifié live Railway)** : `fragility` (texte) devient la SOURCE UNIQUE du tag manipulation (valeurs conseillées : fragile, electronique, sensible_chaleur, sensible_humidite) ; `is_fragile` DÉPRÉCIÉE, backfillée, drop planifié `migrations/scheduled/097` (exécutable 2026-07-16). Doctrine : `docs/doctrine/DOCTRINE_NON_CONFORMITE.md` §3. **Migration 098 (2026-07-03, `verified_live_schema` — vérifié live Railway)** : + 5 colonnes de cuisine raffinerie, invisibles boutique — `name_source`, `description_source`, `source_locale`, `content_source` (connector_raw | ai_enriched | manual, backfill legacy = manual), `enrichment_version`. Doctrine : `docs/doctrine/DOCTRINE_CATALOGUE.md` §4-5. **Migration 104 (2026-07-12, `verified_live_schema` — vérifié live Railway)** : + `inventory_model` TEXT NOT NULL DEFAULT `LEGACY_VARIANTS`, CHECK (`LEGACY_VARIANTS` | `SKU`). La bascule vers SKU est explicite et atomique ; jamais déduite de l’existence de lignes dans `product_skus`. |
| `product_variants` | Variantes (taille, couleur). |
| `product_suppliers` | Lien produit ↔ fournisseurs. |
| `baskets` | Paniers (différents `basket_type`). |
| `basket_items` | Items panier. |
| `boutique_categories` | Catégories boutique. |
| `boutique_subcategories` | Sous-catégories boutique. |
| `catalog_glossary` | Glossaire EN→FR injecté dans l'enrichissement IA (doctrine catalogue §4). `term_fr='='` signifie ne pas traduire (marques, termes culturels). Mémoire des corrections : chaque retouche récurrente devient une entrée. Migration 098, confirmée live. |
| `catalog_exclusions` | Éligibilité « ce que Komerce peut recevoir » (doctrine catalogue §3). Deux couches : `absolute` (douane/loi, définitif) et `restricted` (contrainte transport, ex. batteries lithium = maritime uniquement). Matching mots-clés sur la donnée source EN, étage ③ de la raffinerie. Migration 098, confirmée live. |
| `catalog_field_overrides` | Retouches manuelles par champ, réappliquées après chaque re-raffinage (doctrine catalogue §5 — rejouabilité). UNIQUE(product_id, field_name) : dernier override par champ gagne. Le CRUD admin édite cette table, jamais la fiche générée. FK `products` ON DELETE CASCADE. Migration 098, confirmée live. |
| `catalog_global_access_grants` | Grants explicites autorisant les surfaces Catalogue globales ; vérité d’autorisation résolue côté serveur. Vérifiée live Railway. |
| `product_skus` | Unités vendables canoniques en Mode SKU : une combinaison exacte d’options = un SKU, stock unique par SKU, prix SKU optionnel, SKU par défaut si variant_combo est NULL. Source de vérité stock cible selon DECISION_MODELE_STOCK_SKU. **Migration 104 — promue le 2026-07-14 (schema-promote, dump live verifie).** |
| `catalog_media` | Média canonique catalogue (PDC-8 Lot 2). Cible de promotion depuis `normalized_source_contract.media[]`. Identité stable : `product_id` + `source_media_id` lorsque connu (NULL = source pauvre, aucune identité fournisseur fabriquée, pas d'unicité applicable, ré-promotion peut dupliquer honnêtement). Legacy (`products.images` / `product_variants.images`) reste le fallback pour les produits non promus. Documentée le 2026-07-14 (drift live confirmé, aucun bloc `schema-pending` n'avait été posé). |
| `product_sku_media` | Association explicite SKU ↔ média canonique (PDC-8 Lot 5), source : `sellable_units[].media_refs` (V2). Les références explicites gagnent toujours sur un matching `option_values` heuristique. Table neuve au 2026-07-14, aucun writer avant le service de promotion (Lot 6). Documentée le 2026-07-14 (drift live confirmé, aucun bloc `schema-pending` n'avait été posé). |
| `catalog_enrichment_runs` | Trace de chaque appel d'enrichissement IA (doctrine catalogue §8 : échecs tracés, coût par produit suivi en tokens). `status` : `ok` (appliqué), `low_confidence` (appliqué + needs_review), `invalid_output` (JSON hors schéma, rien appliqué), `failed` (erreur réseau/modèle, rien appliqué). Documentée le 2026-07-14 (drift live confirmé, aucun bloc `schema-pending` n'avait été posé). |
| `product_content_profile` | Profil éditorial 1:1 par produit (fiche produit enrichie). brand, short_description, provenance globale (source/enrichment_version/reviewed) exposée par product_detail_v1.content.provenance. Cible de promotion depuis normalized_source_contract V2, jamais servi depuis le raw_payload. **Migration 111 — promue le 2026-08-12 (schema-promote, dump live verifie).** |
| `product_content_sections` | Sections éditoriales structurées + materials/care/warnings via section_key réservés (MATERIALS/CARE/WARNINGS, toujours BULLETS). UNIQUE(product_id, section_key) pour ré-promotion idempotente. content_json validé par le service de projection avant de traverser le contrat public. **Migration 111 — promue le 2026-08-12 (schema-promote, dump live verifie).** |
| `product_attributes` | Attributs structurés clé/label/valeur. kind=HIGHLIGHT alimente content.highlights, kind=SPECIFICATION alimente content.specifications (group/key/label/value/unit). UNIQUE(product_id, kind, group_key, attribute_key) pour idempotence. **Migration 111 — promue le 2026-08-12 (schema-promote, dump live verifie).** |





### 4.6 Paniers partagés (5 tables)

| Table | Rôle |
|---|---|
| `shared_carts` | Panier partagé MVP. |
| `shared_cart_items` | Items panier partagé. |
| `shared_cart_events` | Événements panier partagé. |
| `cart_shares` | Partage de panier (token public). |
| `shared_cart_saved_access` | Bibliothèque « Mes listes » : listes reçues qu’un utilisateur a explicitement choisi de sauvegarder. UNIQUE(user_id, shared_cart_id). Migration 127. |

### 4.8 Pricing et économie (19 tables)

| Table | Rôle |
|---|---|
| `finance_config` | **Singleton (id=1)** — source de vérité unique post-ADR-009. Colonne `provision_risque_pct NUMERIC(6,4) DEFAULT 0.01` ajoutée en migration 067 : taux de provision risque mensuel. |
| `economic_variables` | Variables économiques (legacy, voir ADR-009). |
| `exchange_rates` | Taux de change historisés. |
| `pricing_components` | Composantes de pricing. |
| `pricing_strategies` | Stratégies pricing. |
| `pricing_strategy_history` | Historique stratégies. |
| `pricing_benchmarks` | Benchmarks. |
| `pricing_category_dims` | Dimensions catégorie. |
| `pricing_category_taxes` | Taxes par catégorie. |
| `pricing_matrices_audit` | Audit matrices. |
| `cost_components` | Composantes de coûts. |
| `cost_component_events` | Événements composantes coût. |
| `cost_component_market_overrides` | Overrides market-scoped de valeur/activation sur le modèle global `cost_components`; absence de ligne = héritage global. **Migration 159 — `verified_live_schema` (confirmé par dump Railway 2026-09-04).** |
| `cost_component_market_override_events` | Journal append-only des créations, mises à jour et resets d'overrides de composantes de coûts par marché. **Migration 159 — `verified_live_schema` (confirmé par dump Railway 2026-09-04).** |
| `risk_provisions` | Provisions risques. |
| `cost_benchmarks` | Seuils de part de coût attendue par famille/catégorie (`expected_share_pct`, `warn_ratio` 1.30, `alert_ratio` 1.60). Alimente les alertes d'écart coût. |
| `charges` | Charges fixes. |
| `competitor_prices` | Prix concurrents. |
| `price_history` | Historique prix. |
| `pricing_maturity_disposition_events` | Journal append-only des décisions humaines de disposition de maturité économique ; le dernier événement fait foi sans promouvoir une disposition en maturité réelle. **Migration 165 — promue le 2026-09-06 (schema-promote, dump live verifie).** |
| `economic_structure_cost_events` | Journal append-only des charges économiques N3 de période avec preuve, devise/FX, périmètre GROUP ou MARKET_DIRECT et corrections par événements sans mutation historique. **Migration 166 — promue le 2026-09-07 (schema-promote, dump live verifie).** |


### 4.9 Douane (4 tables)

| Table | Rôle |
|---|---|
| `customs_categories` | Catégories douane. |
| `customs_shipments` | Expéditions douane. **Migration 092 (2026-06-25)** : workflow déclaration en deux étapes. Enum `customs_shipment_status` (`pending` → `declared` → `confirmed`). Colonne `status` (NOT NULL DEFAULT pending). `customs_paid_kmf` devient nullable (saisi lors de la déclaration, pas à la création). Colonnes `declared_at`, `declared_by` pour traçabilité. Gate : impossible de passer une commande en `available` si l'expédition liée est `pending`. Doctrine : `docs/doctrine/DOUANE_DECLARATION_PIVOT.md`. **Migration 095 (2026-07-02, `verified_live_schema` — vérifié live Railway)** : + `total_volume_m3` (NUMERIC(8,4), nullable — volume facturé transitaire, sert W/M et remplissage). Doctrine : `DOCTRINE_DENSITE_VALEUR.md`. |
| `customs_shipment_parcels` | Lien shipment ↔ colis. **Migration 095 (2026-07-02, `verified_live_schema` — vérifié live Railway)** : + `parcel_volume_cm3` (NUMERIC(12,2), nullable — volume facturé transitaire, sert W/M et remplissage). Doctrine : `DOCTRINE_DENSITE_VALEUR.md`. |
| `customs_history` | Historique taux effectifs. |

Trigger `trg_customs_anomaly` détecte les anomalies de taux.

### 4.10 Sourcing et fournisseurs (10 tables)

| Table | Rôle |
|---|---|
| `suppliers` | Fournisseurs. |
| `partners` | Partenaires (élargi vs suppliers, voir ADR-005). |
| `purchase_orders` | Bons de commande fournisseur. |
| `sourcing_candidates` | Candidats sourcing. **Migration 105 (2026-07-12, `verified_live_schema` — vérifié live Railway)** : + `normalized_source_contract` JSONB nullable, snapshot du `NormalizedSupplierProduct V2` validé sans dupliquer `raw_payload`. Préserve `media`, `option_axes` et `sellable_units` source ; ne constitue ni le catalogue canonique ni la vérité de stock. |
| `sourcing_candidate_events` | Événements candidats. |
| `supplier_catalog_imports` | Imports catalogues et audit de batch JSON : profil, hash source, version connecteur, statut, compteurs et findings. Migration 110, vérifiée lors du pilote production ING-6 du 2026-07-16. |
| `supplier_catalog_import_rejections` | Rejets de lignes ou contrats non représentables, séparés des candidats promouvables. Conserve le payload brut, les findings et la cause automatisable ; unicité `(import_id, source_index)`. Migration 110. |
| `sourcing_candidate_observations` | Historique immuable des observations fournisseur par batch et profil, avec hash de ligne et snapshot du contrat normalisé. Migration 110. |
| `fabrics` | Tissus (module cérémonie). |
| `garment_models` | Modèles vêtements (module cérémonie). |
| `supplier_catalog_sync_checkpoints` | Checkpoints reprenables par fournisseur, synchronisation et catégorie pour alimenter le pool CJ propre plafonné à 1000 références sans publication automatique. **Migration 163 — promue le 2026-09-05 (schema-promote, dump live verifie).** |

### 4.11 Scans et opérations terrain (5 tables)

| Table | Rôle |
|---|---|
| `scans` | Scans terrain (legacy/compat). |
| `scan_events` | Événements scan (modèle moderne, protégé par `prevent_scan_event_delete`). **Migration 096 (2026-07-02, `verified_live_schema` — vérifié live Railway)** : + `photo_urls` (text[], DEFAULT '{}', miroir de disputes.photo_urls). Usage doctrinal : event_type=seal_photo au scellé Dubaï = borne 1 des fenêtres de responsabilité (avant : fournisseur ; après : transport). Alimenté par POST /api/hub/photo. Doctrine : `docs/doctrine/DOCTRINE_NON_CONFORMITE.md` §2. |
| `relais` | Points relais. |
| `inventory_items` | Inventaire hub. |
| `carriers` | Transporteurs. |

### 4.12 Utilisateurs et fidélité (7 tables)

| Table | Rôle |
|---|---|
| `users` | Utilisateurs (rôle via ENUM `user_role`). |
| `otp_codes` | Codes OTP. |
| `user_pickup_authorizations` | Autorisation nominative courante de retrait exceptionnel, propriété auth-identity. Une ligne par utilisateur ; aucun numéro, copie ou donnée de pièce d’identité conservé. Migration 121. |
| `revoked_tokens` | Révocation JWT (logout) : `jti` révoqué, `expires_at` pour purge. Câblage : `routes/auth.js` insère au logout, `middleware/auth.js` vérifie, cron de purge dans `bootstrap/crons.js`. Migration 072. |
| `recipients` | Destinataires (peuvent être ≠ user). |
| `loyalty_tiers` | Niveaux fidélité. |
| `loyalty_rewards` | Récompenses. |

### 4.12 bis — Marchés, autorisations globales et Passkeys (9 tables)

| Table | Rôle |
|---|---|
| `markets` | Référentiel canonique des marchés/pays opérés par Komerce. Vérifiée live Railway. |
| `operator_market_scopes` | Périmètres marché autorisés par opérateur ; frontière serveur des accès market-scoped. Vérifiée live Railway. |
| `currency_parities` | Parités de devise par marché utilisées par la Currency Boundary. Vérifiée live Railway. |
| `dashboard_global_access_grants` | Grants explicites pour les surfaces Dashboard globales ; aucune élévation globale implicite. Vérifiée live Railway. |
| `webauthn_credentials` | Credentials Passkey/WebAuthn persistés pour l’authentification et leur révocation. Vérifiée live Railway. |
| `webauthn_challenges` | Challenges WebAuthn éphémères persistés pour garantir single-use et séparation des cérémonies. Vérifiée live Railway. |
| `sourcing_global_access_grants` | Grants persistés autorisant explicitement les surfaces Sourcing globales ; aucune autorité globale implicite. **Migration 149 — promue le 2026-08-29 (schema-promote, dump live verifie).** |
| `pricing_global_access_grants` | Grants persistés autorisant explicitement le Pricing Workspace global ; aucune élévation implicite depuis le navigateur. **Migration 152 — promue le 2026-08-29 (schema-promote, dump live verifie).** |
| `decision_signal_global_access_grants` | Grants persistés autorisant explicitement l’Action Center global et les signaux de décision transverses. **Migration 153 — promue le 2026-08-29 (schema-promote, dump live verifie).** |



### 4.13 Monitoring et alertes (10 tables)

| Table | Rôle |
|---|---|
| `notification_log` | Log notifications (email, push). |
| `client_notifications` | Notifications in-app essentielles rattachées à une commande, acquittables, sans canal externe ni contenu sensible. Unicité `(user_id, event_key, entity_type, entity_id)` ; statuts `open` / `acknowledged` / `resolved`. Migration 132, vérifiée live sur Railway le 2026-08-16. |
| `sms_log` | Log SMS. |
| `signals` | Signaux opérationnels. |
| `alerts` | Alertes. |
| `incidents` | Incidents. |
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
- **Devises** : suffixe explicite `_kmf`, `_eur`, `_aed`.
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

1. `node scripts/db-snapshot.js` — se connecte à Railway via `RAILWAY_DATABASE_URL` (secret GitHub), exécute `pg_dump --schema-only`, neutralise les artefacts PG18 (`\restrict`, `transaction_timeout`), écrit atomiquement dans `docs/db/railway-live-schema.sql`.
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