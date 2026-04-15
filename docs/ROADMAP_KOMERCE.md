# ROADMAP KOMERCE v17.0

> 📅 15 avril 2026 · 20+ routes · ~135 endpoints · 31+ tables  
> 📌 **Plan logistique 3 vagues** : voir `docs/PLAN_LOGISTIQUE_V2.md`

---

## Progression

| Domaine | Statut |
|---------|--------|
| Dashboard Pilotage Unifié | ✅ 11/11 |
| Gouvernance Opérationnelle | ✅ 5/5 phases |
| Boutique Live (Archipel Sage & Green) | ✅ 5/5 |
| Sprint UX A→D | ✅ 4/4 |
| Bugs Phase 7 | ✅ 14/14 |
| Tests E2E | ✅ Phases 1-3+7 · ⬜ Phases 4-6 |
| Sécurité audit initial | ✅ ~58 corrigés |
| Sécurité audit deep | ⬜ 14 issues ouvertes |
| Cartographie 360° v15 | ✅ |
| Coffre-fort (Vault) | ✅ 6/6 |
| Refonte Parcel-Centric | 🔄 3/5 phases |
| **🛡️ Audit Backend State Machine** | **✅ 10/10 commits — 100% complété** |
| **📋 Onglet Commandes CT** | **✅ Vue complète cycle de vie** |
| **🧾 Circuit complet (facture + notifs)** | **✅ Testé — 45 notifs, 0 échec** |
| **📚 Mise à jour documentation** | ⬜ 27 fichiers à synchroniser |
| **🔌 API Sourcing Externe** | ⬜ Backlog — architecture à définir |
| Catalogue Pièces Auto/Moto | ⬜ Backlog post-Vague 3 |

---

## 🛡️ Audit Backend State Machine — TERMINÉ ✅

> 10 commits du 15 avril 2026 — Toutes les transitions sauvages éliminées, state machine = SSOT à 100%.

### Architecture garantie post-audit

```
utils/parcels.js                → computeOrderStatus() SSOT CANONIQUE
  ├── utils/parcelSync.js       → importe de parcels.js ✅
  └── utils/parcelSync-v2.js    → délègue à parcels.js ✅

services/order-status-machine.js → SEUL chemin pour modifier orders.status
  ├── routes/payments.js         → pending→confirmed→ordered ✅
  ├── routes/order-api-v2.js     → confirm-cash, cancel ✅
  ├── routes/hub-dashboard.js    → start-prep, ship ✅
  ├── utils/parcelSync.js        → scan sync ✅
  └── routes/parcel-api-v2.js    → parcel scan ✅
```

### Commits audit (ordre chronologique)

| # | Commit | Phase | Description |
|---|--------|-------|-------------|
| 1 | `fdb6a14` | **P0.2** | State machine SSOT — parcelSync + reconciliation sécurisés |
| 2 | `88ebef0` | **P1** | 3 transitions sauvages éliminées — hub-dashboard + order-api-v2 |
| 3 | `fa4e95d` | **P2** | Flux `pending→confirmed→ordered` sécurisé + timestamps migrés |
| 4 | `1cdcd43` | **P3** | Dernière transition sauvage éliminée — parcel-api-v2 |
| 5 | `519656d` | **P4** | Dead code nettoyé + KPI hub fix + email statuses conformes |
| 6 | `5860ea3` | **S1** | Notifications crash-safe — réponse user avant side-effects |
| 7 | `c093694` | **S2** | computeOrderStatus() unifié — 1 seule source de vérité |
| 8 | `1e6d1b8` | **CT** | Onglet Commandes — vue complète cycle de vie + KPIs incidents paiement |
| 9 | `afd4eea` | **Fix** | Commandes visibles partout + fix ready-for-parcel + create-parcel Stripe |
| 10 | `945e0ad` | **Fix** | Fix auth invoices + fix scan-engine statuts invalides |

### Bugs critiques corrigés

