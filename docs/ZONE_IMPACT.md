# ZONE_IMPACT.md v2.0 — Toile d’Araignée Komerce

> Source : CARTOGRAPHY_360.md v15.15 + Code source vérifié — 08/04/2026
> **PROTOCOLE : Lire ce fichier AVANT toute modification de code.**

---

## ⛔ INVARIANTS ABSOLUS

> Casser un invariant = état incohérent irrécupérable sans intervention manuelle.

| ID | Règle | Fichier source |
|----|-------|----------------|
| **R1** | `orders.status` se modifie **uniquement** via : ① `parcelSync.js` (scan events) ② `PATCH /:id/status` avec `VALID_TRANSITIONS` (actions manuelles) ③ `POST /:id/cancel` (annulation). **Jamais de `UPDATE orders SET status` ailleurs.** | `utils/parcelSync.js`, `routes/orders.js` |
| **R2** | Hub = 3 actions seulement. Le système décide du statut, l’opérateur exécute | `utils/parcelSync.js` |
| **R3** | Transitions `order_status` uniquement via `VALID_TRANSITIONS` + `TRANSITION_ROLES` — voir §2 | `routes/orders.js` |
| **R4** | Jamais `UPDATE orders SET status = ...` direct — même en migration. Exception : cancel + collected (voir R1) | Toutes les routes |
| **R5** | Création de commande = `SELECT ... FOR UPDATE` dans une transaction (race condition stock) | `routes/orders.js:270` |
| **R6** | `parcel_status` suit sa propre machine à états — ne jamais synchroniser manuellement | `utils/parcels.js` |
| **R7** | Aucune `assisted_request` ne bascule en `order` sans une action humaine **explicite** (`status = validated`). Jamais automatiquement. | `docs/_work/PARTS_MODULE_ANALYSIS.md` |

---

## 🔒 FICHIERS SANCTUARISÉS

> Modification **interdite** sans analyse dans `_work/` + validation propriétaire.

| Fichier | Raison | Blast radius |
|---------|--------|--------------|
| `db.js` | Pool PostgreSQL — TOUS les fichiers en dépendent | 🔴 GLOBAL |
| `server.js` | Montage de toutes les routes | 🔴 GLOBAL |
| `middleware/auth.js` | Protège 17/19 routes | 🔴 GLOBAL |
| `utils/parcelSync.js` | Gardien R1 — toutes les commandes actives | 🔴 CRITIQUE |
| `middleware/validate.js` | Validation d’entrée pour toutes les routes | 🔴 GLOBAL |
| `validators/index.js` | Schémas de validation — 11/19 routes | 🔴 GLOBAL |

---

## 🔄 MACHINES À ÉTATS — COMPLÈTES

### order_status

```
confirmed → ordered → preparation → shipped → in_transit → available → collected
                                                                         (terminal)
    ↓ (admin, depuis tout statut sauf collected/cancelled/refunded)
cancelled → refunded
              (terminal)
```

**Transitions autorisées :**

| De → | Vers | Rôles autorisés |
|------|------|-----------------|
| `confirmed` | `ordered` | admin, agent_relais (cash uniquement) |
| `confirmed` | `cancelled` | admin |
| `ordered` | `preparation` | admin, agent_hub |
| `ordered` | `cancelled` | admin |
| `preparation` | `shipped` | admin, agent_hub |
| `preparation` | `cancelled` | admin |
| `shipped` | `in_transit` | admin |
| `shipped` | `cancelled` | admin |
| `in_transit` | `available` | admin, agent_relais |
| `in_transit` | `cancelled` | admin |
| `available` | `collected` | admin, agent_relais |
| `available` | `cancelled` | admin |
| `cancelled` | `refunded` | admin |

**États terminaux :** `collected`, `refunded`

**Transitions INTERDITES (hard-codées) :**
- `collected → *` (aucune)
- `refunded → *` (aucune)
- Tout saut d’étape (ex: `confirmed → shipped`)
- `cancelled → confirmed` (pas de réactivation)
- `agent_relais → preparation` (pas son rôle)
- `agent_hub → ordered` (pas son rôle)
- `agent_relais → ordered` si `payment_mode ≠ cash_relais`

### parcel_status

```
draft → preparation → shipped → in_transit → arrived → available → collected
                                                                    (terminal)
    ↓ (depuis tout statut sauf collected/cancelled)
cancelled (terminal)
```

**Transitions autorisées :**

