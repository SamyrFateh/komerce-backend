# ZONE_IMPACT.md — Toile d'Araignée Komerce
> Source : CARTOGRAPHY_360.md v15.15 — 07/04/2026
> **PROTOCOLE : Lire ce fichier AVANT toute modification de code.**

---

## ⛔ INVARIANTS ABSOLUS

> Casser un invariant = état incohérent irrécupérable sans intervention manuelle.

| ID | Règle | Fichier source |
|----|-------|----------------|
| **R1** | `orders.status` ne se modifie **QUE** via `parcelSync.js → computeOrderStatus()` | `utils/parcelSync.js` |
| **R2** | Hub = 3 actions seulement. Le système décide du statut, l'opérateur exécute | `utils/parcelSync.js` |
| **R3** | Transitions `order_status` uniquement via `VALID_TRANSITIONS` + `TRANSITION_ROLES` | `routes/orders.js` |
| **R4** | Jamais `UPDATE orders SET status = ...` direct — même en migration | Toutes les routes |
| **R5** | Création de commande = `SELECT ... FOR UPDATE` dans une transaction (race condition stock) | `routes/orders.js:270` |
| **R6** | `parcel_status` suit sa propre machine à états — ne jamais synchroniser manuellement | `utils/parcels.js` |

---

## 🔄 MACHINES À ÉTATS

```
order_status :
  confirmed → ordered → preparation → shipped → in_transit → available → collected
                                                                  ↓
                                     cancelled (admin, tout statut) → refunded

parcel_status :
  draft → preparation → shipped → in_transit → arrived → available → collected → cancelled
```

---

## 🕸️ MATRICE COMPOSANTS × TABLES

| Composant | Tables **W** (écriture) | Tables **R** (lecture seule) | Appelle | Appelé par | 🎯 Risque |
|-----------|------------------------|------------------------------|---------|------------|-----------|
| `routes/orders.js` | orders, order_items, order_status_history, recipients, store_credits, refunds | parcels, parcel_items, scans, exchange_rates, users, loyalty_tiers, relais, products | `loyalty.js` getLoyaltyDiscount / recalculateLoyalty | `payments.js` | 🔴 **84** |
| `utils/parcelSync.js` | **orders.status**, order_status_history, parcels | parcel_items, scans | — | `scans.js`, `logistics.js`⚠️R1 | 🔴 **CRITIQUE** |
| `routes/admin.js` | users, partners, orders | orders, order_items, relais, customs_history, loyalty_tiers, products | — | — | 🔴 **53** |
| `routes/purchasing.js` | purchase_orders, orders | suppliers, product_suppliers, order_items | — | `payments.js` triggerPurchasing, `scans.js` triggerScan3 | 🔴 **53** |
| `routes/scans.js` | scans, order_status_history | orders, parcels, parcel_items | `parcelSync.js` safeSyncScanToParcels, `purchasing.js` triggerScan3, `loyalty.js` recalculateLoyalty | — | 🔴 **52** |
| `routes/dashboard.js` | — *(lecture seule)* | orders, order_items, products, users, scans, exchange_rates, parcels, parcel_items, shipments, relais | — | — | 🟠 **42** |
| `routes/payments.js` | orders, order_status_history | — | `purchasing.js` triggerPurchasing | — | 🟠 **35** |
| `routes/logistics.js` | shipments, orders⚠️**R1**, parcels | — | `utils/sms.js` | — | 🟠 **30** |
| `routes/products.js` | products | — | — | `routes/orders.js`, `routes/baskets.js`, `routes/modules.js` | 🟠 **28** |
| `routes/auth.js` | users | — | — | — | 🟠 **25** |
| `routes/config.js` | business_rules | — | — | `utils/rules.js`, `utils/pricing.js` | 🟡 **20** |
| `routes/loyalty.js` | users (loyalty_tier_id) | loyalty_tiers | — | `routes/orders.js`, `routes/scans.js` | 🟡 **20** |
| `routes/finance.js` | — *(lecture + PDF)* | orders, order_items, exchange_rates | — | — | 🟡 **15** |
| `routes/pricing.js` | exchange_rates | business_rules | — | `routes/orders.js` | 🟡 **15** |
| `routes/baskets.js` | baskets, basket_items | products | — | — | 🟢 **10** |
| `routes/modules.js` | fabrics, garment_models | products | — | — | 🟢 **10** |
| `routes/unsold.js` | unsold_items | — | `utils/sms.js` | — | 🟢 **10** |
| `routes/relais.js` | — *(lecture seule)* | relais | — | — | 🟢 **5** |
| `routes/health.js` | — | — | — | — | 🟢 **1** |
| `server.js` | — | — | TOUTES les routes montées | — | 🔴 **GLOBAL** |
| `db.js` | — | — | Pool PostgreSQL | TOUS les fichiers | 🔴 **GLOBAL** |
| `middleware/auth.js` | — | users | — | 17/19 routes | 🔴 **GLOBAL** |
| `utils/rules.js` | — | business_rules | — | `pricing.js`, `config.js`, `orders.js` | 🟠 **TRANSVERSAL** |
| `utils/sms.js` | sms_log | — | Africa's Talking | `orders.js`, `scans.js`, `logistics.js`, `unsold.js`, `purchasing.js` | 🟠 **TRANSVERSAL** |

