# 🔒 AGENTS_PROTOCOL.md — Protocole de Gouvernance Komerce

> **Version** : 1.0 — 06/04/2026
> **Statut** : OBLIGATOIRE pour tout agent (IA ou humain)
> **Repo** : `SamyrFateh/komerce-backend`

---

## 🎯 Principe fondamental

**Toute implémentation, correction ou modification du projet Komerce DOIT obligatoirement consulter et mettre à jour les 3 documents de référence suivants.**

Aucune exception. Aucun raccourci. Quel que soit l'agent.

---

## 📐 Les 3 Piliers de Référence

### 1️⃣ CARTOGRAPHY_360.md — La Carte
> `docs/CARTOGRAPHY_360.md`

**Ce que c'est** : Cartographie exhaustive de l'architecture — 120 endpoints, 28+ tables, middlewares, dépendances inter-routes, services externes.

**Quand la consulter** :
- ✅ Avant toute modification de code (routes, tables, middlewares)
- ✅ Pour comprendre les dépendances d'un fichier
- ✅ Pour vérifier l'impact d'un changement

**Quand la mettre à jour** :
- ✅ Après ajout/suppression/modification d'un endpoint
- ✅ Après ajout/modification d'une table ou vue
- ✅ Après modification d'un middleware ou service externe
- ✅ Après modification des dépendances inter-routes

---

### 2️⃣ ROADMAP_KOMERCE.md — Le Plan
> `docs/ROADMAP_KOMERCE.md`

**Ce que c'est** : Roadmap unifiée v12 — progression globale, issues ouvertes, priorités, ordre de travail session par session.

**Quand la consulter** :
- ✅ Avant de commencer toute session de travail
- ✅ Pour vérifier les priorités actuelles
- ✅ Pour s'assurer qu'on ne duplique pas un travail déjà fait

**Quand la mettre à jour** :
- ✅ Après fermeture d'une issue ou PR
- ✅ Après complétion d'une tâche de la roadmap
- ✅ Après découverte d'un nouveau bug ou besoin
- ✅ Après changement de priorités

**📡 Sync automatique** : Ce fichier est auto-commité sur GitHub toutes les 10 minutes.

---

### 3️⃣ Coffre-Fort Sécurité — Le Bouclier
> `docs/AUDIT_REPORT.md` + `docs/audit/` + Issues #71-#84

**Ce que c'est** : L'ensemble des audits de sécurité et de qualité du projet.

| Document | Rôle |
|----------|------|
| `docs/AUDIT_REPORT.md` | Rapport principal — 8 écarts identifiés entre carto et code |
| `docs/audit/SECURITY_CHECKLIST.md` | Checklist sécurité à valider avant Go-Live |
| `docs/audit/AUDIT_BUGS.md` | Bugs identifiés par audit |
| `docs/audit/AUDIT_CODE_INTEGRITY.md` | Intégrité du code — cohérence imports/exports |
| `docs/audit/FRONTEND_AUDIT.md` | Audit du frontend |
| `docs/audit/db_audit.md` | Audit de la base de données |
| `docs/audit/middleware_audit.md` | Audit des middlewares |
| `docs/audit/utils_audit.md` | Audit des utilitaires |
| `docs/audit/batch_2.md` à `batch_6.md` | Audits par lot de fichiers |
| **Issues #71-#76** | 🔴 6 vulnérabilités CRITIQUES ouvertes |
| **Issues #77-#84** | 🟠 8 vulnérabilités MAJEURES ouvertes |

**Quand le consulter** :
- ✅ Avant toute modification touchant l'authentification, les paiements, ou les données sensibles
- ✅ Avant d'ajouter un nouvel endpoint ou middleware
- ✅ Avant tout déploiement
- ✅ Pour vérifier si un fix sécurité est déjà planifié

**Quand le mettre à jour** :
- ✅ Après correction d'une vulnérabilité
- ✅ Après découverte d'un nouveau risque
- ✅ Après modification d'un middleware de sécurité (auth, validate, rateLimit)

---

## 🔄 Workflow Obligatoire — Avant Toute Action

```
┌─────────────────────────────────────────────────┐
│           AVANT DE CODER / CORRIGER             │
│                                                  │
│  1. 📖 Lire ROADMAP_KOMERCE.md                  │
│     → Quelle est la priorité ? Est-ce déjà fait?│
│                                                  │
│  2. 🗺️  Lire CARTOGRAPHY_360.md                 │
│     → Quels fichiers sont impactés ?             │
│     → Quelles dépendances inter-routes ?         │
│                                                  │
│  3. 🔒 Consulter le Coffre-Fort Sécurité        │
│     → Y a-t-il une vulnérabilité liée ?          │
│     → Le changement introduit-il un risque ?     │
│                                                  │
│  4. ✅ SEULEMENT ALORS → Implémenter            │
└─────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────┐
│           APRÈS AVOIR CODÉ / CORRIGÉ            │
│                                                  │
│  1. 🗺️  Mettre à jour CARTOGRAPHY_360.md        │
│     → Si endpoints/tables/middlewares changés    │
│                                                  │
│  2. 📋 Mettre à jour ROADMAP_KOMERCE.md          │
│     → Cocher les tâches complétées               │
│     → Ajouter les nouvelles tâches découvertes   │
│                                                  │
│  3. 🔒 Mettre à jour le Coffre-Fort              │
│     → Si vulnérabilité corrigée → fermer l'issue │
│     → Si nouveau risque → créer une issue        │
│                                                  │
│  4. 📝 Commit avec message clair                 │
│     → Référencer les issues/PRs liées            │
└─────────────────────────────────────────────────┘
```

---

## ⚠️ Règles Absolues

1. **JAMAIS de modification sans lecture préalable des 3 piliers**
2. **JAMAIS de commit sans mise à jour des documents impactés**
3. **JAMAIS de fix sécurité sans mise à jour de l'AUDIT_REPORT et des issues**
4. **TOUJOURS vérifier la véracité** — croiser les claims avec le code réel
5. **TOUJOURS garder la roadmap comme source de vérité** pour la progression

---

## 📡 Synchronisation Automatique

| Document | Fréquence sync | Méthode |
|----------|----------------|---------|
| `ROADMAP_KOMERCE.md` | Toutes les 10 min | Auto-commit via Tasklet trigger |
| `CARTOGRAPHY_360.md` | À chaque modification de code | Commit manuel obligatoire |
| Coffre-Fort Sécurité | À chaque fix sécurité | Commit manuel + fermeture issue |

---

## 🔗 Liens Rapides

| Ressource | Chemin |
|-----------|--------|
| Cartographie | `docs/CARTOGRAPHY_360.md` |
| Roadmap | `docs/ROADMAP_KOMERCE.md` |
| Audit Principal | `docs/AUDIT_REPORT.md` |
| Checklist Sécurité | `docs/audit/SECURITY_CHECKLIST.md` |
| Issues Critiques | GitHub Issues #71-#76 |
| Issues Majeures | GitHub Issues #77-#84 |
| Ce protocole | `docs/AGENTS_PROTOCOL.md` |

---

> _"Pas de carte, pas de plan, pas de bouclier → pas de code."_
> — Protocole Komerce v1.0
