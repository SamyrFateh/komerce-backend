# Schéma DB Komerce

> **Statut** : schéma canonique de la base de production
> **Source** : `pg_dump` PostgreSQL 18.4 — Railway — 24 mai 2026
> **Méthode** : ce document est généré contre la DB live. Il fait foi contre `db/schema.sql` (obsolète, mars 2026) et les fichiers `migrations/*.sql` (référence manuelle, non exécutés automatiquement).
> **Rappel** : 3 mécanismes de migration coexistent (cf. `SCHEMA_GAP_KOMERCE.md` §Architecture). `db/schema.sql` ne reflète pas l'état live.

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
| Tables | 93 | Sans compter les tables système (+2 tables SEC-1 : `pickup_print_tokens`, `pickup_reveal_codes`) |
| Vues | 16 | Préfixe `v_` ou `customs_*` |
| ENUMs | 14 | Types métier critiques |
| Index | 264 | Performance + contraintes uniques |
| Foreign keys | 147 | Cohérence relationnelle |
| Fonctions | 46 | Triggers, helpers, idempotence |
| Triggers | 31 | `set_updated_at`, guards anti-corruption |
| Extensions | `pgcrypto`, `uuid-ossp` | UUID + chiffrement |

---

## 3. ENUMs critiques

| ENUM | Valeurs | Source de vérité |
|---|---|---|
| `order_status` | `pending`, `pending_group_payment`, `confirmed`, `ordered`, `preparation`, `shipped`, `in_transit`, `available`, `collected`, `cancelled`, `refunded` | `services/order-status-machine.js` |
| `parcel_status` | `draft`, `preparation`, `shipped`, `in_transit`, `arrived`, `available`, `collected`, `cancelled` | `routes/parcel-api-v2.js` + `services/parcel-service.js` |
| `payment_status` | `pending`, `paid`, `failed`, `refunded`, `partially_paid` | `routes/payments.js` |
| `payment_mode` | `stripe_eur`, `cash_relais`, `mixed_shared_cart_cash` | `routes/orders/create.js` |
| `scan_step` | `preparation`, `hub_preparation`, `shipped`, `in_transit`, `relais_received`, `collected` | `routes/scans.js` + `services/scan-engine.js` |
| `user_role` | définit les rôles auth | `middleware/auth.js` |
| `basket_type` | type de panier (boutique / partagé / collectif) | `routes/baskets.js` |
| `ceremony_order_type` | type de commande module cérémonie | `routes/modules.js` |
| `collective_workspace_status` | cycle de vie workspace collectif | `services/collective-workspace-engine.js` |
| `collective_session_status` | cycle de vie session paiement collectif | `services/collective-payment-orchestrator.js` |
| `collective_token_status` | cycle de vie token paiement individuel | `services/collective-payment-orchestrator.js` |
| `collective_contribution_status` | statut contribution dans workspace | `services/collective-workspace-engine.js` |
| `shared_cart_status` | cycle de vie panier partagé MVP | `services/shared-cart-engine.js` |
| `shared_cart_contribution_status` | statut contribution panier partagé | `services/shared-cart-engine.js` |

**Règle absolue** : aucune valeur d'ENUM ne se modifie hors migration SQL. Les valeurs `pending_group_payment` et `in_transit` ont été ajoutées via migrations 059 et `fixMissingSchema()` respectivement.

---

## 4. Tables par domaine

### 4.1 Logistique commande (7 tables)

| Table | Rôle |
|---|---|
| `orders` | Commande client (table maîtresse, 60+ colonnes). |
| `order_items` | Lignes de commande. |
| `order_status_history` | Trace immutable des transitions (invariant I-04). |
| `order_comments` | Commentaires opérationnels. |
| `order_incidents` | Incidents commande. |

> **Ajouté** : migration 071 (A-BE-18, 26 mai 2026). Ces tables étaient auparavant créées au runtime par `ensureRelayTables()` dans `routes/relay-dashboard.js`. Elles sont désormais versionnées dans `migrations/071_relay_dashboard_tables.sql` (idempotent). Colonnes : voir migration pour le DDL complet (types incidents, priorités, statuts, résolution). Index : `idx_incidents_order`, `idx_incidents_status`, `idx_comments_order`.
| `order_item_cost_imputations` | Imputations de coûts par item (audit). |
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

### 4.2 bis — Sécurité pickup — tokens éphémères (2 tables)

> **Ajouté** : migration 070 (SEC-1, 24 mai 2026). Remplace les deux Maps in-memory de `routes/pickup-secret.js` pour survivre aux redémarrages et fonctionner en multi-instance Railway.

