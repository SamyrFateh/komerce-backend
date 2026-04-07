# KOMERCE — PLAN LOGISTIQUE FUSIONNÉ v2.0
> **Date** : 07/04/2026 | **Auteur** : Tasklet  
> **Base** : PLAN_IMPLEMENTATION_DETAILLE + ROADMAP v16.1 + GOVERNANCE v2.2 + CARTOGRAPHY v15.14  
> **Source de vérité** : Ce document remplace toute planification logistique antérieure

---

## ⚖️ DEUX RÈGLES ABSOLUES (non-négociables)

| # | Règle | Traduction technique |
|---|-------|---------------------|
| **R1** | Aucun flow ne dépend de la complétude d'une commande | Chaque `parcel` est une unité autonome. Un colis peut passer en `shipped` sans que les autres colis de la même commande soient prêts. `orders.status` = agrégation de `parcels.status` via `parcelSync.js`, jamais écrit directement. |
| **R2** | L'opérateur terrain : scanner → carton → sceller | Le Hub Interface n'expose que 3 actions. Pas de décisions de disponibilité, pas de gestion de sous-commandes, pas de backorder à la main. Le système décide, l'opérateur exécute. |

---

## 🗺️ ÉTAT DU SOCLE (Truth au 07/04/2026)

### Ce qui est en production

| Composant | Fichier | Statut |
|-----------|---------|--------|
| Tables parcels + parcel_items | migration 010 | ✅ |
| Dual-write parcels ↔ orders | migration 011 | ✅ |
| Trigger migration scans → parcels | migration 012 | ✅ |
| Legacy cleanup sub_orders | migration 013 | ✅ |
| Moteur parcel (`splitOrderIntoParcels`, `generateParcelRef`) | `utils/parcels.js` | ✅ |
| Source de vérité orders.status | `utils/parcelSync.js` | ✅ |
| Moteur rules (`getRuleNumber`, `getRuleString`) | `utils/rules.js` | ✅ |
| 37 règles business en DB | table `business_rules` | ✅ |
| Store credits + Refunds | migration 007 | ✅ |
| POST /orders/:id/cancel | `orders.js` | ✅ |
| mark-availability + partial-ship | `orders.js` | ✅ |
| Dashboard annulations-parcels | `dashboard.js` #115 | ✅ |
| POST /scans/hub/receive | `scans.js` | ✅ |
| API config/rules (CRUD admin) | `routes/config.js` | ✅ |

### Violations actives identifiées (à corriger Vague 1)

| ID | Fichier | Violation | Règle |
|----|---------|-----------|-------|
| V-01 | `logistics.js` L. PATCH /:id | `UPDATE orders SET status = 'available'` direct → bypass parcelSync | R1 |
| V-02 | `logistics.js` | SMS batch couplé à l'arrivée du conteneur, pas du colis | R1 |
| V-03 | `scans.js` hub/receive | Pas de création automatique de parcel à la réception | R2 |
| V-04 | `orders.js` mark-availability | Interface trop granulaire pour l'opérateur | R2 |
| V-05 | `parcels` table | Pas de CRUD API publique (seulement interne) | - |

---

## 🌊 VAGUE 1 — Socle Parcel-Centric + Sécurité (~22h)

> **Objectif** : Tout ce qui touche à la logistique passe par `parcels`. Zéro violation R1/R2. 6 critiques sécurité corrigées.

### 1.1 — Clore PR #115 + nettoyage numérotation (1h)

- Merger PR #115 (dashboard annulations-parcels) si pas encore fait
- Renuméroter les migrations : 014 disponible pour la vague

### 1.2 — API CRUD Parcels (`routes/parcels.js`) (4h)

Créer le fichier `routes/parcels.js` — endpoints publics pour la gestion des colis :