---

## 💥 BLAST RADIUS PAR FICHIER

> "Si je touche X → quoi d'autre explose ?"

| Fichier modifié | Impact direct | Impact indirect |
|-----------------|---------------|-----------------|
| `utils/parcelSync.js` | orders.status (toutes commandes actives) | Dashboard KPIs, SMS notifications, SLA calcul |
| `routes/orders.js` | Création/annulation commandes, crédits boutique | loyalty, payments webhook, parcels |
| `routes/scans.js` | Statut parcels + orders (via parcelSync) | loyalty recalcul, purchasing trigger, dashboard |
| `server.js` | Rate limiters, CORS, routes montées | TOUT le backend |
| `db.js` | Pool connexions PostgreSQL | TOUS les modules |
| `middleware/auth.js` | Authentification + rôles | 17/19 routes |
| `routes/products.js` | Catalogue + stock | orders (création), baskets, modules |
| `routes/payments.js` | Déclenchement du flux achat post-paiement | purchasing → scans → parcelSync → orders.status |
| `routes/logistics.js` | ⚠️ Modifie orders.status directement (violation R1 connue) | SMS batch, disponibilité commandes |
| `utils/rules.js` | Règles métier dynamiques | pricing, config, orders (marges, fret) |
| `utils/sms.js` | Notifications clients | orders, scans, logistics, purchasing, unsold |
| `validators/index.js` | Tous les schémas de validation | 11/19 routes |

---

## 🔗 CHAÎNE CRITIQUE (couplage linéaire — panne = blocage total)

```
Paiement confirmé
    │
    ▼
payments.js ──triggerPurchasing()──▶ purchasing.js ──triggerScan3()──▶ scans.js
                                                                           │
                                              safeSyncScanToParcels() ◄───┤
                                                       │                  │
                                                       ▼                  └──▶ loyalty.js
                                              parcelSync.js                    recalculateLoyalty()
                                                       │
                                                       ▼
                                              orders.status (SOURCE DE VÉRITÉ)
                                                       │
                                                       ▼
                                              dashboard.js (lecture KPIs)
```

---

## ✅ CHECKLIST PRÉ-CODE OBLIGATOIRE

> Compléter AVANT d'écrire la première ligne. Committer les réponses dans `docs/_work/` si 🔴/🟠.

```
[ ] 1. Fichier(s) concerné(s) :        ___________________________
[ ] 2. Score de risque (matrice) :     🔴 / 🟠 / 🟡 / 🟢
[ ] 3. Tables W (écriture) :           ___________________________
       → Un invariant R1/R2/R3/R4/R5/R6 est-il concerné ? OUI / NON
[ ] 4. Modules qui appellent ce fichier (blast radius) : ___________
[ ] 5. Modules appelés par ce fichier : ___________________________
[ ] 6. Analyse commitée dans docs/_work/ avant code ? OUI / NON (obligatoire si 🔴)
```

**Règle de commit par score :**
- 🔴 → Analyse commitée dans `docs/_work/` AVANT tout code. Commit `wip:` toutes les 10 min.
- 🟠 → Commit `wip:` toutes les 10 min.
- 🟡 → Commit avant de passer à autre chose.
- 🟢 → Commit à la fin de la tâche.

---

## 🔙 PROTOCOLE DE ROLLBACK

```sql
-- 1. Identifier les commandes modifiées dans la dernière heure
SELECT id, status, updated_at FROM orders WHERE updated_at > NOW() - INTERVAL '1h' ORDER BY updated_at DESC;

-- 2. Identifier les parcels incohérents
SELECT p.id, p.status, o.status as order_status
FROM parcels p JOIN orders o ON p.order_id = o.id
WHERE p.updated_at > NOW() - INTERVAL '1h';
```

```bash
# 3. Sauvegarder le travail en cours
git stash

# 4. Voir les derniers commits
git log --oneline -10

# 5. Annuler le dernier commit (conserve les fichiers)
git revert HEAD --no-edit

# 6. Documenter dans docs/_pending/
echo "ROLLBACK $(date): [description]" >> docs/_pending/rollback_log.md
git add docs/_pending/ && git commit -m "wip: rollback documenté"
```

---

> 🕸️ *ZONE_IMPACT.md v1.0 — Distillé depuis CARTOGRAPHY_360.md v15.15*
> *Mise à jour : appliquer le même DELTA que CARTOGRAPHY_360 à chaque changement architectural.*
> *Criticité calculée depuis sections 7, 8, 20 de la cartographie + violations V-01/V-04.*