| De → | Vers |
|------|------|
| `draft` | `preparation`, `cancelled` |
| `preparation` | `shipped`, `cancelled` |
| `shipped` | `in_transit`, `cancelled` |
| `in_transit` | `arrived`, `available`, `cancelled` |
| `arrived` | `available`, `cancelled` |
| `available` | `collected`, `cancelled` |

**Règle spéciale :** quand TOUS les colis d’une commande sont `collected` ou `cancelled` → la commande parent passe à `collected` automatiquement (dans `orders.js` PATCH parcels status).

---

## 🕸️ MATRICE COMPOSANTS × TABLES

**Score de risque** = nombre de connexions entrantes × poids W (écriture=3, lecture=1) + dépendances transitives. Source : `scripts/impact-config.json`.

| Composant | Tables **W** (écriture) | Tables **R** (lecture) | Appelle | Appelé par | 🎯 Risque |
|-----------|------------------------|------------------------|---------|------------|-----------|
| `routes/orders.js` | orders, order_items, order_status_history, recipients, store_credits, refunds, parcels, parcel_items | parcels, scans, exchange_rates, users, loyalty_tiers, relais, products, business_rules | `loyalty.js`, `parcelSync.js` (via safeSyncScanToParcels indirect), `sms.js`, `rules.js`, `rates.js`, `email.js`, `reference.js` | `payments.js` | 🔴 **84** |
| `utils/parcelSync.js` | **orders.status**, order_status_history, parcels | parcel_items, scans | — | `scans.js`, `logistics.js` | 🔴 **CRITIQUE** |
| `routes/admin.js` | users, partners, products (reset), orders (DELETE) | orders, order_items, relais, customs_history, loyalty_tiers, products | — | — | 🔴 **53** |
| `routes/purchasing.js` | purchase_orders, orders | suppliers, product_suppliers, order_items | — | `payments.js`, `scans.js` | 🔴 **53** |
| `routes/scans.js` | scans, order_status_history | orders, parcels, parcel_items | `parcelSync.js`, `purchasing.js`, `loyalty.js` | — | 🔴 **52** |
| `routes/dashboard.js` | — *(lecture seule)* | orders, order_items, products, users, scans, exchange_rates, parcels, parcel_items, shipments, relais | — | — | 🟠 **42** |
| `routes/payments.js` | orders, order_status_history | — | `purchasing.js` | — | 🟠 **35** |
| `routes/logistics.js` | shipments, parcels (via parcelSync) | orders, parcels, users, relais | `parcelSync.js` ✅, `sms.js` | — | 🟠 **30** |
| `routes/products.js` | products | — | — | `orders.js`, `baskets.js`, `modules.js` | 🟠 **28** |
| `routes/auth.js` | users | — | — | — | 🟠 **25** |
| `utils/pricing.js` | — *(lecture seule)* | business_rules (via rules.js) | `rules.js` | `orders.js`, `config.js` | 🟡 **20** |
| `routes/config.js` | business_rules | — | — | `rules.js`, `pricing.js` | 🟡 **20** |
| `routes/loyalty.js` | users (loyalty_tier_id) | loyalty_tiers | — | `orders.js`, `scans.js` | 🟡 **20** |
| `validators/index.js` | — *(validation seule)* | — | — | 11/19 routes via `middleware/validate.js` | 🟡 **TRANSVERSAL** |
| `routes/finance.js` | — *(lecture + PDF)* | orders, order_items, exchange_rates | — | — | 🟡 **15** |
| `routes/pricing.js` | exchange_rates | business_rules | — | `orders.js` | 🟡 **15** |
| `routes/baskets.js` | baskets, basket_items | products | — | — | 🟢 **10** |
| `routes/modules.js` | fabrics, garment_models | products | — | — | 🟢 **10** |
| `routes/unsold.js` | unsold_items | — | `sms.js` | — | 🟢 **10** |
| `routes/relais.js` | — *(lecture seule)* | relais | — | — | 🟢 **5** |
| `routes/health.js` | — | — | — | — | 🟢 **1** |
| `middleware/auth.js` | — | users | — | 17/19 routes | 🔴 **GLOBAL** |
| `middleware/validate.js` | — | — | `validators/index.js` | 11/19 routes | 🔴 **GLOBAL** |
| `middleware/rate-limit.js` | — | — | — | `server.js` | 🟠 **GLOBAL** |
| `utils/rules.js` | — | business_rules | — | `pricing.js`, `config.js`, `orders.js` | 🟠 **TRANSVERSAL** |
| `utils/sms.js` | sms_log | — | Africa’s Talking API | `orders.js`, `scans.js`, `logistics.js`, `unsold.js`, `purchasing.js` | 🟠 **TRANSVERSAL** |
| `utils/email.js` | — | — | Resend / SMTP | `orders.js` | 🟡 **TRANSVERSAL** |
| `utils/rates.js` | — | exchange_rates | — | `orders.js`, `pricing.js` | 🟡 **TRANSVERSAL** |
| `utils/reference.js` | — | orders, parcels (COUNT) | — | `orders.js`, `logistics.js` | 🟢 **TRANSVERSAL** |
| `utils/refunds.js` | refunds, store_credits | orders | — | `orders.js` | 🟠 **20** |
| `utils/store-credits.js` | store_credits | — | — | `orders.js` | 🟡 **15** |
| `server.js` | — | — | TOUTES les routes montées | — | 🔴 **GLOBAL** |
| `db.js` | — | — | Pool PostgreSQL | TOUS les fichiers | 🔴 **GLOBAL** |