| Bug | Avant | Après | Commit |
|-----|-------|-------|--------|
| `ready-for-parcel` ignorait les Stripe `ordered` | `WHERE status = 'confirmed'` | `IN ('confirmed','ordered')` | `afd4eea` |
| `create-parcel` refusait les commandes `ordered` | `if (status !== 'confirmed')` reject | Accepte `confirmed` + `ordered` | `afd4eea` |
| `create-parcel` transition Stripe cassée | `confirmed → ordered` échouait car déjà `ordered` | Transition conditionnelle `ordered → preparation` | `afd4eea` |
| Factures 401 systématique | Pas de middleware `authenticate` sur `/api/invoices` | `[authenticate, requireRole()]` ajouté | `945e0ad` |
| `scan-engine.js` statuts invalides | `delivered`, `processing`, `partially_delivered` (hors ENUM) | → state machine SSOT via `transitionOrderStatus()` | `945e0ad` |
| Commandes invisibles dans CT | 100% colis, 0 commandes dans Dashboard/Finances/Colis | Réf commande + KPIs + CA Stripe/Cash partout | `afd4eea` |

---

## 📋 Onglet Commandes CT — TERMINÉ ✅

- **Endpoint** `GET /api/v2/orders` avec KPIs (total, en cours, Stripe, CA KMF/EUR, incidents)
- **Vue** `CT.views.orders` : table complète, filtres, badges statut/paiement
- **Nav sidebar** "📋 Commandes" — visible en premier
- **Dashboard enrichi** : section Commandes + alertes "en attente colis"
- **Finances enrichies** : CA Stripe / Cash séparés + CA commandes global
- **Cartes colis** : réf commande `📋 CMD-xxx` affichée

---

## 🧾 Circuit Complet — TESTÉ ✅

> Test du 15 avril 2026 — Commande K85AJL4 → Colis PCL-2026-0001

### Flux complet validé

```
pending → confirmed → ordered → preparation → shipped → in_transit → available → collected
```

### Notifications — 45 envoyées, 0 échec

| Étape | WhatsApp (Twilio) | Email (Brevo) | SMS |
|-------|:-:|:-:|:-:|
| `payment_confirmed` | ✅ | ✅ | — |
| `parcel_created` | ✅ | — | — |
| `shipped` | ✅ | ✅ | ✅ |
| `in_transit` | ✅ | — | ✅ |
| `available` | ✅ | ✅ | ✅ |
| `collected` | ✅ | — | ✅ |

### Facture générée

- **KOM-INV-2026-000002** — 55 700 KMF — 4 articles — Stripe EUR — Relais Domoni ✅

### Règles notifications

- **Emails** : uniquement `confirmed`, `shipped`, `available`, `cancelled` (4 étapes clés)
- **SMS/WhatsApp** : à chaque transition
- **Crash-safe** : `res.json()` envoyé AVANT les notifications (pas de blocage client)

---

## 🌊 Plan Logistique — 3 Vagues

> **Règles absolues** :  
> **R1** — `orders.status` = modifié UNIQUEMENT via `transitionOrderStatus()` (state machine SSOT). Plus aucun UPDATE direct. ✅  
> **R2** — L'opérateur terrain : scanner → carton → sceller. Hub Interface = 3 actions, pas de décisions.  
> Voir `docs/PLAN_LOGISTIQUE_V2.md` pour le plan complet.

| Vague | Contenu | Durée | Statut |
|:-----:|---------|:-----:|:------:|
| **1** | Socle Parcel-Centric (API CRUD parcels, fix logistics.js, migration 014) + Sécurité #71-#76 | ~22h | 🟠 À démarrer |
| **2** | Hub Terrain Simplifié (routes/hub.js, auto-split, interface opérateur) | ~20h | ⬜ |
| **3** | Optimisation avancée (douane, poids/volume, multi-transporteurs, dashboard coûts) | ~54h | ⬜ |

### Violations actives à corriger — Vague 1