| Table | Rôle |
|---|---|
| `pickup_print_tokens` | Token one-shot (TTL 2 min) pour accès au HTML imprimable du reçu cash après encaissement. PK = token hex 48 bytes. FK → `orders(id)` ON DELETE CASCADE. Supprimé à la première lecture. |
| `pickup_reveal_codes` | Code pickup en clair (8 chars), stocké max 30 min pour révélation one-shot après paiement Stripe/Wallet/MM. PK = `order_id`. Supprimé immédiatement après `GET /reveal-once`. |

**Nettoyage** : `startPickupTokenCleanupCron()` toutes les 5 min dans `bootstrap/crons.js`. Multi-instance safe — aucune Map in-memory résiduelle pour ces deux flows.

**Invariant I-10** : les codes sont en clair uniquement pendant leur fenêtre TTL, avec le même niveau de confiance que `DATABASE_URL`. Voir **SEC-1** dans `STATUS.md`.

### 4.3 Wallet (4 tables)

| Table | Rôle |
|---|---|
| `wallets` | Wallet client (1 par user, création lazy). **Contrainte DB** `chk_balance_non_negative CHECK (balance_kmf >= 0) NOT VALID` ajoutée en migration 068 — filet de sécurité contre un solde négatif même en cas de requête SQL directe. |
| `wallet_transactions` | Transactions immutables. |
| `wallet_credit_lots` | Lots de crédits (consommation FIFO). |
| `wallet_consumptions` | Consommations de lots (audit). **Append-only depuis migration 066** : suppression physique remplacée par marquage `reversed_at = NOW()` + `reversal_reason`. Index partiel `idx_wcons_active WHERE reversed_at IS NULL` pour filtrer les consommations actives. `wallet-service.removeFromOrder()` fait `UPDATE` et non `DELETE`. |
| `store_credits` | Crédits magasin (legacy/compat). |

Voir invariants I-05 et I-06 dans `ZONE_IMPACT.md`. Source de vérité : `services/wallet-service.js`.

### 4.4 Paiements et finance (7 tables)

| Table | Rôle |
|---|---|
| `cash_collections` | Encaissements cash relais. |
| `cash_deposits` | Dépôts agents. |
| `cash_reconciliation` | Réconciliation cash. |
| `invoices` | Factures / mini-factures. |
| `refunds` | Remboursements. |
| `disputes` | Litiges. |
| `stripe_events_processed` | Idempotence webhooks Stripe (anti-double-traitement). |

### 4.5 Paniers et catalogue (7 tables)

| Table | Rôle |
|---|---|
| `products` | Catalogue produit. |
| `product_variants` | Variantes (taille, couleur). |
| `product_suppliers` | Lien produit ↔ fournisseurs. |
| `baskets` | Paniers (différents `basket_type`). |
| `basket_items` | Items panier. |
| `boutique_categories` | Catégories boutique. |
| `boutique_subcategories` | Sous-catégories boutique. |

### 4.6 Paniers partagés (6 tables)

| Table | Rôle |
|---|---|
| `shared_carts` | Panier partagé MVP. |
| `shared_cart_items` | Items panier partagé. |
| `shared_cart_contributions` | Contributions des participants. |
| `shared_cart_events` | Événements panier partagé. |
| `cart_shares` | Partage de panier (token public). |
| `cart_contributions` | Contributions (legacy, vérifier vs `shared_cart_contributions`). |

**Dette doc à clarifier** : `cart_shares` + `cart_contributions` ne sont pas mentionnées dans `CARTOGRAPHY_360.md` §domaines. Statut : actives en DB, à confirmer côté code.

### 4.7 Workspace collectif (7 tables)

| Table | Rôle |
|---|---|
| `collective_workspaces` | Workspace collectif (événement, cagnotte). |
| `collective_workspace_items` | Items du workspace. |
| `collective_workspace_contributions` | Contributions (intention, suggestion, message). |
| `collective_workspace_events` | Événements workspace. |
| `collective_payment_sessions` | Sessions de paiement collectif. |
| `collective_payment_tokens` | Tokens de paiement individuel. |
| `collective_stock_reservations` | Réservations de stock par token. |

Source de vérité : `services/collective-workspace-engine.js` + `services/collective-payment-orchestrator.js`.

### 4.8 Pricing et économie (14 tables)