---

## 🌐 DÉPENDANCES EXTERNES

| Service | Utilisé par | Impact si down/changé |
|---------|-------------|----------------------|
| **Supabase PostgreSQL** | `db.js` → tout | 🔴 Tout KO |
| **Stripe** | `payments.js`, `orders.js` (refund) | 🔴 Paiements + annulations KO |
| **Africa’s Talking** | `utils/sms.js` → 5 modules | 🟠 SMS KO — commandes continuent mais notifications silencieuses |
| **Resend / SMTP** | `utils/email.js` → `orders.js` | 🟡 Emails de confirmation KO |

---

## 💥 BLAST RADIUS PAR FICHIER

> "Si je touche X → quoi d’autre explose ?"

| Fichier modifié | Impact direct | Impact indirect |
|-----------------|---------------|-----------------|
| `utils/parcelSync.js` | orders.status (toutes commandes actives) | Dashboard KPIs, SMS notifications, SLA calcul |
| `routes/orders.js` | Création/annulation commandes, crédits boutique, colis | loyalty, payments webhook, parcels, refunds |
| `routes/scans.js` | Statut parcels, historique | parcelSync → orders.status → dashboard |
| `routes/payments.js` | Déclenchement post-paiement | purchasing → preparation → tout le pipeline |
| `routes/purchasing.js` | Bons de commande | scans attend les produits |
| `routes/logistics.js` | Shipments + arrivée conteneur | parcelSync → orders.status, SMS clients |
| `validators/index.js` | Validation d’entrée 11/19 routes | Si cassé → données invalides partout |
| `utils/pricing.js` | Calcul prix final | orders.js (total_kmf), dashboard (marges) |
| `utils/rules.js` | Paramètres métier | pricing, orders, scans — tout ce qui lit business_rules |
| `utils/sms.js` | Notifications client | orders, scans, logistics, unsold, purchasing |
| `middleware/auth.js` | Authentification | 17/19 routes inaccessibles si cassé |
| `middleware/validate.js` | Validation requêtes | Données invalides si cassé |
| `db.js` | Connexion PostgreSQL | TOUT |
| `server.js` | Montage routes | TOUT |

---

## 🔗 CHAÎNES CRITIQUES

### Chaîne 1 — Happy Path (achat → collecte)
```
POST /orders (confirmed)
  → payments.js webhook (ordered)
    → purchasing.js (bon de commande)
      → scans.js SCAN Hub (preparation)
        → logistics.js shipment (shipped → in_transit)
          → scans.js SCAN Relais (available) → SMS client
            → orders.js SCAN QR (collected) → loyalty recalc
```
**Si un maillon casse :** la commande reste bloquée au statut précédent. Dashboard `/problems` la détecte.

### Chaîne 2 — Annulation + Remboursement
```
POST /orders/:id/cancel
  → Vérifie fenêtre (CANCEL_FREE_WINDOW_HOURS)
    → Stripe refund OU store_credit
      → INSERT refunds
        → UPDATE orders SET status=’cancelled’
          → Restaure stock (products)
            → SMS client
```
**Si Stripe fail :** ROLLBACK complet, commande reste active. Pas de demi-état.

### Chaîne 3 — Expédition partielle
```
POST /orders/:id/partial-ship
  → Crée parcel ‘partial’ (preparation)
  → Crée parcel ‘backorder’ (draft)
  → Si cancel backorder → refund partiel + stock restauré
  → Quand tous parcels collected → parent = collected
```
**Si crash mid-transaction :** ROLLBACK. Aucun colis créé.

