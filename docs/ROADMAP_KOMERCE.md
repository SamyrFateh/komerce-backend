# ROADMAP KOMERCE v16.2

> 📅 7 avril 2026 · 18 routes · ~127 endpoints · 31+ tables

---

## Progression

| Domaine | Statut |
|---------|--------|
| Dashboard Pilotage Unifié | ✅ 11/11 |
| Gouvernance Opérationnelle | ✅ 5/5 phases |
| Boutique Live | ✅ 5/5 |
| Sprint UX A→D | ✅ 4/4 |
| Bugs Phase 7 | ✅ 14/14 |
| Tests E2E | ✅ Phases 1-3+7 · ⬜ Phases 4-6 |
| Sécurité audit initial | ✅ ~58 corrigés |
| Sécurité audit deep | ⬜ 14 issues ouvertes |
| Catalogue Pièces Auto/Moto | ⬜ Nouveau |
| Cartographie 360° v12 | ✅ |
| Coffre-fort (Vault) | ✅ 6/6 |
| Refonte Parcel-Centric | 🔄 3/5 phases |
| **Architecture Logistique Avancée** | ⬜ 0/6 phases |

---

## P1 ✅ Dashboard Pilotage Unifié — TERMINÉ

Cockpit unique React TSX + DaisyUI + Recharts. 5 vues (Ops, Finance, Pilotage, Tendances, Retards) connectées aux 8 endpoints dashboard unifié v11. **11/11 tâches ✅**.

---

## 🔄 Refonte Parcel-Centric — 3/5 phases

> Migration architecture order-centric → parcel-centric. Double écriture, migration trigger, nettoyage.

