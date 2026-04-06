# 🗺️ ROADMAP KOMERCE — Référence Unique

> 📅 **Mise à jour** : 7 avril 2026  
> 🏷️ **Version** : v15.4  
> 🔗 **Repo** : `SamyrFateh/komerce-backend` · branche `main`  
> 📊 **18 fichiers route** · **~122 endpoints** · **29+ tables**

---

## 📑 Table des matières

1. [Progression globale](#1--progression-globale)
2. [🟣 Priorité 1 — Dashboard de Pilotage Unifié](#2--priorité-1--dashboard-de-pilotage-unifié)
3. [🟠 Priorité 2 — Catalogue Pièces Auto/Moto & Marque Exclusive SAV Dubai](#3--priorité-2--catalogue-pièces-automoto--marque-exclusive-sav-dubai)
4. [🔴 Priorité 3 — Sécurité](#4--priorité-3--sécurité)
5. [🔴 Priorité 4 — Go-Live](#5--priorité-4--go-live)
6. [🟡 Priorité 5 — UX avant lancement marketing](#6--priorité-5--ux-avant-lancement-marketing)
7. [🔶 Priorité 6 — Gouvernance Opérationnelle Komerce](#7--priorité-6--règles-opérationnelles-commandes)
8. [🟢 Priorité 7 — Améliorations futures](#8--priorité-7--améliorations-futures)
9. [🔵 Nice to have](#9--nice-to-have)
10. [PRs & Issues ouvertes](#10--prs--issues-ouvertes)
11. [✅ Historique complété](#11--historique-complété)
12. [Ordre de travail recommandé](#12--ordre-de-travail-recommandé)

---

## 1. 📊 Progression globale

| Domaine | Progression | Restant |
|---------|:-----------:|:-------:|
| Boutique Live (5 étapes) | ✅ 5/5 | — |
| Sprint UX (A→D) | ✅ 4/4 sprints | Features E1→E5 |
| Corrections bugs (Phase 7) | ✅ 14/14 bugs | — |
| Tests E2E (7 phases) | ✅ Phases 1-3 + 7 | Phases 4-6 |
| Sécurité audit initial | ✅ ~58 problèmes corrigés | — |
| Sécurité audit deep | ⬜ 14 issues ouvertes | 6 critiques + 8 majeures |
| Dashboard unifié v11 | ✅ Mergé | Remplacé par Dashboard Pilotage |
| **Dashboard Pilotage Unifié** | ✅ 11/11 | **TERMINÉ 🎉** |
| **Catalogue Pièces Auto/Moto** | ⬜ Nouveau | **PRIORITÉ 2** |
| **Gouvernance Opérationnelle** | 🔄 3/5 phases — [Plan détaillé](./komerce-point6-gouvernance-operationnelle.md) | **PRIORITÉ 6 · Phase 4 suivante** |
| Cartographie 360° v12 | ✅ Poussée | — |
| Coffre-fort (Vault) | ✅ 6/6 fichiers | — |

---

## 2. 🟣 Priorité 1 — Dashboard de Pilotage Unifié

> 🎯 **Ce dashboard REMPLACE TOUS les dashboards existants.** C'est le cockpit unique pour piloter Komerce.

**Concept** : Application web interactive unique connectée aux 8 endpoints du dashboard unifié v11, regroupant toutes les vues en un seul point d'entrée.

### 5 Vues du Dashboard

| Vue | Endpoint(s) | Fonctionnalités |
|-----|-------------|-----------------|
| 📦 **Ops** | `/ops` + `/pipeline` | Kanban pipeline, SLA tracker, alertes temps réel |
| 💰 **Finance** | `/finance` | CA EUR/KMF, marges, top produits, paiements |
| 🎯 **Pilotage** | `/pilotage` + `/clients` | Coûts par catégorie, meilleurs clients, taux de change |
| 📈 **Tendances** | `/history` + `/forecast` | Graphiques mensuels, projections 30j |
| 🚨 **Retards** | `/retards` | Liste clients en retard, compensations, actions SMS |

### Spécifications

- **Stack** : React TSX + DaisyUI + Recharts
- **Pré-requis** : Dashboard unifié mergé ✅ · URL API Railway · Carto à jour ✅
- **Objectif** : Remplacer tous les dashboards séparés par un cockpit unique

### Tâches

| # | Tâche | Statut |
|---|-------|:------:|
| 2.1 | Analyse Cartographie 360° (fichiers/endpoints impactés) | ✅ |
| 2.2 | Analyse Coffre-Fort Sécurité (risques liés) | ✅ |
| 2.3 | Scaffolding Instant App (structure + routing) | ✅ |
| 2.4 | Vue Ops (Kanban + pipeline) | ✅ |
| 2.5 | Vue Finance (CA, marges, top produits) | ✅ |
| 2.6 | Vue Pilotage (coûts, clients, taux de change) | ✅ |
| 2.7 | Vue Tendances (graphiques + projections) | ✅ |
| 2.8 | Vue Retards (liste + actions SMS) | ✅ |
| 2.9 | Branchement API réelle (remplacer mock data) | ✅ |
| 2.10 | Tests & validation | ✅ |
| 2.11 | Dépréciation des anciens dashboards | ✅ |

---

## 3. 🟠 Priorité 2 — Catalogue Pièces Auto/Moto & Marque Exclusive SAV Dubai

> 🚗🏍️ **Nouveau service de vente de pièces automobiles et moto**, avec possibilité de proposer une **marque exclusive** accompagnée de son **SAV basé à Dubai**.

### 3.1 Vision

Komerce devient une plateforme multi-verticale : au-delà du commerce général, elle propose un **catalogue spécialisé pièces auto/moto** avec :
- Un catalogue structuré par **véhicule / marque / catégorie de pièce**
- La possibilité de créer et gérer une **marque exclusive Komerce** (private label)
- Un **SAV professionnel** opéré depuis Dubai (garantie, retours, support technique)
- Un sourcing direct depuis les fournisseurs Dubai/Chine avec traçabilité complète

### 3.2 Fonctionnalités clés

| Module | Description | Priorité |
|--------|-------------|:--------:|
| 🗂️ **Catalogue structuré** | Navigation par véhicule → marque → modèle → année → catégorie pièce | Haute |
| 🔍 **Recherche intelligente** | Recherche par référence OEM, nom de pièce, compatibilité véhicule | Haute |
| 🏷️ **Marque exclusive** | Espace dédié "marque Komerce" avec branding, packaging, certifications | Haute |
| 🛡️ **SAV Dubai** | Système de tickets SAV, suivi garantie, procédure retour depuis les Comores | Haute |
| 📦 **Gestion stock** | Stock par référence, alertes rupture, réapprovisionnement auto | Moyenne |
| 💰 **Pricing dynamique** | Prix par devise (KMF/EUR/AED), marges par catégorie, promotions | Moyenne |
| 📊 **Dashboard pièces** | Vue dédiée dans le Dashboard Pilotage (CA pièces, top références, SAV) | Moyenne |
| 🔗 **Compatibilité** | Base de données compatibilité pièce ↔ véhicules (cross-reference) | Haute |

### 3.3 Architecture technique (à définir)

| Composant | Description |
|-----------|-------------|
| **Tables DB** | `parts`, `vehicles`, `vehicle_parts` (cross-ref), `brands`, `sav_tickets`, `warranties` |
| **Routes API** | `/api/parts`, `/api/vehicles`, `/api/sav`, `/api/brands` |
| **Frontend** | Nouveau module catalogue dans la boutique + section marque exclusive |
| **SAV** | Système de tickets intégré + emails automatiques + suivi garantie |
| **Intégration Dashboard** | Nouvelle vue "🔧 Pièces Auto/Moto" dans le Dashboard Pilotage |

### 3.4 Tâches

| # | Tâche | Statut |
|---|-------|:------:|
| 3.1 | Étude de marché pièces auto/moto aux Comores (demande, concurrence) | ⬜ |
| 3.2 | Modélisation DB : tables parts, vehicles, cross-reference, SAV | ⬜ |
| 3.3 | Analyse Cartographie 360° (impact sur l'existant) | ⬜ |
| 3.4 | Analyse Coffre-Fort Sécurité (risques nouveau service) | ⬜ |
| 3.5 | API CRUD pièces + recherche + compatibilité véhicule | ⬜ |
| 3.6 | API gestion marque exclusive (branding, catalogue dédié) | ⬜ |
| 3.7 | API SAV (tickets, garanties, retours) | ⬜ |
| 3.8 | Frontend catalogue pièces (navigation véhicule → pièce) | ⬜ |
| 3.9 | Frontend espace marque exclusive | ⬜ |
| 3.10 | Intégration Dashboard Pilotage (vue Pièces Auto/Moto) | ⬜ |
| 3.11 | Workflow SAV Dubai (emails, suivi, escalade) | ⬜ |
| 3.12 | Tests & validation | ⬜ |

### 3.5 Marque Exclusive — Points clés

- **Nom & branding** : à définir (marque Komerce ou sous-marque dédiée)
- **Positionnement** : qualité premium, garantie SAV Dubai, prix compétitifs
- **SAV** : garantie minimum 6 mois, support technique via WhatsApp/email, retour gratuit sous 30j
- **Sourcing** : fournisseurs certifiés Dubai (Sharjah/Deira auto parts district) + Chine (Guangzhou)
- **Packaging** : packaging brandé avec QR code traçabilité

---

## 4. 🔴 Priorité 3 — Sécurité (14 issues ouvertes)

### 4.1 🚨 6 Vulnérabilités CRITIQUES

| Issue | Vulnérabilité | Fichier(s) | Fix |
|:-----:|---------------|------------|-----|
| [#71](https://github.com/SamyrFateh/komerce-backend/issues/71) | **Injection SQL** | orders.js, admin.js, dashboard.js, products.js, logistics.js | Paramétrer toutes les requêtes `$1, $2...` |
| [#72](https://github.com/SamyrFateh/komerce-backend/issues/72) | **Secrets en dur** | server.js (JWT_SECRET fallback) | Supprimer fallbacks, crash si manquant |
| [#73](https://github.com/SamyrFateh/komerce-backend/issues/73) | **Validation absente** | payments.js, orders.js, admin.js | Appliquer middleware `validate(Joi)` partout |
| [#74](https://github.com/SamyrFateh/komerce-backend/issues/74) | **Mots de passe faibles** | auth.js | bcrypt rounds 12+, complexité min 8 chars |
| [#75](https://github.com/SamyrFateh/komerce-backend/issues/75) | **Données sensibles exposées** | auth.js, admin.js | Remplacer `SELECT *`, créer `sanitizeUser()` |
| [#76](https://github.com/SamyrFateh/komerce-backend/issues/76) | **Webhook Stripe non vérifié** | payments.js | `stripe.webhooks.constructEvent()` + signature |

### 4.2 🟠 8 Vulnérabilités MAJEURES

| Issue | Vulnérabilité | Fix |
|:-----:|---------------|-----|
| [#77](https://github.com/SamyrFateh/komerce-backend/issues/77) | Transactions DB manquantes | `BEGIN/COMMIT/ROLLBACK` sur opérations multi-tables |
| [#78](https://github.com/SamyrFateh/komerce-backend/issues/78) | Gestion d'erreurs inconsistante | Middleware d'erreur global + format JSON uniforme |
| [#79](https://github.com/SamyrFateh/komerce-backend/issues/79) | Pagination absente | `LIMIT/OFFSET` sur tous les endpoints de liste |
| [#80](https://github.com/SamyrFateh/komerce-backend/issues/80) | Architecture monolithique | Séparer routes → services → repositories |
| [#81](https://github.com/SamyrFateh/komerce-backend/issues/81) | Rate limiting incomplet | Étendre à login, register, OTP, webhook |
| [#82](https://github.com/SamyrFateh/komerce-backend/issues/82) | Logging absent | Adopter Winston ou Pino, logs JSON en prod |
| [#83](https://github.com/SamyrFateh/komerce-backend/issues/83) | Tests absents | Jest + Supertest, couverture min 80% |
| [#84](https://github.com/SamyrFateh/komerce-backend/issues/84) | Pool PostgreSQL non optimisé | `max: 20`, idle timeout, graceful shutdown |

**Livrables** : 1 PR par issue ou groupées par priorité.

---

## 5. 🔴 Priorité 4 — Go-Live

### 5.1 Tests E2E restants

| Phase | Description | Statut |
|-------|-------------|--------|
| ~~Phase 1~~ | Tests API (19/19 passent) | ✅ |
| ~~Phase 2~~ | Seed données historiques (28 commandes) | ✅ |
| ~~Phase 3~~ | Validation 6 dashboards (CA 6.6M KMF) | ✅ |
| **Phase 4** | Audit comptable croisé (8 vérifications SQL) | ⬜ |
| **Phase 5** | Reset & cleanup (factory reset, re-seed) | ⬜ |
| **Phase 6** | Checklist Go-Live (voir ci-dessous) | ⬜ |
| ~~Phase 7~~ | 14 bugs corrigés (7A/7B/7C) | ✅ |

### 5.2 Saisie des coûts réels ([#48](https://github.com/SamyrFateh/komerce-backend/issues/48))

> ⚠️ **BLOQUANT** pour le calcul des marges nettes sur le dashboard Pilotage.

- [ ] Renseigner `cost_real_kmf` sur commandes `collected`/`shipped`
- [ ] Renseigner `transport_kmf` (5K–18K KMF selon poids)
- [ ] Renseigner `douane_kmf` (~20-42% valeur AED)
- [ ] Vérifier cohérence sur dashboard Pilotage

### 5.3 Checklist Go-Live

| # | Élément | Statut |
|---|---------|--------|
| 6.1 | Tests E2E passent (19/19) | ✅ |
| 6.2 | Dashboards affichent données réalistes | ✅ |
| 6.3 | Audit comptable validé (Phase 4) | ⬜ |
| 6.4 | Reset factory exécuté en Prod | ⬜ |
| 6.5 | Mot de passe admin changé | ⬜ |
| 6.6 | JWT_SECRET unique en Prod | ⬜ |
| 6.7 | HTTPS activé | ✅ (Railway natif) |
| 6.8 | Domaine configuré (boutique.komerce.km) | ⬜ |
| 6.9 | Monitoring / logs activés | ⬜ |
| 6.10 | Backup DB programmé (pg_dump quotidien) | ⬜ |

### 5.4 Nettoyage PRs obsolètes — ✅ FAIT

| PR | Action | Statut |
|---|---|---|
| **#88** — Dashboard Hub Dubai split | Fermée (supersédée par #89 mergée) | ✅ Done 06/04 |
| **#63** — README + Fix Hub Dubai | Fermée (supersédée par #64 mergée) | ✅ Done 06/04 |
| **#92** — DASHBOARD_REDESIGN.md | Mergée | ✅ Done 06/04 |
| **#44** — Polish palette sage | Fermée (supersédée par PR #45 mergée) | ✅ Done 06/04 |
| **#38** — Searchbar vers catalogue | Fermée (supersédée par PR #39 mergée) | ✅ Done 06/04 |

---

## 6. 🟡 Priorité 5 — UX avant lancement marketing (~11h)

| # | Feature | Effort | Statut |
|---|---------|:------:|:------:|
| E1 | Filtrage produits par catégorie | 2h | ⬜ |
| E2 | Recherche produits par nom | 1h | ⬜ |
| E3 | Responsive mobile (iPhone SE / Galaxy A) | 3h | ⬜ |
| E4 | Page produit détaillée (modal) | 4h | ⬜ |
| E5 | Stock en temps réel (badge rupture) | 1h | ⬜ |

### PRs UX — ✅ Toutes traitées

> Les PRs #44 et #38 étaient supersédées par #45 et #39 (déjà mergées). Fermées le 06/04.

---

## 7. 🔶 Priorité 6 — Gouvernance Opérationnelle Komerce

> 📖 **Document détaillé** : [`docs/komerce-point6-gouvernance-operationnelle.md`](./komerce-point6-gouvernance-operationnelle.md)  
> 🎯 **Philosophie** : _"Tout paramètre métier doit vivre en base, jamais dans le code. Le terrain ajuste, le code obéit."_

### Vision

Un **moteur de règles centralisé** (`business_rules`) qui variabilise les **47 constantes** aujourd'hui hardcodées dans 12 fichiers. Plus les nouveaux flux d'**annulation**, d'**expédition partielle** et de **remboursement**.

### 5 Phases d'implémentation — 34h total

| Phase | Contenu | Effort | Livrable | Statut |
|:-----:|---------|:------:|----------|---------|
| **1** | Fondations (migration DB + moteur rules.js + API config) | 6h | Infrastructure zéro risque | ✅ Mergée |
| **2** | Migration des 47 constantes → `getRule()` | 8h | Tout variabilisable, même comportement | ✅ Mergée |
| **3** | Annulation + Remboursement (Stripe/crédit boutique) | 8h | Nouveau flux client | ✅ PR #105 mergée |
| **4** | Expédition partielle Hub Dubai (sous-commandes) | 6h | Logistique avancée | ⬜ |
| **5** | Dashboard Configuration (vue admin ⚙️) | 6h | Cockpit complet | ⬜ |

### Tâches

| # | Tâche | Phase | Statut |
|---|-------|:-----:|:------:|
| 7.1 | Migration DB `007_business_rules.sql` (6 tables) | 1 | ✅ |
| 7.2 | Moteur `utils/rules.js` (cache TTL + fallback) | 1 | ✅ |
| 7.3 | API admin `routes/config.js` (5 endpoints CRUD) | 1 | ✅ |
| 7.4 | Migration 47 constantes → `getRule()` dans 9 fichiers | 2 | ✅ |
| 7.5 | `POST /api/orders/:id/cancel` + logique remboursement | 3 | ✅ PR #105 |
| 7.6 | Système crédit boutique (`store_credits`) | 3 | ✅ PR #105 |
| 7.7 | Logique sous-commandes + expédition partielle | 4 | ⬜ |
| 7.8 | Vue ⚙️ Configuration dashboard + indicateurs | 5 | ⬜ |

### Nouveaux endpoints Phase 3 (PR #105) ✅

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /api/orders/:id/cancel` | client / admin | Annuler une commande avec remboursement automatique |
| `GET /api/orders/credits` | client / admin | Consulter crédits boutique disponibles |

---
## 8. 🟢 Priorité 7 — Améliorations futures

| # | Amélioration | Impact | Priorité |
|---|-------------|--------|:--------:|
| 5.1 | Architecture en couches (routes → services → repos) | Maintenabilité | Haute |
| 5.2 | Tests automatisés (Jest + Supertest) | Fiabilité | Haute |
| 5.3 | CI/CD pipeline (GitHub Actions) | Déploiement | Haute |
| 5.4 | Monitoring + alertes (Sentry / APM) | Opérations | Haute |
| 5.5 | Backup auto PostgreSQL | Fiabilité | Haute |
| 5.6 | Documentation API (Swagger/OpenAPI) | DX | Moyenne |
| 5.7 | Cache Redis (endpoints fréquents) | Performance | Moyenne |
| 5.8 | Load testing (k6 / Artillery) | Performance | Basse |

---

## 9. 🔵 Nice to have (~15h)

| # | Feature | Effort |
|---|---------|:------:|
| F1 | Avis produits (étoiles + commentaires) | 6h |
| F2 | Wishlist (♡ Sauvegarder) | 2h |
| F3 | Partage produit (lien direct) | 1h |
| F4 | Mode sombre | 2h |
| F5 | PWA (install mobile) | 4h |

---

## 10. 📋 PRs & Issues ouvertes

### Issues (15)

| # | Titre | Labels | Priorité |
|---|-------|--------|:--------:|
| #71 | 🔴 Injection SQL | `bug`, `security` | CRITIQUE |
| #72 | 🔴 Secrets en dur | `bug`, `security` | CRITIQUE |
| #73 | 🔴 Validation absente | `bug`, `security` | CRITIQUE |
| #74 | 🔴 Mots de passe faibles | `bug`, `security` | CRITIQUE |
| #75 | 🔴 Données sensibles exposées | `bug`, `security` | CRITIQUE |
| #76 | 🔴 Webhook Stripe non vérifié | `bug`, `security` | CRITIQUE |
| #77 | 🟠 Transactions DB manquantes | `bug` | MAJEUR |
| #78 | 🟠 Gestion d'erreurs | `bug` | MAJEUR |
| #79 | 🟠 Pagination absente | `enhancement` | MAJEUR |
| #80 | 🟠 Architecture couches | `enhancement` | MAJEUR |
| #81 | 🟠 Rate limiting incomplet | `enhancement`, `security` | MAJEUR |
| #82 | 🟠 Logging absent | `enhancement` | MAJEUR |
| #83 | 🟠 Tests absents | `enhancement` | MAJEUR |
| #84 | 🟠 Pool PostgreSQL | `enhancement` | MAJEUR |
| #48 | 💰 Saisie coûts réels | `finance`, `data-entry` | BLOQUANT |

### PRs ouvertes : 0

Aucune PR ouverte — alignement gouvernance à jour.

---

## 11. ✅ Historique complété

<details>
<summary>Cliquer pour voir tout ce qui a été accompli</summary>

### Session 07/04/2026 — Alignement Gouvernance & Fix Déploiement
| # | Action | PR | Status |
|---|--------|-----|--------|
| 1 | Phase 3 : POST /cancel + Stripe refund + crédit boutique + GET /credits | PR #105 | ✅ Mergée |
| 2 | Phase 2 : Migration 47 constantes → getRule()/getRuleNumber() | PR #106 | ✅ Mergée |
| 3 | Fix déploiement : railway.toml watch patterns (filtre docs-only) | PR #107 | ✅ Mergée |
| 4 | Fix crash : SyntaxError backticks imbriquées dans utils/sms.js | PR #108 | ✅ Mergée |
| 5 | Alignement documents de gouvernance (Roadmap, Carto, Delta) | PR #109 | 🔄 |

### Session 06/04/2026 — Audit deep + Dashboard unifié + Catalogue Pièces
| # | Action | PR | Status |
|---|--------|-----|--------|
| 1 | Connexion GitHub + exploration repo | — | ✅ |
| 2 | Audit deep de la Cartographie 360° | — | ✅ |
| 3 | Carto Coffre-Fort v10.0 → v12.0 | PR #90 | ✅ Mergée |
| 4 | Dashboard Unifié v11.0 (4 fichiers → 1, 8 endpoints) | PR #91 | ✅ Mergée |
| 5 | Documentation architecture dashboard | PR #92 | ✅ Mergée |
| 6 | Rapport d'audit (`docs/AUDIT_REPORT.md`) | PR #90 | ✅ Mergée |
| 7 | Gouvernance : commit auto 10min + workflow roadmap | — | ✅ |
| 8 | Dashboard Pilotage Instant App (4 vues scaffoldées) | — | ✅ |
| 9 | Roadmap v14.0 : Catalogue Pièces Auto/Moto → Priorité 2 | — | ✅ |
| 10 | Vue Tendances validée + API connectée | PR #97 | ✅ |
| 11 | Vue Retards validée + API connectée | PR #97 | ✅ |
| 12 | Branchement API réelle (8 endpoints, auto-refresh 15s) | PR #97 | ✅ |
| 13 | Ajout Priorité 6 — Règles Opérationnelles Commandes (8 tâches) | — | ✅ |
| 14 | Tests & validation dashboard (46 checks passés) | PR #97 | ✅ |
| 15 | Dépréciation 4 anciens dashboards (redirects) | PR #98 | ✅ |
| 16 | **PRIORITÉ 1 TERMINÉE** — Dashboard Pilotage Unifié 11/11 | — | 🎉 |

### Boutique Live (5 étapes — toutes ✅)
- ✅ Portail + Auth Guards (`f40b41b`)
- ✅ Seed produits (20 Comores) + relais (5 points) (`7894ad2`)
- ✅ Boutique : vrais produits depuis l'API (`18f592b`)
- ✅ Checkout réel + mini-login + relais API (`18f592b`)
- ✅ Auto-refresh dashboards 15s + indicateur 🔴 LIVE (`b6c09c9`)

### Sprint UX (4 sprints — tous ✅)
- ✅ **Phase A** : JWT httpOnly cookies, Helmet CSP, fallback route, cache-control
- ✅ **Phase B** : Hero centrage, modal header sticky, toast repositionné
- ✅ **Phase C** : Animation fly-to-cart, drawer Amazon-Komores, badge "✨ Ajouté"
- ✅ **Phase D** : Upload images (multer), email confirmation (nodemailer), mot de passe admin

### Hotfix BUG-018 — 12 bugs frontend (commit `0246887`)
- ✅ 4 fonctions JS manquantes (`openCart`, `saveCart`, `refreshCartBadge`, `setQty`)
- ✅ 3 routes backend ajustées (guest-checkout, relais public, payment_mode)
- ✅ 3 fixes data (statuts tracking, product_id type, flyToCart)

### Corrections Phase 7 — 14/14 bugs résolus
- ✅ 7A (bloquant) : DIV/0, NULL cost, validation items
- ✅ 7B (important) : Index DB, helmet, race condition stock, XSS, catch manquants
- ✅ 7C (nice to have) : Localhost, DIV/0 forecast, JWT localStorage → httpOnly

### Tests E2E — Phases 1-3 validées (19/19 passent)

### Sécurité — 58 problèmes corrigés (audit initial)

### Infrastructure
- ✅ Validation centralisée (31 schémas Joi, 32 routes protégées)
- ✅ Upload images produits (Multer)
- ✅ Email confirmation commande (Nodemailer)
- ✅ CI/CD déployé (Railway + GitHub Actions)
- ✅ Documentation complète (README, Architecture, Deployment, Session)

</details>

---

## 12. 📋 Ordre de travail recommandé

```
✅ TERMINÉ :
  ├── Dashboard Pilotage Unifié (11/11) 🎉
  └── Gouvernance Opérationnelle — Phases 1-3 ✅

🟠 ENSUITE :
  └── Catalogue Pièces Auto/Moto & Marque Exclusive SAV Dubai
      └── (12 tâches)

🔶 GOUVERNANCE (suite) :
  └── Phase 4 — Expédition partielle Hub Dubai
  └── Phase 5 — Dashboard Configuration ⚙️

Prochaine session :
  └── Fix 6 vulnérabilités CRITIQUES (#71→#76)

Session suivante :
  ├── Fix 8 vulnérabilités MAJEURES (#77→#84)
  └── Saisie coûts réels (#48)

Session Go-Live :
  ├── Audit comptable (Phase 4)
  ├── Reset & cleanup (Phase 5)
  └── Go-Live checklist (Phase 6)

Après Go-Live :
  └── Features UX (E1→E5)

Long terme :
  └── Améliorations (architecture, tests, CI/CD, monitoring)
```

---

> 🔒 **Ce document est la SEULE roadmap de référence pour Komerce.**  
> Les anciennes roadmaps (ROADMAP_CORRECTIONS, ROADMAP_BOUTIQUE_LIVE, ROADMAP_TEST, ROADMAP_UX_SPRINT) ont été supprimées et consolidées ici.  
> *Mettre à jour après chaque session.*