### Chaîne 4 — Cash Relais
```
POST /orders (confirmed, cash_ref_code généré)
  → Client va au relais, dicte code 6 chiffres
    → Agent relais PATCH /:id/status → ordered + payment_status=’paid’
      → Suite = Chaîne 1 depuis purchasing
```
**Si agent valide le mauvais code :** pas de guard côté backend (TODO: valider cash_ref_code dans PATCH).

---

## ✅ CHECKLIST PRÉ-CODE — OBLIGATOIRE

> Un agent DOIT répondre à ces 8 questions **avant** d’écrire une ligne de code.
> Les réponses doivent être consignées dans un fichier `docs/_work/[NOM]_ANALYSIS.md`.

| # | Question | Réponse exigée |
|---|----------|----------------|
| 1 | Quelles zones je touche ? | Fichiers + scores de risque (voir matrice) |
| 2 | Quelles tables j’écris ? | Liste INSERT/UPDATE/DELETE par table |
| 3 | Quel invariant pourrait casser ? | R1–R7 concernés — si aucun, justifier |
| 4 | Quel est le blast radius ? | Modules impactés en cascade (voir §5) |
| 5 | Est-ce que je touche un fichier sanctuarisé ? | Si oui → validation propriétaire obligatoire |
| 6 | Mon analyse est dans `_work/` ? | Chemin du fichier |
| 7 | Le propriétaire a validé ? | **Oui / Non** |
| 8 | Quels tests dois-je vérifier/écrire ? | Liste des cas de test |

> ⚠️ **Si la réponse 7 est Non → STOP. Ne pas coder.**

---

## 🔙 PROTOCOLE DE ROLLBACK

### Niveau 1 — Code (git)

```bash
# Dernier commit
git revert HEAD --no-edit

# Plusieurs commits (remplacer N)
git revert HEAD~N..HEAD --no-edit

# Revenir à un commit spécifique (destructif)
git reset --hard <sha> && git push --force
```

### Niveau 2 — Données (par zone)

```sql
-- Orders : remettre un statut
-- ⚠️ UNIQUEMENT en urgence — contourne R1
UPDATE orders SET status = 'confirmed', updated_at = NOW()
WHERE id = '<uuid>';
INSERT INTO order_status_history (order_id, status, note, changed_by)
VALUES ('<uuid>', 'confirmed', 'ROLLBACK MANUEL — [raison]', '<admin_uuid>');

-- Parcels : annuler un colis
UPDATE parcels SET status = 'cancelled', cancelled_at = NOW(),
  cancel_reason = 'ROLLBACK — [raison]'
WHERE id = '<uuid>';

-- Stock : restaurer après erreur
UPDATE products SET stock = stock + <qty> WHERE id = '<uuid>';

-- Store credits : supprimer un crédit erroné
DELETE FROM store_credits WHERE id = '<uuid>' AND remaining_kmf = amount_kmf;

-- Users : restaurer un soft-delete
UPDATE users SET email = '<original_email>', full_name = '<name>',
  phone = '<phone>', updated_at = NOW()
WHERE id = '<uuid>';
```

### Niveau 3 — Supabase

```
1. Dashboard Supabase → Backups → Point-in-time recovery
2. Ou : pg_dump avant toute migration, pg_restore si échec
```

---

## 📡 NOTES SUPABASE

- **RLS** : vérifier les policies Supabase avant d’ajouter une table. Les policies peuvent bloquer silencieusement les INSERT/UPDATE depuis le backend.
- **Triggers SQL** : le trigger `compute_real_margin` recalcule `margin_real_pct` et `margin_alert` quand `cost_real_kmf` change dans `orders`.
- **Enums DB** : `user_role` = ('client', 'admin', 'agent_relais', 'agent_hub'). `parcel_status` est un enum PostgreSQL — toute modification nécessite `ALTER TYPE`.
- **Connexion** : le backend utilise un pool `pg` standard (pas le client Supabase JS). Les policies RLS ne s’appliquent que si la connexion utilise le rôle `anon` ou `authenticated`.

---

## 🔄 PROTOCOLE DE MISE À JOUR

> Ce document DOIT rester synchronisé avec le code.

| Quand | Action |
|-------|--------|
| PR qui modifie un fichier de la matrice | Mettre à jour ZONE_IMPACT.md **dans le même commit** |
| Nouvel invariant découvert | Ajouter immédiatement (R8, R9...) |
| Nouveau module (ex: pièces détachées) | Ajouter dans la matrice + blast radius + checklist |
| Score de risque obsolète | Re-générer via `node scripts/impact-check.js` |
| Incohérence code ↔ document | Le code fait foi — corriger le document |
