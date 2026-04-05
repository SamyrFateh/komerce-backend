# 📋 Proposition — Restructuration documentaire Komerce

> **Date :** 5 avril 2026
> **Objectif :** Remplacer 8 fichiers redondants par 4 documents cohérents où chaque information vit à un seul endroit.

---

## 1. Diagnostic de l'existant

### 8 fichiers actuels — 86 KB de documentation

| Fichier | Taille | Rôle déclaré |
|---------|--------|--------------|
| `HANDOVER_MASTER_FINAL.md` | 24 KB | Passation complète (vision, archi, DB, API, features, sécurité, config, historique) |
| `AUDIT_BUGS.md` | 8 KB | 14 bugs identifiés avec priorités |
| `AUDIT_CODE_INTEGRITY.md` | 11 KB | Audit intégrité code (auth, SQL, erreurs, imports) |
| `FRONTEND_AUDIT.md` | 21 KB | Audit frontend Boutique (7 critiques + 5 importants) |
| `ROADMAP_BOUTIQUE_LIVE.md` | 4 KB | Roadmap boutique live (5 étapes — toutes ✅) |
| `ROADMAP_TEST.md` | 10 KB | Roadmap test + checklist go-live |
| `ROADMAP_UX_SPRINT.md` | 8 KB | Sprint UX + hotfix frontend |
| `SECURITY_CHECKLIST.md` | 2.5 KB | Checklist sécurité production |

### Problèmes identifiés

#### 🔴 Redondances (même info à plusieurs endroits)

| Information | Présente dans... |
|-------------|-----------------|
| Architecture système | HANDOVER §2 + ROADMAP_UX §Architecture |
| Liste des bugs | AUDIT_BUGS + FRONTEND_AUDIT + ROADMAP_TEST §7 + ROADMAP_UX §Hotfix |
| Checklist go-live | ROADMAP_TEST §6 + ROADMAP_UX §Phase 6 |
| Sécurité middleware | HANDOVER §7 + AUDIT_CODE_INTEGRITY §1 + SECURITY_CHECKLIST |
| Schéma DB | HANDOVER §4 + schema.sql (divergents) |
| Liste des routes API | HANDOVER §5 + AUDIT_CODE_INTEGRITY §6 (chiffres différents) |

#### 🔴 Incohérences documentation ↔ code réel

| Écart | Documentation dit... | Code réel dit... |
|-------|---------------------|-----------------|
| **Version serveur** | v9.1 (HANDOVER) | v9.2/v9.3 (server.js changelog + healthcheck) |
| **Fichiers routes** | 18 (HANDOVER) | 18 + `upload.js` middleware non documenté |
| **Nombre endpoints** | Non compté (HANDOVER) vs 102 (AUDIT_CODE_INTEGRITY) | À recompter — des routes ont été ajoutées (guest-checkout, upload, relais/public) |
| **Statuts commande** | 9 dans schema.sql ENUM | 12 dans la machine à états code (AUDIT_CODE_INTEGRITY) — `ordered`, `purchasing`, `hub_preparation`, `transit_comores` non dans l'ENUM |
| **Tables DB** | 14 tables (HANDOVER) | 14 + partners + loyalty_tiers + customs_history (créés par auto-migration server.js) + fabrics + garment_models + disputes (dans schema.sql) = **20 tables** |
| **Produits seed** | 20 produits Comores (épices, artisanat — ROADMAP_BOUTIQUE) | 20 produits différents (téléphones, parfums Dubai — server.js seedProducts) |
| **Bugs frontend** | "Boutique non-fonctionnelle" (FRONTEND_AUDIT) | 12 bugs corrigés commit `0246887` (ROADMAP_UX) — mais FRONTEND_AUDIT non mis à jour |
| **BUG-013** | "Pas de helmet ni rate-limit" (AUDIT_BUGS) | ✅ Corrigé depuis v8.5 — doc non mise à jour |
| **Variables env** | 11 dans .env.example | Cloudinary, SMTP, ADMIN_PASSWORD mentionnés dans le code mais absents/partiels dans .env.example |

#### 🟡 Informations orphelines / périmées