| Table | Rôle |
|---|---|
| `finance_config` | **Singleton (id=1)** — source de vérité unique post-ADR-009. Colonne `provision_risque_pct NUMERIC(6,4) DEFAULT 0.01` ajoutée en migration 067 : taux de provision risque mensuel (était hardcodé à 1 % dans `cost-allocation.js` — violation I-08 résolue). Configurable via Control Tower > Paramètres économiques. |
| `economic_variables` | Variables économiques (legacy, voir ADR-009). |
| `exchange_rates` | Taux de change historisés. |
| `pricing_components` | Composantes de pricing. |
| `pricing_strategies` | Stratégies pricing. |
| `pricing_strategy_history` | Historique stratégies. |
| `pricing_benchmarks` | Benchmarks. |
| `pricing_category_dims` | Dimensions catégorie. |
| `pricing_category_taxes` | Taxes par catégorie. |
| `pricing_matrices_audit` | Audit matrices. |
| `cost_components` | Composantes de coûts (contrainte `cost_components_family_check` rigoureuse). |
| `cost_component_events` | Événements composantes coût. |
| `risk_provisions` | Provisions risques. |
| `charges` | Charges fixes. |
| `competitor_prices` | Prix concurrents. |
| `price_history` | Historique prix. |

### 4.9 Douane (4 tables)

| Table | Rôle |
|---|---|
| `customs_categories` | Catégories douane. |
| `customs_shipments` | Shipments douane. |
| `customs_shipment_parcels` | Lien shipment ↔ colis. |
| `customs_history` | Historique taux effectifs. |

Trigger `trg_customs_anomaly` détecte les anomalies de taux.

### 4.10 Sourcing et fournisseurs (7 tables)

| Table | Rôle |
|---|---|
| `suppliers` | Fournisseurs. |
| `partners` | Partenaires (élargi vs suppliers, voir ADR-005). |
| `purchase_orders` | Bons de commande fournisseur. |
| `sourcing_candidates` | Candidats sourcing. |
| `sourcing_candidate_events` | Événements candidats. |
| `supplier_catalog_imports` | Imports catalogues. |
| `fabrics` | Tissus (module cérémonie). |
| `garment_models` | Modèles vêtements (module cérémonie). |

**Dette doc** : `fabrics` + `garment_models` non mentionnées dans `CARTOGRAPHY_360.md` § Modules.

### 4.11 Scans et opérations terrain (4 tables)

| Table | Rôle |
|---|---|
| `scans` | Scans terrain (legacy/compat). |
| `scan_events` | Événements scan (modèle moderne, protégé par `prevent_scan_event_delete`). |
| `relais` | Points relais. |
| `inventory_items` | Inventaire hub. |
| `carriers` | Transporteurs. |

### 4.12 Utilisateurs et fidélité (5 tables)

| Table | Rôle |
|---|---|
| `users` | Utilisateurs (rôle via ENUM `user_role`). |
| `otp_codes` | Codes OTP. |
| `recipients` | Destinataires (peuvent être ≠ user). |
| `loyalty_tiers` | Niveaux fidélité. |
| `loyalty_rewards` | Récompenses. |

### 4.13 Monitoring et alertes (8 tables)

| Table | Rôle |
|---|---|
| `notification_log` | Log notifications (email, push). |
| `sms_log` | Log SMS. |
| `signals` | Signaux opérationnels. |
| `alerts` | Alertes (contrainte CHECK sur `severity`). |
| `incidents` | Incidents. |
| `unsold_items` | Items invendus (trigger `auto_unsold`). |
| `business_rules` | Règles métier. |
| `business_rules_history` | Historique règles. |
| `economic_snapshots` | Snapshots économiques. |

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
| `v_group_orders` | Vue agrégée commandes groupées. | Admin paiements collectifs |
| `v_ceremony_orders` | Vue agrégée commandes cérémonie. | Admin modules |
| `v_customs_analysis` | Analyse douane. | Admin douane |
| `v_active_product_suppliers` | Fournisseurs actifs par produit. | Sourcing |
| `customs_effective_rates` | Taux douane effectifs. | Pricing |
| `customs_taux_actuel` | Taux douane actuel. | Pricing |
| `customs_taux_mensuel` | Évolution mensuelle. | Admin |
| `suppliers_stats` | Stats fournisseurs. | Admin |
| `product_variants_ordered` | Variantes commandées. | Admin |

---

## 6. Triggers et garde-fous DB

Au-delà du code applicatif, la DB enforce elle-même plusieurs invariants :

| Trigger | Table | Rôle |
|---|---|---|
| `trg_no_delete_parcels` | `parcels` | Bloque DELETE direct (force soft-delete via `cancelled`). |
| `trg_parcel_ship_guard` | `parcels` | Contrôle transitions colis. |
| `trg_check_parcel_item_qty` | `parcel_items` | Vérifie cohérence quantité colis vs commande. |
| `trg_compute_real_margin` | `orders` | Recalcule marge réelle au passage `cost_real_kmf`. |
| `trg_customs_anomaly` | `customs_history` | Flag anomalies taux douane. |
| `prevent_incident_delete` | `incidents` | Anti-suppression incidents (audit). |
| `prevent_scan_event_delete` | `scan_events` | Anti-suppression scans (preuve). |
| `auto_unsold` | déclenché | Bascule auto en `unsold_items`. |
| `set_updated_at` × 17 tables | divers | Maintien `updated_at` automatique. |
| `sync_has_variants` | `products` | Synchronise flag variantes. |

