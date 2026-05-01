# SCHEMA_GAP_KOMERCE.md
## Inventaire des divergences schema.sql / migrations / runtime

> Généré LOT 5 — Mai 2026
> Ce document est la source de vérité sur l'état réel du schéma DB vs les fichiers de référence.

---

## Architecture des migrations (à lire en premier)

Komerce utilise **trois mécanismes** de migration, dans l'ordre d'exécution au démarrage :

| Mécanisme | Fichiers | Exécuté automatiquement ? | Contenu |
|---|---|---|---|
| `scripts/fix-schema.js` → `fixMissingSchema()` | `scripts/fix-schema.js` | ✅ Oui (Railway release command + server.js startup) | ALTER TABLE idempotents, migrations 020-038+ |
| SQL inline `server.js` | `server.js` lignes ~599-1001 | ✅ Oui (setImmediate au boot HTTP) | Migrations runtime ad-hoc (P0-03 à corriger en LOT futur) |
| Fichiers `/migrations/*.sql` | 45 fichiers .sql | ❌ Non (référence manuelle uniquement) | Documentation des changements, exécution manuelle |
| Fichiers `/db/migrations/*.sql` | 13 fichiers .sql | ❌ Non (archivés) | Migrations 004-013, supercédées |

**Conséquence** : `db/schema.sql` est le schéma initial MVP (v1.3, mars 2026). Il ne reflète PAS l'état live de la DB.

---

## ENUMs : divergences corrigées (LOT 5)

### `order_status`
| Valeur | schema.sql v1.3 | Live DB | Migration source | LOT fix |
|---|---|---|---|---|
| `pending` | ❌ absent | ✅ présent | server.js ligne 697 | LOT 5 → fixMissingSchema() |
| `pending_group_payment` | ❌ absent | ✅ présent (si 059 passée) | `migrations/059_group_order.sql` | LOT 5 → fixMissingSchema() |
| `confirmed` | ✅ | ✅ | schema.sql | — |
| `ordered` | ✅ | ✅ | migration 004 | — |
| `preparation` | ✅ | ✅ | schema.sql | — |
| `shipped` | ✅ | ✅ | schema.sql | — |
| `in_transit` | ❌ absent | ✅ présent | fixMissingSchema() migration 024 | — |
| `available` | ✅ | ✅ | schema.sql | — |
| `collected` | ✅ | ✅ | schema.sql | — |
| `cancelled` | ✅ | ✅ | schema.sql | — |
| `refunded` | ✅ | ✅ | schema.sql | — |

### `payment_mode`
| Valeur | schema.sql v1.3 | Live DB | Migration source | LOT fix |
|---|---|---|---|---|
| `stripe_eur` | ✅ | ✅ | schema.sql | — |
| `cash_relais` | ✅ | ✅ | schema.sql | — |
| `mixed_shared_cart_cash` | ❌ absent | ✅ présent (si 044 passée) | `migrations/044_shared_cart.sql` | LOT 5 → fixMissingSchema() |

### `payment_status`
| Valeur | schema.sql v1.3 | Live DB | Migration source | LOT fix |
|---|---|---|---|---|
| `pending` | ✅ | ✅ | schema.sql | — |
| `paid` | ✅ | ✅ | schema.sql | — |
| `failed` | ✅ | ✅ | schema.sql | — |
| `refunded` | ✅ | ✅ | schema.sql | — |
| `partially_paid` | ❌ absent | ✅ présent (si 044 passée) | `migrations/044_shared_cart.sql` | LOT 5 → fixMissingSchema() |

---

## Colonnes orders : divergences corrigées (LOT 5)

| Colonne | schema.sql v1.3 | Live DB | Migration source | LOT fix |
|---|---|---|---|---|
| `pending_at` | ❌ absent | ✅ présent | server.js ligne 704 + `migrations/060_add_pending_at_confirmed_at.sql` | LOT 5 → schema.sql + fixMissingSchema() |
| `confirmed_at` | ❌ absent | ✅ présent | server.js ligne 705 + `migrations/060_add_pending_at_confirmed_at.sql` | LOT 5 → schema.sql + fixMissingSchema() |
| `computed_status` | ❌ absent | ✅ présent | fixMissingSchema() migration 022 | — |
| `qr_token` | ❌ absent | ✅ présent | fixMissingSchema() (qr_token block) | — |
| `completion_ratio` | ❌ absent | ✅ présent | server.js ligne 737 | Déféré |
| `items_received` | ❌ absent | ✅ présent | server.js ligne 738 | Déféré |
| `items_total` | ❌ absent | ✅ présent | server.js ligne 739 | Déféré |
| `deadline_dispatch` | ❌ absent | ✅ présent | server.js ligne 740 | Déféré |

