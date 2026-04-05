# 🗺️ ROADMAP DE CORRECTIONS — Komerce Backend

**Créée le :** 5 avril 2026 | **18 bugs restants sur 31**
**Stratégie :** Performance & stabilité d'abord, sécurité avant mise en prod

---

## 📅 Sprint 1 — Performance & BDD (4 bugs)
> **Objectif :** Base de données propre et performante
> **Effort estimé :** ~2h | **Impact :** 🔥🔥🔥

| # | Bug | Action | Fichier(s) |
|---|-----|--------|------------|
| P2 | Duplication module DB | Supprimer `db/index.js`, tout centraliser sur `db.js` | `db/index.js` → delete |
| P1 | 3 index manquants | Ajouter index `users(email)`, `products(category)`, `scans(scanned_by)` | `db/schema.sql` |
| P4 | Duplication table tissus | Fusionner `fabrics` + `ceremony_fabrics` dans un seul schema | `db/schema.sql` + `db/schema_extension.sql` |
| P5 | Table disputes dupliquée | Garder une seule définition de `disputes` | `db/schema.sql` + `db/schema_extension.sql` |

**Commit :** `🔧 perf(sprint-1): index SQL + suppression doublon DB + schéma unifié`

---

## 📅 Sprint 2 — Robustesse Backend (2 bugs)
> **Objectif :** Zéro crash possible côté serveur
> **Effort estimé :** ~30min | **Impact :** 🔥🔥

| # | Bug | Action | Fichier(s) |
|---|-----|--------|------------|
| R2 | DIV/0 forecast CA | Ajouter guard `nbJours > 0` avant calcul forecast | `routes/dashboard.js` |
| R3 | Fetch sans error handler | Ajouter `.catch()` aux 3 fetch manquants (section Pilotage) | `public/Komerce_Admin.html` |

**Commit :** `🛡️ fix(sprint-2): guards forecast + error handlers fetch`

---

## 📅 Sprint 3 — Nettoyage & Qualité (6 bugs)
> **Objectif :** Code propre, données réalistes, bonnes pratiques
> **Effort estimé :** ~1h30 | **Impact :** 🔥

| # | Bug | Action | Fichier(s) |
|---|-----|--------|------------|
| N2 | pool.connect vs getClient | Remplacer `pool.connect` par pattern `getClient` dans payments | `routes/payments.js` |
| N3 | Commentaire SHA-256 trompeur | Corriger commentaire → "bcrypt" | `db/schema.sql` |
| N5 | QR_SECRET par défaut | Ajouter validation process.env au démarrage | `server.js` |
| N6 | Données réalistes en seed | Remplacer emails/téléphones réels par des faux | `db/seed.sql` |
| N7 | Contrainte contact user | Ajouter `CHECK (email ~* '^.+@.+$')` sur users | `db/schema.sql` |
| N8 | TODO soft-auth | Vérifier et nettoyer zone orders.js ~L988 | `routes/orders.js` |

**Commit :** `🧹 clean(sprint-3): qualité code + seed réaliste + contraintes`

---

## 📅 Sprint 4 — Sécurité (6 bugs) ⚠️ AVANT PROD
> **Objectif :** Zéro faille de sécurité avant déploiement
> **Effort estimé :** ~3h | **Impact :** 🔥🔥🔥🔥

| # | Bug | Action | Fichier(s) |
|---|-----|--------|------------|
| S1 | Mot de passe en clair | Supprimer `Komerce2026!` du seed, utiliser variable d'env | `db/seed.sql` |
| S2 | JWT_SECRET par défaut | Valider `process.env.JWT_SECRET` au démarrage, crash si absent | `server.js` |
| S3 | SSL sans vérification | `rejectUnauthorized: true` (résolu avec P2 si doublon supprimé) | `db.js` |
| S4 | Hash identique admin/démo | Générer des hash bcrypt différents par compte | `db/seed.sql` |
| S6 | XSS stocké (21 innerHTML) | Ajouter DOMPurify ou `textContent` partout | `public/Komerce_Boutique.html` |
| S7 | JWT dans localStorage | Migrer vers cookies httpOnly (chantier front+back) | Admin + Boutique + server.js |

**Commit 1 :** `🔒 sec(sprint-4a): seed sécurisé + JWT env + SSL strict`
**Commit 2 :** `🔒 sec(sprint-4b): DOMPurify XSS + httpOnly cookies`

---

## 📅 Sprint 5 — Starter Kit 🚀
> **Objectif :** Extraire un boilerplate universel depuis Komerce
> **Effort estimé :** ~2h

- [ ] Créer repo template `express-starter-kit`
- [ ] Extraire : server.js, db.js, auth JWT, rate-limit, helmet, health
- [ ] Structure routes/ générique (CRUD)
- [ ] Schema SQL de base (users, sessions, config)
- [ ] README "Quick Start" + checklist sécurité
- [ ] .env.example avec toutes les vars

---

## 📊 Timeline

```
Sprint 1 ████████░░░░░░░░ Performance & BDD
Sprint 2 ██░░░░░░░░░░░░░░ Robustesse
Sprint 3 █████░░░░░░░░░░░ Nettoyage
Sprint 4 █████████░░░░░░░ Sécurité (avant prod)
Sprint 5 ██████░░░░░░░░░░ Starter Kit 🚀
```

**Total estimé : ~9h de travail**

---

## ✅ Progression

| Sprint | Statut | Bugs corrigés |
|--------|--------|:-------------:|
| Sprint 1 | ✅ Terminé | **5/5** (P1, P2, P4, P5, N3) |
| Sprint 2 | ✅ Terminé | **2/2** (R2✅déjà, R3) |
| Sprint 3 | ✅ Terminé | **5/5** (N2, N5, N6, N7, N8) |
| Sprint 4 | ✅ Terminé | **5/6** (S1, S2, S3, S4, S6) |
| Sprint 5 | ⬜ À faire | — |
| **Total** | | **17/18** |

### ⏳ Restant :
- **S7** — JWT localStorage → httpOnly cookies (chantier front+back)

---

## 📅 Sprint 5a — Validation des données ✅ TERMINÉ
> **Objectif :** Pipeline de validation/sanitisation centralisé
> **Commits :** `3e6b1df` + `14bdf36` (5 avril 2026)

| Livrable | Description |
|----------|-------------|
| `middleware/validate.js` | Middleware validate() + sanitize() + anti-XSS/injection |
| `validators/index.js` | 31 schémas Joi couvrant toutes les routes mutation |
| `docs/VALIDATION_GUIDE.md` | Guide d'intégration route par route |
| **9 fichiers routes patchés** | **32 routes** protégées par validate() |

**✅ Complet** — Penser à `npm install joi` au déploiement

---

## 📅 Sprint 5b — JWT httpOnly cookies ⬜
> Migrer JWT du localStorage vers cookies httpOnly (S7)

---

## 📅 Sprint 6 — Starter Kit universel 🚀 ⬜
> Extraire un boilerplate réutilisable depuis Komerce