| # | Méthode | Endpoint | Auth | Description |
|---|---------|----------|------|-------------|
| 1 | GET | `/api/parcels` | admin, agent_hub | Liste colis (filtres: status, shipment_id, order_id) |
| 2 | GET | `/api/parcels/:ref` | admin, agent_hub, agent_relais | Détail colis par référence KOM-P-YYYY-NNNNNN |
| 3 | POST | `/api/parcels` | admin, agent_hub | Créer colis manuellement (indépendamment d'une commande) |
| 4 | PATCH | `/api/parcels/:id/status` | admin, agent_hub | Changer statut (via parcelSync) |
| 5 | POST | `/api/parcels/:id/items` | admin, agent_hub | Ajouter articles dans un colis |
| 6 | DELETE | `/api/parcels/:id/items/:item_id` | admin, agent_hub | Retirer article d'un colis |
| 7 | GET | `/api/parcels/:id/label` | admin, agent_hub | Étiquette PDF A6 |

**Règle R1 garantie** : tout changement de statut passe par `parcelSync.safeSyncScanToParcels()`.

### 1.3 — Fix logistics.js (violation R1) (2h)

```
PATCH /api/logistics/shipments/:id
```

**Avant (violation R1)** :
```javascript
// ACTUEL — interdit
await db.query('UPDATE orders SET status = $1 WHERE shipment_id = $2', ['available', id]);
```

**Après (conforme R1)** :
```javascript
// NOUVEAU — pour chaque parcel du shipment
for (const parcel of parcels) {
  await parcelSync.safeSyncScanToParcels(db, {
    parcel_id: parcel.id,
    new_status: 'available',
    scanned_by: req.user.id,
    notes: `Arrivée conteneur ${shipment.container_ref}`
  });
}
// orders.status calculé automatiquement par parcelSync
```

**SMS** : envoyé par parcel (1 SMS/colis disponible), pas en bulk sur la commande entière.

### 1.4 — migration 014 — Colonnes legacy cleanup (2h)

```sql
-- 014_parcels_final_cleanup.sql
-- Supprimer colonnes orders.shipment_id (legacy pré-parcel-centric)
-- Supprimer colonnes orders.tracking_ref (migré vers parcels.tracking_ref)
-- Conserver availability_log sur order_items (audit trail)
-- Ajouter index parcels(shipment_id), parcels(order_id), parcels(status)
-- Ajouter index parcel_items(parcel_id), parcel_items(order_item_id)

ALTER TABLE orders DROP COLUMN IF EXISTS shipment_id;
ALTER TABLE orders DROP COLUMN IF EXISTS tracking_ref;

CREATE INDEX IF NOT EXISTS idx_parcels_shipment ON parcels(shipment_id);
CREATE INDEX IF NOT EXISTS idx_parcels_order ON parcels(order_id);
CREATE INDEX IF NOT EXISTS idx_parcels_status ON parcels(status);
CREATE INDEX IF NOT EXISTS idx_parcel_items_parcel ON parcel_items(parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_items_order_item ON parcel_items(order_item_id);

-- Déprecation log
CREATE TABLE IF NOT EXISTS deprecation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  reason TEXT,
  deprecated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.5 — Sécurité : 6 CRITIQUES (#71–#76) (10h)

| Issue | Fichier | Fix |
|-------|---------|-----|
| #71 — SQL injection | `admin.js`, `dashboard.js`, `products.js`, `logistics.js` | Paramétrer toutes les requêtes avec construction dynamique. Utiliser un helper `buildWhereClause(filters)` sécurisé. |
| #72 — JWT secret faible | `middleware/auth.js:26` | Supprimer le fallback `komerce_secret_dev_UNSAFE`. Si `JWT_SECRET` absent → crash au démarrage avec message clair. |
| #73 — Admin password reset | `admin.js` | Exiger `current_password` OU token admin 2FA pour `/api/admin/users/:id/password`. |
| #74 — CORS trop permissif | `server.js:66` | Remplacer `*.up.railway.app` par whitelist explicite. Lire les origines autorisées depuis `business_rules` (`ALLOWED_ORIGINS`). |
| #75 — Rate limiting admin | `server.js` | Ajouter `adminLimiter` (20 req/min) sur toutes les routes `/api/admin/*`. |
| #76 — POST /admin/reset en prod | `admin.js` | Gate `NODE_ENV !== 'production'` strict. En prod → 403 immédiat. |

**Mise à jour CARTOGRAPHY_360 (delta)** : section 18 Audit de sécurité → passer #71-#76 en ✅ CLOSED.

### 1.6 — Validators (1h)

- Ajouter schéma Joi pour `POST /api/parcels`
- Ajouter schéma Joi pour `PATCH /api/parcels/:id/status`
- Valider `parcel_status` enum dans toutes les transitions

---

## 🌊 VAGUE 2 — Hub Terrain Simplifié (~20h)

> **Objectif** : L'opérateur hub ne voit que 3 boutons. Scanner → Emballer → Sceller.

### Principe d'interface (Règle R2)

```
┌─────────────────────────────────────────────────────────┐
│  HUB DUBAI — Interface Opérateur                        │
│                                                         │
│  📱 [SCANNER UN COLIS]                                  │
│     → Affiche : référence + articles + photo attendue  │
│                                                         │
│  📦 [CONFIRMER EMBALLAGE]                               │
│     → Input: N° carton + photo optionnelle              │
│                                                         │
│  ✅ [SCELLER & EXPÉDIER]                                │
│     → Génère étiquette PDF + passe parcel en shipped    │
│                                                         │
│  ─────── Aucune décision. Aucun backorder manuel. ──── │
│  Le système gère. L'opérateur exécute.                  │
└─────────────────────────────────────────────────────────┘
```

### 2.1 — `routes/hub.js` — Route Hub simplifiée (6h)

| # | Méthode | Endpoint | Rôle |
|---|---------|----------|------|
| 1 | POST | `/api/hub/scan` | Scanner QR d'un colis → retourne détails + actions disponibles |
| 2 | POST | `/api/hub/pack` | Confirmer emballage (parcel → `preparation`) + photo optionnelle |
| 3 | POST | `/api/hub/seal` | Sceller + expédier (parcel → `shipped`) → génère étiquette |
| 4 | GET | `/api/hub/pending` | File d'attente colis à traiter (remplace /scans/hub/pending) |
| 5 | GET | `/api/hub/today` | Stats de la journée (nb scannés, emballés, expédiés) |

**Logique `POST /api/hub/scan`** :
```
QR scanné → lookup parcel par ref ou order_item barcode
→ Si order multi-items non encore splittés → auto-split via splitOrderIntoParcels()
→ Retour : { parcel, items, next_action: 'pack' | 'seal' | 'already_done' }
```

**Règle R1** : le scan crée ou identifie un parcel. Jamais de lookup sur la commande entière.

**Règle R2** : l'agent ne prend aucune décision. Si un article n'est pas disponible, le système crée un backorder automatique et l'opérateur reçoit seulement `{ next_action: 'pack_partial', items_available: [...] }`.

### 2.2 — Auto-split silencieux (3h)

Lors du premier scan d'un article d'une commande multi-articles :

```
Première réception article A d'une commande {A, B, C}
→ parcels déjà créés ? Non
→ splitOrderIntoParcels() → crée parcel P1 pour A
→ si B et C pas encore reçus → parcel P2 créé en status 'draft' (backorder automatique)
→ règle PARTIAL_SHIP_DELAY_THRESHOLD_DAYS consultée
→ si délai dépassé → SMS client automatique (informatif, pas de décision demandée)
```

**Pas de `mark-availability` manuel**. L'opérateur scanne, le système split.

### 2.3 — Page Hub Frontend (`public/Komerce_Hub_V2.html`) (6h)

Page HTML autonome (même pattern que les autres pages) :
- UI ultra-simple : grand bouton scan (webcam ou input manuel)
- Affichage colis : photo article attendue, dimensions, poids estimé
- Confirmation emballage : input N° carton + bouton
- Génération étiquette : PDF A6 inline + impression automatique
- Dashboard journée : compteurs en temps réel

**Dépendances** : `komerce-api.js` (partagé), endpoints `/api/hub/*`

### 2.4 — Parcels backorder auto + SMS (2h)

Lors de l'auto-split, si le backorder dépasse `BACKORDER_MAX_DAYS` :
```
SMS client : "Un de vos articles (réf. KXXX) sera livré séparément dans ~X jours. 
              Vos autres articles partent aujourd'hui. Réf. colis : KOM-P-2026-XXXXXX"
```

Aucune intervention admin requise.

### 2.5 — Dashboard Hub (vue HubDubaiView.tsx) (3h)

Mettre à jour `HubDubaiView.tsx` pour consommer `/api/hub/today` + `/api/dashboard/hub-dubai` :
- Nb colis scannés/emballés/expédiés aujourd'hui
- File d'attente actuelle
- Alertes backorders auto
- Lien vers Hub V2 page

---

## 🌊 VAGUE 3 — Optimisation Avancée (~54h)

> **Objectif** : Enrichissement données logistiques pour pilotage précis et multi-transporteurs.

### 3.1 — Douane enrichie (8h)

**migration 015 — customs_enrichment.sql** :
```sql
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(8,3);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS volume_cm3 NUMERIC(10,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS declared_value_eur NUMERIC(10,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_hs_code TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_cleared_at TIMESTAMPTZ;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_duty_eur NUMERIC(10,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_notes TEXT;
```

Endpoint : `PATCH /api/parcels/:id/customs` — saisie douanière par admin.

`utils/pricing.js` — intégration poids/volume dans calcul coût réel :
```javascript
const CUSTOMS_DEFAULT_PCT = await getRuleNumber('CUSTOMS_DEFAULT_PCT', 20);
const FREIGHT_PER_KG = await getRuleNumber('FREIGHT_KMF_PER_KG', 65);
// actualCost = declared_value_eur * customs_rate + weight_kg * FREIGHT_PER_KG
```

### 3.2 — Poids et volume (5h)

**Sur `parcel_items`** :
```sql
ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS unit_weight_kg NUMERIC(8,3);
ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS unit_volume_cm3 NUMERIC(10,2);
```

Calcul automatique `parcels.weight_kg = SUM(parcel_items.quantity * parcel_items.unit_weight_kg)`.

Nouvelles rules business :
- `MAX_PARCEL_WEIGHT_KG` (défaut: 30)
- `MAX_PARCEL_VOLUME_CM3` (défaut: 125000 = 50×50×50cm)

Si dépassement au moment du split → alerte admin, parcel splitté automatiquement.

### 3.3 — Multi-transporteurs enrichis (12h)

**migration 016 — carriers.sql** :
```sql
CREATE TABLE IF NOT EXISTS carriers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,  -- 'MSC', 'CMA_CGM', 'AIR_FRANCE', 'TRANSIT_LOCAL'
  type        TEXT NOT NULL,         -- 'sea', 'air', 'land'
  origin      TEXT NOT NULL DEFAULT 'DXB',
  destination TEXT NOT NULL DEFAULT 'HAH',
  avg_days    INTEGER,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES carriers(id);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS carrier_type TEXT; -- 'sea', 'air', 'land'
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS actual_weight_kg NUMERIC(10,3);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS actual_volume_m3 NUMERIC(8,4);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS freight_cost_eur NUMERIC(12,2);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS cost_per_kg_eur NUMERIC(8,4);
```

Endpoints :
- `GET /api/logistics/carriers` — liste transporteurs actifs
- `POST /api/logistics/carriers` — créer transporteur (admin)
- `GET /api/dashboard/logistics/costs` — coûts réels vs estimés par transporteur

### 3.4 — Dashboard coûts logistiques (8h)

Nouvelle vue dans `dashboard-app` : **LogisticsView.tsx**
- Coût moyen par colis par transporteur
- Écart coût estimé vs réel (douane)
- Poids moyen par expédition
- Délai moyen par route et transporteur
- Alertes colis surdimensionnés

Endpoint : `GET /api/dashboard/logistics` (admin) — agrégation depuis parcels + shipments + carriers.

### 3.5 — Optimisation SLA parcel-level (5h)

Aujourd'hui le SLA est calculé au niveau commande. En Vague 3, il descend au niveau colis :

```sql
-- Vue matérialisée
CREATE VIEW v_parcel_sla AS
SELECT 
  p.id, p.reference, p.status, p.order_id,
  p.created_at,
  EXTRACT(EPOCH FROM (NOW() - p.created_at))/86400 AS age_days,
  CASE 
    WHEN ... > SLA_BLOCKED_DAYS THEN 'blocked'
    WHEN ... > SLA_LATE_DAYS    THEN 'late'
    WHEN ... > SLA_WARNING_DAYS THEN 'warning'
    ELSE 'ok'
  END AS sla_status
FROM parcels p;
```

Intégration dans `RetardsView.tsx` : retards par colis (et non plus par commande).

### 3.6 — Photo colis enrichie (3h)

Actuellement : `POST /api/logistics/parcels/:id/photo` (1 photo).

En V3 : galerie photos (avant/après emballage, état à réception) :
```sql
CREATE TABLE IF NOT EXISTS parcel_photos (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parcel_id  UUID NOT NULL REFERENCES parcels(id),
  url        TEXT NOT NULL,
  step       TEXT NOT NULL,  -- 'received', 'packed', 'sealed', 'damaged'
  taken_by   UUID REFERENCES users(id),
  taken_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.7 — Catalogue Pièces Auto/Moto (13h) — Backlog entrant

> 12 tâches initiales + migration 017 dédiée. Déclenché en fin de Vague 3.

---

## 📊 PLANNING CONDENSÉ

```
VAGUE 1 (~22h) ─── Sprint 1-2 semaines
├── 1.1  Clore PR #115 + numérotation        1h
├── 1.2  routes/parcels.js (CRUD API)        4h
├── 1.3  Fix logistics.js (R1)               2h
├── 1.4  migration 014 (cleanup + index)     2h
├── 1.5  Sécurité #71-#76                   10h
└── 1.6  Validators                          1h (+ 2h delta CARTO)

VAGUE 2 (~20h) ─── Sprint 2-3 semaines
├── 2.1  routes/hub.js simplifié             6h
├── 2.2  Auto-split silencieux               3h
├── 2.3  Hub Frontend V2                     6h
├── 2.4  Backorder auto + SMS                2h
└── 2.5  HubDubaiView.tsx                    3h

VAGUE 3 (~54h) ─── Sprint 3-6 semaines
├── 3.1  Douane enrichie                     8h
├── 3.2  Poids et volume                     5h
├── 3.3  Multi-transporteurs enrichis       12h
├── 3.4  Dashboard coûts logistiques         8h
├── 3.5  SLA parcel-level                    5h
├── 3.6  Photo colis enrichie                3h
└── 3.7  Catalogue Auto/Moto               13h

TOTAL : ~96h
```

---

## 🔒 GOUVERNANCE — Intégration dans le protocole existant

### Règles conservées (GOVERNANCE.md v2.2)

1. ✅ Workflow ① Roadmap → ② Carto → ③ Coffre → ④ Implémenter — **maintenu**
2. ✅ Commit auto 10min — **trigger actif**
3. ✅ Système deltas `docs/_pending/` — **maintenu**
4. ✅ Impact Check GitHub Actions — **maintenu**

### Nouvelles règles ajoutées par ce plan

| # | Règle | Application |
|---|-------|-------------|
| **R1** | Jamais `UPDATE orders SET status` directement | Lint check dans `.cursorrules` + PR guard |
| **R2** | Hub interface ≤ 3 actions | Reviewer checklist PR template |
| **R3** | Tout nouveau endpoint logistique passe par parcelSync | Documentation `utils/parcelSync.js` |

### Ordre de travail (Prochaine session)

```
✅ Terminé avant ce plan :
  Parcel-Centric Phases 1-4 (migrations 010-013)
  Gouvernance Phases 1-3 (business_rules + annulation + refunds)
  Dashboard annulations-parcels (PR #115)
  Dashboard Pilotage 11/11

🟠 VAGUE 1 — À démarrer :
  ① Clore PR #115 + numérotation
  ② routes/parcels.js
  ③ Fix logistics.js
  ④ migration 014
  ⑤ Sécurité #71-#76

⬜ VAGUE 2 : routes/hub.js + interface terrain
⬜ VAGUE 3 : douane + poids + multi-carriers
⬜ BACKLOG : Catalogue Auto/Moto (12 tâches)
```

---

## ⚠️ INCOHÉRENCES LEVÉES (7 + 3 nouvelles)

| # | Incohérence | Résolution |
|---|------------|------------|
| 1 | Multi-transporteurs en Vague 2 dans plan initial | → Déplacé Vague 3 (décision utilisateur) |
| 2 | Sécurité absente du plan initial | → Sécurité #71-#76 intégrée Vague 1 |
| 3 | `mark-availability` trop granulaire pour opérateur | → Remplacé par auto-split silencieux (R2) |
| 4 | PR #115 non clôturée bloque numérotation | → Tâche 1.1 explicite |
| 5 | `logistics.js` viole R1 (UPDATE orders direct) | → Fix tâche 1.3 |
| 6 | Renumérotation migrations (015→018) | → Clarifiée dans chaque tâche |
| 7 | Catalogue Auto/Moto orphelin | → Backlog post-V3 avec estimation 13h |
| **8** | **`scans.js hub/receive` ne crée pas de parcel** | → Corrigé dans tâche 2.1 (hub.js prend la main) |
| **9** | **SMS batch sur conteneur = 1 SMS/commande** | → Corrigé tâche 1.3 : 1 SMS/colis disponible |
| **10** | **sub_orders + sub_order_items tables legacy still referenced** | → migration 014 nettoie les FK orphelines |

---

> 📝 *Plan Logistique Komerce v2.0 — 07/04/2026*  
> *Fusion : PLAN_IMPLEMENTATION_DETAILLE + ROADMAP v16.1 + GOVERNANCE v2.2 + CARTOGRAPHY v15.14 + AUDIT_REPORT + IMPACT_SYSTEM + Point6*  
> *Règles absolues R1 + R2 appliquées à toutes les vagues*