| Phase | Contenu | Statut |
|:-----:|---------|:------:|
| 1 | Fondations (tables `parcels`/`parcel_events`, utils, migration `010_parcels.sql`) | ✅ |
| 2 | Double écriture (`parcelSync.js` + `scans.js` v8.4, 4 points d'intégration) | ✅ |
| 3 | Migration trigger — désactiver `trg_scan_sync_status`, `computed_status` → `status` | ✅ |
| 4 | Nettoyage colonnes legacy | 🟡 |
| 5 | API CRUD parcels | ⬜ |

---

## 🧠 Architecture Logistique Avancée — 0/6 phases

> Intégration de la vision logistique terrain : hub simplifié, multi-transporteurs,
> optimisation douanière, résilience à l'incertitude.
>
> **Pré-requis** : Phases 4-5 Parcel-Centric terminées + Fix sécurité CRITIQUES.
> **Référence** : [Analyse complète](./_work/CHALLENGE_SYNTHESE_ARCHITECTURE.md)

| Phase | Contenu | Effort | Statut |
|:-----:|---------|:------:|:------:|
| A | **Hub terrain** — `routes/hub.js`, endpoints `scan-item`, `seal-parcel`, `open-parcels`, workflow opérateur simplifié (scanner article → carton → avancer) | 20h | ⬜ |
| B | **Multi-transporteurs** — ETA par colis, assignment transporteur par parcel, enrichissement endpoints shipments | 10h | ⬜ |
| C | **Moteur d'optimisation colis** — `utils/parcelOptimizer.js`, bin-packing valeur/poids/volume, colonnes `weight_g`/`volume_cm3` sur products | 19h | ⬜ |
| D | **Stratégie douanière** — stratégie `optimize_customs` dans registre `STRATEGIES{}`, business_rules `PARCEL_MAX_VALUE_KMF`/`PARCEL_MAX_WEIGHT_KG`, colis homogènes/équilibrés | 10h | ⬜ |
| E | **Résilience terrain** — SLA par colis, `customs_cleared_at` sur parcels, taxation variable par colis, alertes incertitude | 6h | ⬜ |
| F | **Frontend hub mobile** — interface opérateur simplifiée (scan → carton → avancer), dashboard colis temps réel | 20h | ⬜ |

### Principes directeurs (issus de la synthèse)

- **Commande = intention commerciale** · **Colis = réalité logistique** · **Scan = action terrain**
- Le hub ne prépare pas des commandes, il prépare des colis à partir du disponible
- INTERDICTION de `UPDATE orders.status` direct → toujours via `computeOrderStatus()`
- Le hub ne doit jamais attendre : prendre ce qui est disponible → remplir → expédier
- Système résilient à l'incertitude (bateaux, douane, délais)

### ⚠️ Actions de dépréciation (pendant Vague 2)

- [ ] Ajouter guard + log d'alerte sur `PATCH /api/orders/:id/status` (admin-only)
- [ ] Migrer tous les appels clients vers des actions sur parcels
- [ ] Supprimer endpoint après confirmation zéro usage

---

## P2 ⬜ Catalogue Pièces Auto/Moto & Marque Exclusive SAV Dubai

Nouvelle verticale : catalogue structuré véhicule→marque→modèle→pièce + marque exclusive Komerce + SAV Dubai.

**Modules** : Catalogue structuré · Recherche OEM · Marque exclusive (branding/packaging/QR) · SAV Dubai (tickets/garantie/retours) · Gestion stock · Pricing dynamique KMF/EUR/AED · Dashboard pièces · Base compatibilité cross-ref

**Tables** : `parts`, `vehicles`, `vehicle_parts`, `brands`, `sav_tickets`, `warranties`
**Routes** : `/api/parts`, `/api/vehicles`, `/api/sav`, `/api/brands`

**Marque exclusive** : qualité premium, garantie 6 mois min, SAV WhatsApp/email, retour gratuit 30j, sourcing Dubai (Sharjah/Deira) + Chine (Guangzhou), packaging brandé QR

| # | Tâche | Statut |
|---|-------|:------:|
| 3.1 | Étude de marché pièces auto/moto Comores | ⬜ |
| 3.2 | Modélisation DB (parts, vehicles, cross-ref, SAV) | ⬜ |
| 3.3 | Analyse Cartographie 360° (impact existant) | ⬜ |
| 3.4 | Analyse Coffre-Fort Sécurité (risques) | ⬜ |
| 3.5 | API CRUD pièces + recherche + compatibilité | ⬜ |
| 3.6 | API marque exclusive | ⬜ |
| 3.7 | API SAV (tickets, garanties, retours) | ⬜ |
| 3.8 | Frontend catalogue (nav véhicule→pièce) | ⬜ |
| 3.9 | Frontend espace marque exclusive | ⬜ |
| 3.10 | Intégration Dashboard Pilotage | ⬜ |
| 3.11 | Workflow SAV Dubai (emails, suivi, escalade) | ⬜ |
| 3.12 | Tests & validation | ⬜ |

---

## P3 ⬜ Sécurité — 14 issues ouvertes

### 🔴 6 CRITIQUES

| Issue | Vulnérabilité | Fichier(s) | Fix |
|:-----:|---------------|------------|-----|
| #71 | Injection SQL | orders/admin/dashboard/products/logistics.js | Requêtes paramétrées `$1,$2` |
| #72 | Secrets en dur | server.js (JWT fallback) | Crash si manquant |
| #73 | Validation absente | payments/orders/admin.js | Middleware `validate(Joi)` |
| #74 | Mots de passe faibles | auth.js | bcrypt 12+, min 8 chars |
| #75 | Données sensibles exposées | auth/admin.js | `sanitizeUser()`, pas de `SELECT *` |
| #76 | Webhook Stripe non vérifié | payments.js | `stripe.webhooks.constructEvent()` |

### 🟠 8 MAJEURES

| Issue | Vulnérabilité | Fix |
|:-----:|---------------|-----|
| #77 | Transactions DB manquantes | `BEGIN/COMMIT/ROLLBACK` |
| #78 | Gestion d'erreurs inconsistante | Middleware erreur global |
| #79 | Pagination absente | `LIMIT/OFFSET` partout |
| #80 | Architecture monolithique | routes→services→repositories |
| #81 | Rate limiting incomplet | login, register, OTP, webhook |
| #82 | Logging absent | Winston/Pino, JSON en prod |
| #83 | Tests absents | Jest+Supertest, couverture 80% |
| #84 | Pool PostgreSQL | max:20, idle timeout, graceful |

---

## P4 ⬜ Go-Live

**Tests E2E restants** : Phase 4 (audit comptable 8 checks SQL) · Phase 5 (reset/re-seed) · Phase 6 (checklist)

**⚠️ BLOQUANT #48** : Saisir `cost_real_kmf`, `transport_kmf`, `douane_kmf` sur commandes collected/shipped

**Checklist** :
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

## P5 ⬜ UX avant marketing (~11h)

| # | Feature | Effort |
|---|---------|:------:|
| E1 | Filtrage par catégorie | 2h |
| E2 | Recherche par nom | 1h |
| E3 | Responsive mobile | 3h |
| E4 | Page produit détaillée (modal) | 4h |
| E5 | Stock temps réel (badge rupture) | 1h |

---

## P6 ✅ Gouvernance Opérationnelle — 5/5 phases

> [Plan détaillé](./komerce-point6-gouvernance-operationnelle.md) · Moteur `business_rules` variabilisant 47 constantes hardcodées

| Phase | Contenu | Statut |
|:-----:|---------|:------:|
| 1 | Fondations (migration DB + rules.js + API config) | ✅ |
| 2 | Migration 47 constantes → `getRule()` | ✅ |
| 3 | Annulation + Remboursement (Stripe/crédit) — PR #105 | ✅ |
| 4 | Expédition partielle Hub Dubai (sous-commandes) | ✅ |
| 5 | Dashboard Configuration ⚙️ (5.1 Config ✅, 5.2 Indicateurs annulations/parcels 🔄 PR #115) | 🔄 |

**Endpoints ajoutés** : `POST /cancel` · `GET /credits` · `POST /mark-availability` · `POST /partial-ship` · `GET /sub-orders` · `PATCH /sub-orders/:subId/status` · `POST /cancel-backorder`

---

## P7 ⬜ Améliorations futures

Architecture couches · Tests Jest · CI/CD GitHub Actions · Monitoring Sentry · Backup PostgreSQL · Doc Swagger · Cache Redis · Load testing k6

---

## Nice to have (~15h)

Avis produits (6h) · Wishlist (2h) · Partage produit (1h) · Mode sombre (2h) · PWA (4h)

---

## Issues ouvertes (15)

#71-#76 🔴 CRITIQUES (sécurité) · #77-#84 🟠 MAJEURES · #48 💰 BLOQUANT (coûts réels)

**PRs ouvertes** : 1 (PR #115 Phase 5.2 annulations-parcels)

---

## Ordre de travail

```
✅ Dashboard Pilotage 11/11
✅ Gouvernance Phases 1-4
✅ Parcel-Centric Phases 1-3 (Fondations + Double écriture + Migration trigger)
🟡 Parcel-Centric Phase 4 — Nettoyage colonnes legacy
⬜ Parcel-Centric Phase 5 — API CRUD parcels
⬜ Fix 6 CRITIQUES #71→#76
⬜ Fix 8 MAJEURES #77→#84 + coûts réels #48
⬜ Architecture Logistique Phase A — Hub terrain simplifié
⬜ Architecture Logistique Phase B — Multi-transporteurs
⬜ Architecture Logistique Phase C — Moteur optimisation colis
⬜ Architecture Logistique Phase D — Stratégie douanière
⬜ Architecture Logistique Phase E — Résilience terrain
⬜ Catalogue Pièces Auto/Moto (12 tâches)
🔄 Gouvernance Phase 5 — Dashboard Config (5.1 ✅, 5.2 🔄 PR #115)
⬜ Go-Live (audit, reset, checklist)
⬜ Architecture Logistique Phase F — Frontend hub mobile
⬜ UX E1→E5
⬜ Améliorations long terme
```

---

<details><summary>📜 Historique complété</summary>

### 07/04/2026
PR #116 Analyse synthèse architecture logistique + ROADMAP v16.2 · PR #113 Phase 3 Migration trigger ✅ mergée · PR #105 cancel+remboursement ✅ · PR #106 migration 47 constantes ✅ · PR #107 fix railway.toml ✅ · PR #108 fix sms.js ✅ · PR #109 alignement docs 🔄 · Phase 4 expédition partielle ✅

### 06/04/2026
Connexion GitHub ✅ · Audit deep carto ✅ · Carto v12 PR #90 ✅ · Dashboard Unifié v11 PR #91 ✅ · Doc archi PR #92 ✅ · Audit report PR #90 ✅ · Dashboard Pilotage Instant App ✅ · Tendances+Retards PR #97 ✅ · API réelle PR #97 ✅ · Tests 46 checks PR #97 ✅ · Dépréciation 4 dashboards PR #98 ✅ · **P1 TERMINÉE 🎉**

### Antérieur
Boutique Live 5/5 ✅ · Sprint UX A→D ✅ · Hotfix BUG-018 12 bugs ✅ · Phase 7 14/14 bugs ✅ · Tests E2E Phases 1-3 ✅ · Sécurité 58 corrigés ✅ · Validation Joi 31 schémas ✅ · Upload Multer ✅ · Email Nodemailer ✅ · CI/CD Railway ✅

</details>

---

> 🔒 Seule roadmap de référence. Mettre à jour après chaque session.