- `ROADMAP_BOUTIQUE_LIVE.md` : 100% terminé — n'apporte plus de valeur vivante
- `ROADMAP_TEST.md` Phase 7 : duplique AUDIT_BUGS et ROADMAP_UX
- `HANDOVER_MASTER_FINAL.md` §5.7-5.18 : "Voir version précédente" — contenu manquant
- `AUDIT_BUGS.md` : tous les bugs sont marqués résolus → historique, plus un tracker actif
- `FRONTEND_AUDIT.md` : non mis à jour après les corrections → décrit un état qui n'existe plus

#### 🟡 Manques

- **Pas de README.md** — le premier fichier que tout développeur cherche
- **Pas de changelog structuré** — l'historique est dispersé entre server.js, HANDOVER §10, et les roadmaps
- **Pas de documentation déploiement autonome** — les infos sont éclatées entre HANDOVER §9, SECURITY_CHECKLIST, et .env.example

---

## 2. Structure proposée — 4 documents

### Principe : **chaque fait vit à un seul endroit**

```
komerce-backend/
├── README.md                    ← NOUVEAU — Point d'entrée unique
├── docs/
│   ├── ARCHITECTURE.md          ← Référence technique (DB, API, flux)
│   ├── STATUS.md                ← État actuel vivant (features, bugs, backlog)
│   └── DEPLOYMENT.md            ← Mise en prod (config, sécurité, ops)
└── (fichiers code inchangés)
```

### 📄 README.md — Point d'entrée (~2 pages)

| Section | Contenu |
|---------|---------|
| **Description** | Komerce en 3 phrases (marketplace B2C diaspora → Comores) |
| **Stack** | Node 20 · Express 4 · PostgreSQL 15 · Railway |
| **Quickstart** | `npm install` → `.env` → `psql < schema.sql` → `npm start` |
| **Structure repo** | Arborescence annotée (identique à HANDOVER §3 — mis à jour) |
| **Liens docs** | → ARCHITECTURE.md · STATUS.md · DEPLOYMENT.md |

**Source :** HANDOVER §1 + §3 + §9.2 (consolidés et mis à jour)

---

### 📄 docs/ARCHITECTURE.md — Référence technique (~6 pages)

C'est le document qu'on consulte pour comprendre **comment le système fonctionne**.

| Section | Contenu |
|---------|---------|
| **1. Vue d'ensemble** | Diagramme d'architecture (HANDOVER §2 — mis à jour v9.3) |
| **2. Base de données** | Toutes les tables (y compris auto-migration), ENUMs, triggers, vues, fonctions — **recompté depuis le code réel** |
| **3. API — Routes complètes** | Les 18 fichiers routes avec TOUS les endpoints, méthode, auth, description — **recompté depuis le code** |
| **4. Middlewares** | auth.js (JWT httpOnly + RBAC), rate-limit.js (6 limiters), upload.js (multer) |
| **5. Utilitaires** | pricing.js, rates.js, reference.js, sms.js, email.js — rôle et exports |
| **6. Flux métier** | Machine à états commande (12 statuts réels), flux paiement, flux QR scan, flux fidélité |
| **7. Frontends** | 9 dashboards HTML, leur rôle, taille, APIs consommées |

**Sources consolidées :** HANDOVER §2-§8 + AUDIT_CODE_INTEGRITY §1-§6 (dédupliqués, corrigés, mis à jour)

---

### 📄 docs/STATUS.md — État vivant du projet (~4 pages)

C'est le document qui dit **où on en est** et **ce qu'il reste à faire**. C'est le seul fichier qui évolue fréquemment.