---

## Tables absentes de schema.sql (présentes en live)

Ces tables existent en production mais ne sont pas dans `db/schema.sql`. Elles sont créées par `fixMissingSchema()` ou `server.js` inline.

| Table | Créée par | Migration ref |
|---|---|---|
| `partners` | fixMissingSchema() | migrations/035_partners_enrichment.sql |
| `loyalty_tiers` | fixMissingSchema() | — |
| `business_rules` | fixMissingSchema() | — |
| `business_rules_history` | fixMissingSchema() | — |
| `refunds` | fixMissingSchema() | — |
| `store_credits` | fixMissingSchema() | — |
| `carriers` | migrations/016b_carriers.sql (ref) | LOT 5 rename |
| `invoices` | server.js ligne 629 + migrations/023_invoices.sql | — |
| `notification_log` | server.js ligne 656 | migrations/024_notification_log.sql |
| `otp_codes` | server.js ligne 677 | — |
| `inventory_items` | server.js ligne 710 | — |
| `pricing_matrices_audit` | server.js ligne 767 | — |
| `cart_shares` | server.js ligne 785 | — |
| `cash_collections` | server.js ligne 820 | — |
| `cash_deposits` | server.js ligne 838 | — |
| `cash_reconciliation` | server.js ligne 863 | — |
| `economic_variables` | server.js ligne 920 | — |
| `charges` | server.js ligne 943 | — |
| `economic_snapshots` | server.js ligne 961 | — |
| `finance_config` | server.js ligne 974 | — |
| `shared_carts` | migrations/044_shared_cart.sql (ref, non auto) | — |
| `shared_cart_contributions` | migrations/044_shared_cart.sql (ref, non auto) | — |
| `shared_cart_events` | migrations/044_shared_cart.sql (ref, non auto) | — |

---

## Fichiers migrations en doublon (LOT 5 — renommés)

Avant LOT 5, 4 paires de fichiers avaient le même préfixe numérique :

| Avant | Après | Contenu |
|---|---|---|
| `015_add_backorder_reminder_sent.sql` | inchangé (conservé) | Colonne backorder sur parcels (CRIT-02) |
| `015_customs_enrichment.sql` | **`015b_customs_enrichment.sql`** | Colonnes customs_* sur parcels |
| `016_add_missing_indexes.sql` | inchangé (conservé) | Index manquants V1.10 |
| `016_carriers.sql` | **`016b_carriers.sql`** | Table carriers |
| `022_parcel_first_refactor.sql` | inchangé (conservé) | Refactoring parcels |
| `022_sms_queue.sql` | **`022b_sms_queue.sql`** | Colonnes queue sur sms_log |
| `023_invoices.sql` | inchangé (conservé) | Table invoices |
| `023_whatsapp_phone.sql` | **`023b_whatsapp_phone.sql`** | Colonne whatsapp_phone sur users |

> Note : 035b, 035c, 036b, 037b existaient déjà avec convention `b`/`c`. LOT 5 aligne les 4 paires restantes.

---

## Trous dans la numérotation (non bloquants)

Les fichiers migrations ne sont pas exécutés automatiquement → les trous ne causent pas d'erreur.

| Plage manquante | Explication probable |
|---|---|
| 026–032 | Migrations intégrées directement dans fixMissingSchema() (magic_token, qr_token, etc.) |
| 053–056 | Migrations intégrées dans server.js inline SQL ou non créées |

---

## Actions restantes (hors LOT 5)

| Priorité | Action | LOT cible |
|---|---|---|
| P0 | Extraire les 30+ blocs SQL de server.js vers fixMissingSchema() | LOT futur (P0-03) |
| P1 | Compléter schema.sql avec les tables live manquantes | LOT futur |
| P2 | Créer un vrai runner de migrations avec table `schema_migrations` | LOT futur |
| P3 | Vérifier que migration 044 (shared_carts) a bien été passée en prod | Ops |