**Conséquence** : un agent ne peut pas casser certaines invariants même en bypassant le code. La DB rejette. C'est une couche de défense supplémentaire.

---

## 7. Contraintes CHECK notables

| Contrainte | Garantie |
|---|---|
| `cost_components_family_category_consistency` | Cohérence `family` ↔ `category` du composant coût. |
| `cost_components_allocation_check` | Méthode d'allocation valide (10 méthodes admises). |
| `cost_components_island_check` | Île valide (grande_comore, moheli, anjouan, mayotte). |
| `competitor_target_check` | Prix concurrent : produit OU catégorie obligatoire. |
| `collective_workspace_contributions_content_check` | Contribution non-vide. |
| `collective_workspace_contributions_kind_check` | Kind valide (suggestion / intention / message). |
| `parcels_type_check` | Type de colis (standard / partial / backorder / awaiting_stock). |

---

## 8. Conventions transverses

- **Identifiants** : `uuid` partout (via `uuid_generate_v4()` ou `gen_random_uuid()`).
- **Timestamps** : `created_at`, `updated_at` (avec trigger `set_updated_at`), timestamps d'événement nommés `<step>_at`.
- **Devises** : suffixe explicite `_kmf`, `_eur`, `_aed`.
- **Statuts** : ENUMs typés, pas de string libre.
- **Soft-delete** : pas de DELETE pour `parcels`, `incidents`, `scan_events` (triggers de protection).
- **Idempotence** : `idempotency_key` pour wallet, `stripe_events_processed` pour webhooks Stripe.

---

## 9. Liens avec les autres documents socle

- **`CARTOGRAPHY_360.md`** — domaines API et points de vérité. Si une table de ce document n'apparaît pas dans CARTOGRAPHY, c'est une dette doc à signaler.
- **`ZONE_IMPACT.md`** — invariants I-01 à I-10 qui protègent ce schéma au niveau code.
- **`CONTRACTS.md`** — services qui consomment et mutent ces tables.
- **`SCHEMA_GAP_KOMERCE.md`** — analyse historique des divergences `schema.sql` / migrations / runtime. Ce document remplace `SCHEMA_GAP` comme référence vivante.
- **`ADR-009-source-verite-unifiee.md`** — `finance_config` comme singleton.

---

## 10. Règle de divergence schéma ↔ code ↔ doc

Voir `AGENTS.md` § "Règle de divergence". En résumé :

1. La **DB live** fait foi.
2. Ce document doit être régénéré contre la DB à chaque fin de session qui modifie le schéma.
3. Si un développeur trouve une divergence : signaler dans `docs/chantier/STATUS.md` section "Pièges critiques", ne pas modifier silencieusement.

---

## 11. Procédure de régénération

Pour mettre à jour ce document après une migration DB :

```bash
# 1. Exporter le schéma depuis Railway
pg_dump --schema-only --no-owner --no-privileges \
  "$DATABASE_URL_PROD" > /tmp/schema_railway.sql

# 2. Confronter à ce document :
# - lister les nouvelles tables (`grep "^CREATE TABLE"`)
# - lister les nouveaux ENUMs (`grep "^CREATE TYPE"`)
# - confronter les colonnes de orders/parcels/wallet
# - mettre à jour les sections concernées

# 3. Mettre à jour la date en tête + STATUS.md
```

---

## 12. Dette schéma connue

1. **2 dossiers de migrations** (`db/migrations/` legacy + `migrations/` actif) — non bloquant mais à clarifier (cf. STATUS.md lot A5).
2. **Collisions de numéros** dans `migrations/` : `060.sql` + `060_add_pending_at_confirmed_at.sql` ; `061.sql` + `061_boutique_categories.sql` (cf. STATUS.md lot A4).
3. **`db/schema.sql`** est obsolète (mars 2026, v1.3). Ce document le remplace comme référence d'état réel.
4. **Tables non mentionnées dans CARTOGRAPHY** : ✅ **Résolu par lot SOCLE-2 (17 mai 2026)**. `fabrics`, `garment_models`, `product_variants`, `otp_codes`, `sms_log`, `notification_log`, `stripe_events_processed`, `cart_shares`, `cart_contributions` désormais référencées dans `CARTOGRAPHY_360.md`. `pickup_print_tokens` et `pickup_reveal_codes` (migration 070, SEC-1) sont des tables techniques internes — pas de domaine API propre, pas d'endpoint dédié — et ne nécessitent pas d'entrée CARTOGRAPHY.
5. **Trou apparent** dans la numérotation migrations entre 025 et 033 — vérifier l'historique git si nécessaire.