| Section | Contenu |
|---------|---------|
| **1. Version courante** | v9.3 — date, score intégrité, résumé 1 ligne |
| **2. Fonctionnalités livrées** | Liste consolidée des 36+ features (tableau compact) |
| **3. Bugs connus ouverts** | Uniquement les bugs NON résolus (aujourd'hui : aucun critique, quelques medium) |
| **4. Écarts doc ↔ code** | Delta identifié (section 1 de ce document — mis à jour) |
| **5. Backlog priorisé** | P0/P1/P2 — ce qu'il reste à faire (tests auto, disputes CRUD, upload S3, multi-île...) |
| **6. Checklist Go-Live** | Une seule checklist unifiée (plus de doublons) |
| **7. Changelog** | Historique des versions (résumé structuré, pas session par session) |

**Sources consolidées :** HANDOVER §6 + §10 + §11 + AUDIT_BUGS + FRONTEND_AUDIT + ROADMAP_TEST + ROADMAP_UX + ROADMAP_BOUTIQUE (tout fusionné, bugs résolus archivés, bugs ouverts conservés)

---

### 📄 docs/DEPLOYMENT.md — Mise en production (~2 pages)

| Section | Contenu |
|---------|---------|
| **1. Variables d'environnement** | TOUTES les variables (exhaustif), groupées par service, avec valeurs par défaut et notes |
| **2. Checklist sécurité** | ADMIN_PASSWORD, JWT_SECRET, QR_SECRET, SMTP — procédures pas à pas |
| **3. Déploiement Railway** | Build, start, health probes, domaine custom |
| **4. Base de données** | Initialisation (schema + extension + seed), auto-migrations au boot |
| **5. Monitoring** | Logs, backup pg_dump, health endpoints |

**Sources consolidées :** HANDOVER §9 + SECURITY_CHECKLIST + .env.example (harmonisés)

---

## 3. Table de correspondance — Ancien → Nouveau

| Ancien fichier | Devient... | Action |
|----------------|-----------|--------|
| `HANDOVER_MASTER_FINAL.md` | README + ARCHITECTURE + STATUS + DEPLOYMENT | **Supprimer** après migration |
| `AUDIT_BUGS.md` | STATUS §3 (bugs ouverts) + STATUS §7 (changelog) | **Supprimer** |
| `AUDIT_CODE_INTEGRITY.md` | ARCHITECTURE §4-§6 (patterns auth/SQL) + STATUS §2 (score) | **Supprimer** |
| `FRONTEND_AUDIT.md` | STATUS §3 (bugs restants) + STATUS §7 (changelog corrections) | **Supprimer** |
| `ROADMAP_BOUTIQUE_LIVE.md` | STATUS §7 (changelog — milestone "Boutique Live") | **Supprimer** |
| `ROADMAP_TEST.md` | STATUS §5 (backlog tests) + STATUS §6 (go-live) | **Supprimer** |
| `ROADMAP_UX_SPRINT.md` | STATUS §5 (backlog UX) + STATUS §7 (changelog) | **Supprimer** |
| `SECURITY_CHECKLIST.md` | DEPLOYMENT §2 | **Supprimer** |

---

## 4. Écarts critiques à corriger AVANT la rédaction

Ces écarts entre la documentation et le code doivent être tranchés **avant** de rédiger les nouveaux documents :

| # | Écart | Action requise |
|---|-------|---------------|
| 1 | **Statuts commande** : ENUM SQL a 9 valeurs, le code utilise 12 statuts | → Vérifier si le code fait des ALTER TYPE ou si c'est du string matching. Documenter l'ENUM réel en production |
| 2 | **Tables auto-migrées** : partners, loyalty_tiers, customs_history, customs_taux_mensuel (vue) sont créées au boot par server.js mais absentes de schema.sql | → Soit les ajouter à schema.sql, soit les documenter comme "auto-créées" |
| 3 | **Route guest-checkout** : ajoutée mais absente de toute doc API | → Documenter dans ARCHITECTURE |
| 4 | **Upload middleware** : multer configuré, route POST image, mais absent de la doc | → Documenter dans ARCHITECTURE |
| 5 | **Variables env** : SMTP_*, ADMIN_PASSWORD, CLOUDINARY_* partiellement dans .env.example | → Compléter .env.example en même temps que DEPLOYMENT |
| 6 | **Version** : le code dit v9.3, les docs v9.1 | → Aligner sur v9.3 |
| 7 | **komerce-api.js** (128KB) : rôle flou — chargé par certains HTML ? Remplacé par le script inline ? | → Clarifier le statut (actif vs legacy) |

---

## 5. Plan d'exécution proposé

### Étape 1 — Revue de code complète (audit écarts)
Vérifier dans le code réel chacun des 7 écarts ci-dessus. Produire une liste de faits vérifiés.

### Étape 2 — Rédaction des 4 documents
En se basant uniquement sur le **code réel** (pas les anciens docs). Les anciens docs servent de guide mais le code fait foi.

### Étape 3 — Suppression des anciens fichiers
Retirer les 8 fichiers obsolètes du repo.

### Étape 4 — Mise à jour .env.example
Aligner avec toutes les variables réellement utilisées dans le code.

---

> **Résultat attendu :** 4 documents compacts, sans redondance, alignés sur le code v9.3, prêts pour une revue de code complète en étape 2.
