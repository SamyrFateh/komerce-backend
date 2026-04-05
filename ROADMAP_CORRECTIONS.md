# 🗺️ Komerce — Roadmap Restante (5 avril 2026)

> **Repo** : SamyrFateh/komerce-backend · **Version** : v9.3  
> **Statut global** : Backend sécurisé ✅ · Boutique fonctionnelle ✅ · Go-live en attente

---

## 📊 Vue d'ensemble

| Roadmap | Progression | Restant |
|---------|:-----------:|:-------:|
| Boutique Live | ✅ 5/5 étapes | — |
| Corrections (bugs) | ✅ 22/23 bugs | 1 item (Starter Kit) |
| Tests & Validation | 🟡 3/6 phases | Phases 4→6 restantes |
| UX Sprint | ✅ Haute priorité done | 10 features |
| Sécurité & Audit | ✅ ~58 problèmes corrigés | — |
| Coffre-fort (Vault) | ✅ 6/6 fichiers | — |

---

## 🔴 Issues ouvertes sur GitHub

| # | Titre | Labels | Type |
|---|-------|--------|------|
| [#48](https://github.com/SamyrFateh/komerce-backend/issues/48) | 💰 Saisir les coûts réels sur les commandes collectées | `finance`, `data-entry` | Issue |
| [#44](https://github.com/SamyrFateh/komerce-backend/pull/44) | ✨ Polish: palette sage + CTA hero + trust bar + espacement | — | PR ouverte |
| [#38](https://github.com/SamyrFateh/komerce-backend/pull/38) | UI: Déplacer la barre de recherche du Hero vers le catalogue | — | PR ouverte |

---

## 🟡 À faire avant Go-Live (BLOQUANT)

### 1. Exécuter les tests E2E (ROADMAP_TEST.md)
> ✅ Phases 1-3 validées le 5 avril 2026 — 19/19 tests passent

- ~~**Phase 1** — Tests API (19/19 passent : health, auth, catalogue, commandes, statuts)~~ ✅
- ~~**Phase 2** — Seed données historiques (28 commandes de test)~~ ✅
- ~~**Phase 3** — Validation des 6 dashboards (CA 6.6M KMF, ops, finance, pilotage)~~ ✅
- **Phase 4** — Audit comptable croisé (8 vérifications SQL) ⬜
- **Phase 5** — Reset & cleanup ⬜
- **Phase 6** — Checklist Go-Live (voir ci-dessous) ⬜

### 2. Saisie des coûts réels (Issue #48)
- Renseigner `cost_real_kmf` sur les commandes `collected`/`shipped`
- Renseigner `transport_kmf` et `douane_kmf`
- Sans ça, les marges nettes sont incalculables sur le dashboard Pilotage

### 3. Go-Live Checklist

| # | Élément | Statut |
|---|---------|--------|
| 6.1 | Tests E2E passent (19/19) | ✅ |
| 6.2 | Dashboards affichent données réalistes (CA 6.6M KMF) | ✅ |
| 6.3 | Audit comptable validé | ⬜ |
| 6.4 | Reset factory exécuté en Prod | ⬜ |
| 6.5 | Mot de passe admin changé | ⬜ |
| 6.6 | JWT_SECRET unique en Prod | ⬜ |
| 6.7 | HTTPS activé | ✅ (Railway natif) |
| 6.8 | Domaine configuré (boutique.komerce.km) | ⬜ |
| 6.9 | Monitoring / logs activés | ⬜ |
| 6.10 | Backup DB programmé | ⬜ |

---

## 🟠 Avant lancement marketing (~11h de dev)

> Priorité MOYENNE — Features UX manquantes

| # | Feature | Effort | Statut |
|---|---------|:------:|:------:|
| E1 | Filtrage produits par catégorie | 2h | ⬜ |
| E2 | Recherche produits par nom | 1h | ⬜ |
| E3 | Responsive mobile (iPhone SE / Galaxy A) | 3h | ⬜ |
| E4 | Page produit détaillée (modal) | 4h | ⬜ |
| E5 | Stock en temps réel (badge rupture) | 1h | ⬜ |

### PRs à merger
- **#44** — Polish palette sage (couleurs, CTA hero, trust bar, espacement)
- **#38** — Barre de recherche déplacée vers le catalogue

---

## 🔵 Nice to have (~15h de dev)

| # | Feature | Effort |
|---|---------|:------:|
| F1 | Avis produits (étoiles + commentaires) | 6h |
| F2 | Wishlist (♡ Sauvegarder) | 2h |
| F3 | Partage produit (lien direct) | 1h |
| F4 | Mode sombre | 2h |
| F5 | PWA (install mobile) | 4h |

---

## 🟣 Améliorations long terme (SESSION_STATUS recommandations)

| # | Amélioration | Priorité |
|---|-------------|:--------:|
| 1 | Tests automatisés (Jest/Supertest) | Haute |
| 2 | Monitoring avancé (Sentry / APM) | Haute |
| 3 | Documentation API (Swagger/OpenAPI) | Moyenne |
| 4 | Cache Redis (endpoints fréquents) | Moyenne |
| 5 | Backup auto PostgreSQL | Haute |
| 6 | Load testing (k6 / Artillery) | Basse |
| 7 | Starter Kit universel (extraire boilerplate) | Basse |

---

## 📈 Ce qui est FAIT (résumé)

- ✅ **58 problèmes de sécurité** corrigés (audit complet)
- ✅ **14 bugs** corrigés (Phase 7A/7B/7C)
- ✅ **12 bugs frontend** corrigés (BUG-018)
- ✅ **Coffre-fort** avec analyse d'impact automatique sur chaque PR
- ✅ **Boutique fonctionnelle** : catalogue, panier, checkout, fly-to-cart, drawer
- ✅ **5 dashboards** temps réel (Admin, Pilotage, Hub, Relais, Finance)
- ✅ **JWT httpOnly cookies** (migration complète)
- ✅ **Validation centralisée** (31 schémas Joi, 32 routes protégées)
- ✅ **Upload images** produits (Multer)
- ✅ **Email confirmation** commande (Nodemailer)
- ✅ **Documentation complète** (README, Architecture, Deployment, Session)
- ✅ **CI/CD** déployé sur Railway + GitHub Actions
- ✅ **Fix imports validate** (products, orders, admin, scans — 4 fichiers)
- ✅ **Fix joi@17** + package-lock.json regénéré (compatibilité Node 18)
- ✅ **Tests E2E 19/19** passent en production (script v2 commité)

---

*Généré le 5 avril 2026 par Tasklet depuis le repo GitHub*