| ID | Fichier | Violation | Règle | Note |
|----|---------|-----------|-------|------|
| V-01 | `logistics.js` | `UPDATE orders SET status` direct → bypass state machine | R1 | ⚠️ Legacy — à migrer vers `transitionOrderStatus()` |
| V-02 | `logistics.js` | SMS batch conteneur (1 SMS/commande au lieu de 1 SMS/colis) | R1 | |
| V-03 | `scans.js` hub/receive | Pas de création automatique de parcel à la réception | R2 | |
| V-04 | `orders.js` mark-availability | Interface trop granulaire pour l'opérateur | R2 | |

---

## 🔄 Refonte Parcel-Centric — 3/5 phases

| Phase | Contenu | Statut |
|:-----:|---------|:------:|
| 1 | Fondations (tables `parcels`/`parcel_events`, utils, migration `010_parcels.sql`) | ✅ |
| 2 | Double écriture (`parcelSync.js` + `scans.js` v8.4, 4 points d'intégration) | ✅ |
| 3 | Migration trigger — désactiver `trg_scan_sync_status`, `computed_status` → `status` | ✅ |
| 4 | Nettoyage colonnes legacy (migration 014) → **Vague 1 tâche 1.4** | 🟡 |
| 5 | API CRUD parcels (`routes/parcels.js`) → **Vague 1 tâche 1.2** | ⬜ |

---

## 🔌 API Sourcing Externe — BACKLOG

> Architecture d'interfaçage avec les fournisseurs/plateformes externes pour le sourcing produits.

### Périmètre potentiel

| Fonctionnalité | Description | Priorité |
|---------------|-------------|:--------:|
| **Import catalogue** | Sync produits depuis fournisseurs (AliExpress, 1688, Alibaba, locaux Comores) | 🔴 Haute |
| **Comparaison prix** | Prix sourcing automatique vs prix vente | 🟡 Moyenne |
| **Commandes fournisseurs** | Passer des commandes automatiquement chez les fournisseurs | 🟡 Moyenne |
| **Sync stock** | Stock temps réel depuis les fournisseurs | 🟢 Basse |

### Architecture cible

```
routes/sourcing-api.js          → Endpoints CRUD fournisseurs + produits sourcés
services/sourcing-service.js    → Logique métier (import, sync, comparaison)
adapters/                       → Un adapteur par plateforme
  ├── aliexpress-adapter.js
  ├── alibaba-adapter.js
  └── local-adapter.js          → Fournisseurs locaux (API custom ou saisie manuelle)
```

### Tables à créer

```sql
suppliers           → Fournisseurs (nom, plateforme, credentials, actif)
supplier_products   → Catalogue fournisseur (ref externe, prix achat, délai, stock)
product_sourcing    → Lien produit Komerce ↔ fournisseur(s) (prix comparés, fournisseur préféré)
purchase_orders     → Bons de commande fournisseur (statut, montant, tracking)
```

### Prérequis

- [ ] Définir les fournisseurs cibles (plateformes, locaux)
- [ ] Obtenir les clés API fournisseurs
- [ ] Valider le workflow d'achat (auto vs manuel)
- [ ] Tests sandbox avant intégration prod

> ⏸️ **Statut** : En attente de définition des besoins précis. À reprendre quand les fournisseurs cibles seront identifiés.

---

## P2 ⬜ Catalogue Pièces Auto/Moto & Marque Exclusive SAV Dubai

> **Backlog post-Vague 3** (~13h)

Nouvelle verticale : catalogue structuré véhicule→marque→modèle→pièce + marque exclusive Komerce + SAV Dubai.

**Modules** : Catalogue structuré · Recherche OEM · Marque exclusive (branding/packaging/QR) · SAV Dubai (tickets/garantie/retours) · Gestion stock · Pricing dynamique KMF/EUR/AED · Dashboard pièces · Base compatibilité cross-ref

| # | Tâche | Statut |
|---|-------|:------:|
| 3.1 | Étude de marché pièces auto/moto Comores | ⬜ |
| 3.2 | Modélisation DB (parts, vehicles, cross-ref, SAV) | ⬜ |
| 3.3–3.12 | API + Frontend + Tests | ⬜ |

---

## P3 ⬜ Sécurité — 14 issues ouvertes

### 🔴 6 CRITIQUES — intégrées en **Vague 1 tâche 1.5**

| Issue | Vulnérabilité | Fichier(s) |
|:-----:|---------------|------------|
| #71 | Injection SQL | admin.js/dashboard.js/products.js/logistics.js |
| #72 | JWT secret faible | `auth.js:26` |
| #73 | Admin password reset | `admin.js` |
| #74 | CORS trop permissif | `server.js:66` |
| #75 | Rate limiting admin | `server.js` |
| #76 | POST /admin/reset en prod | `admin.js` |

### 🟠 8 MAJEURES

| Issue | Vulnérabilité |
|:-----:|---------------|
| #77 | Transactions DB manquantes |
| #78 | Gestion d'erreurs inconsistante |
| #79 | Pagination absente |
| #80 | Architecture monolithique (god files ~60KB) |
| #81 | Rate limiting incomplet |
| #82 | Logging absent |
| #83 | Tests absents |
| #84 | Pool PostgreSQL |

---

## P4 ⬜ Go-Live

| # | Élément | Statut |
|---|---------|:------:|
| 6.1 | Tests E2E 19/19 | ✅ |
| 6.2 | Dashboards données réalistes | ✅ |
| 6.3 | Audit comptable Phase 4 | ⬜ |
| 6.4 | Reset factory Prod | ⬜ |
| 6.5 | Mot de passe admin changé | ⬜ |
| 6.6 | JWT_SECRET unique Prod | ⬜ |
| 6.7 | HTTPS | ✅ Railway |
| 6.8 | Domaine boutique.komerce.km | ⬜ |
| 6.9 | Monitoring/logs | ⬜ |
| 6.10 | Backup DB pg_dump quotidien | ⬜ |

---

## 📚 Documentation — À METTRE À JOUR

> Les 27 fichiers `docs/` sont figés au 7 avril 2026. Mise à jour complète nécessaire.

| Document | Problème principal | Priorité |
|----------|-------------------|:--------:|
| `README.md` | Réf. Africa's Talking/Mailjet (→ Brevo), "20 produits" (→ 250+), API v12 | 🔴 |
| `SPEC-ORDER-PARCEL-LIFECYCLE.md` | Manque statut `pending`, réf. fichiers inexistants | 🔴 |
| `TOUR-DE-CONTROLE-DASHBOARDS.md` | Réf. anciens HTML — CT v7 absente | 🟠 |
| `CARTOGRAPHY_360.md` | 81 KB probablement obsolète | 🟡 |
| `audit/*` (11 fichiers) | Pré-state machine — historique utile mais périmé | 🟡 |

---

## P1 ✅ Dashboard Pilotage Unifié — TERMINÉ

Cockpit unique React TSX + DaisyUI + Recharts. 5 vues (Ops, Finance, Pilotage, Tendances, Retards) connectées aux 8 endpoints dashboard unifié v11. **11/11 tâches ✅**.

---

## P6 ✅ Gouvernance Opérationnelle — 5/5 phases

> [Plan détaillé](./komerce-point6-gouvernance-operationnelle.md) · Moteur `business_rules` variabilisant 47 constantes hardcodées

| Phase | Contenu | Statut |
|:-----:|---------|:------:|
| 1–5 | Fondations → Migration → Annulations → Expédition partielle → Dashboard Config | ✅ |

---

## Ordre de travail

```
✅ Dashboard Pilotage 11/11
✅ Gouvernance Phases 1-5
✅ Parcel-Centric Phases 1-3
✅ Audit Backend State Machine (10 commits — SSOT 100%)
✅ Onglet Commandes CT (vue complète cycle de vie)
✅ Circuit complet testé (facture + 45 notifs + WhatsApp)
✅ Fix ready-for-parcel + create-parcel Stripe
✅ Fix auth invoices + scan-engine statuts invalides

🟠 VAGUE 1 (~22h) — À démarrer :
  ① Clore PR #116 + numérotation migrations
  ② routes/parcels.js (API CRUD)
  ③ Fix logistics.js (violation R1 — dernière UPDATE directe)
  ④ migration 014 (cleanup legacy + index)
  ⑤ Sécurité #71-#76 (6 critiques)
  ⑥ Validators parcels

⬜ VAGUE 2 (~20h) :
  routes/hub.js + auto-split + interface terrain Hub V2

⬜ VAGUE 3 (~54h) :
  Douane + poids/volume + multi-transporteurs + dashboard coûts + SLA parcel-level

⬜ API SOURCING EXTERNE : Architecture à définir (fournisseurs, adapteurs, workflow)
⬜ DOCUMENTATION : Mise à jour 27 fichiers docs/ (figés au 7 avril)
⬜ BACKLOG : Catalogue Auto/Moto (12 tâches ~13h)
⬜ Fix 8 MAJEURES #77→#84 + coûts réels #48
⬜ Go-Live (audit, reset, checklist)
⬜ Améliorations long terme (tests, CI/CD, monitoring, cache)
```

---

<details><summary>📜 Historique complété</summary>

### 15/04/2026
🛡️ Audit Backend complet (10 commits) : state machine SSOT 100%, 5 transitions sauvages éliminées, computeOrderStatus() unifié, notifications crash-safe ✅ · 📋 Onglet Commandes CT : endpoint `/api/v2/orders` + vue complète cycle de vie + KPIs incidents paiement ✅ · 📦 Commandes visibles partout (Dashboard, Finances, Colis, Réconciliation) ✅ · 🔧 Fix ready-for-parcel + create-parcel pour commandes Stripe `ordered` ✅ · 🔧 Fix auth invoices (middleware `authenticate` manquant) ✅ · 🔧 Fix scan-engine.js statuts invalides (`delivered`, `processing` → state machine) ✅ · 🧾 Circuit complet testé K85AJL4 → PCL-2026-0001 : 45 notifications (WhatsApp+Email+SMS), 0 échec ✅ · Facture KOM-INV-2026-000002 générée ✅

### 07/04/2026
Plan Logistique V2.0 fusionné ✅ · 10 incohérences levées ✅ · PR #116 ouverte (docs archi logistique) · PR #113 Phase 3 Migration trigger ✅ mergée · PR #105 cancel+remboursement ✅ · PR #106 migration 47 constantes ✅ · PR #107 fix railway.toml ✅ · PR #108 fix sms.js ✅ · PR #109 alignement docs 🔄 · Phase 4 expédition partielle ✅

### 06/04/2026
Connexion GitHub ✅ · Audit deep carto ✅ · Carto v12 PR #90 ✅ · Dashboard Unifié v11 PR #91 ✅ · Doc archi PR #92 ✅ · Audit report PR #90 ✅ · Dashboard Pilotage Instant App ✅ · Tendances+Retards PR #97 ✅ · API réelle PR #97 ✅ · Tests 46 checks PR #97 ✅ · Dépréciation 4 dashboards PR #98 ✅ · **P1 TERMINÉE 🎉**

### Antérieur
Boutique Live 5/5 ✅ · Sprint UX A→D ✅ · Hotfix BUG-018 12 bugs ✅ · Phase 7 14/14 bugs ✅ · Tests E2E Phases 1-3 ✅ · Sécurité 58 corrigés ✅ · Validation Joi 31 schémas ✅ · Upload Multer ✅ · Email Nodemailer ✅ · CI/CD Railway ✅

</details>

---

> 🔒 Seule roadmap de référence. Mettre à jour après chaque session.
