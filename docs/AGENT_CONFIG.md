# 🤖 AGENT_CONFIG.md — Configuration Tasklet pour Komerce

> **Ce fichier permet à l'agent Tasklet de se reconfigurer automatiquement sans perte.**
> Si l'agent est réinitialisé, il doit lire ce fichier et suivre les étapes de bootstrap.
> **RIEN n'est stocké en local — le repo est l'unique source de vérité.**

---

## 📋 Identité du projet

| Clé | Valeur |
|-----|--------|
| **Owner** | SamyrFateh |
| **Repo** | komerce-backend |
| **Branche principale** | main |
| **Plateforme** | Node.js / Express / PostgreSQL |
| **Description** | E-Commerce Kom — Backend + Dashboard Pilotage |

---

## 🔗 Connexion GitHub requise

**Intégration** : `static:github`

### Outils à activer (7 minimum) :

| Outil | Usage | Priorité |
|-------|-------|----------|
| `github_list_repositories` | Lister les repos | ✅ Requis |
| `github_get_repository` | Info repo | ✅ Requis |
| `github_get_file_content` | Lire fichiers/dossiers | ✅ Requis |
| `github_list_issues` | Lister les issues | ✅ Requis |
| `github_search_issues` | Rechercher issues/PRs | ✅ Requis |
| `github_create_pull_request` | Créer des PRs | ✅ Requis |
| `github_push_to_branch` | Pusher des commits | ✅ Requis |
| `github_get_issue` | Détail d'une issue | 🟡 Recommandé |
| `github_create_issue` | Créer des issues | 🟡 Recommandé |
| `github_update_issue` | Modifier des issues | 🟡 Recommandé |
| `github_create_issue_comment` | Commenter des issues | 🟡 Recommandé |
| `github_list_pull_requests` | Lister les PRs | ⬜ Optionnel |
| `github_get_pull_request` | Détail d'une PR | ⬜ Optionnel |
| `github_download_file` | Télécharger fichiers | ⬜ Optionnel |

---

## ⏱️ Trigger — Governance Auto-Commit

| Paramètre | Valeur |
|-----------|--------|
| **Type** | `cronScheduler` |
| **Expression** | `*/10 * * * *` (toutes les 10 minutes) |
| **Timezone** | `Europe/Paris` |
| **Titre** | Governance auto-commit Komerce |
| **Message d'invocation** | Run the governance auto-commit subagent at /agent/subagents/governance-autocommit.md for the Komerce repo (SamyrFateh/komerce-backend) |

---

## 🤖 Sous-agents

**Source de vérité** : `docs/AGENT_SUBAGENTS.md` (sur le repo)

| Sous-agent | Mission | Fichier local (lanceur) |
|------------|---------|------------------------|
| `governance-autocommit` | Surveille `docs/_pending/` et applique les deltas | `/agent/subagents/governance-autocommit.md` |

> ⚠️ Le fichier local est un **lanceur minimal** qui lit ses instructions complètes depuis `docs/AGENT_SUBAGENTS.md` du repo.
> Les instructions complètes vivent UNIQUEMENT sur le repo.

---

## 📂 Documents de gouvernance

| Document | Chemin | Rôle |
|----------|--------|------|
| README | `README.md` | Bootstrap agent + présentation projet |
| Cursor Rules | `.cursorrules` | Règles pour agents IA (Cursor, Tasklet) |
| Gouvernance | `docs/GOVERNANCE.md` | Règles de gouvernance opérationnelle |
| Bootstrap | `docs/GOVERNANCE_BOOTSTRAP.md` | Procédure de bootstrap agent |
| Roadmap | `docs/ROADMAP_KOMERCE.md` | Roadmap complète avec statuts |
| Config Agent | `docs/AGENT_CONFIG.md` | **Ce fichier** — config Tasklet |
| Sous-agents | `docs/AGENT_SUBAGENTS.md` | Instructions complètes des sous-agents |
| Point 6 | `docs/komerce-point6-gouvernance-operationnelle.md` | Détail gouvernance opérationnelle |
| Pending deltas | `docs/_pending/*.md` | Fichiers delta à traiter |

---

## 🤖 Espace de travail agent — `docs/_agent/`

> **C'est l'espace persistant de l'agent Tasklet sur le repo.**
> Il remplace tout stockage local (`/agent/home/` ne doit contenir AUCUN état projet).

| Fichier / Dossier | Rôle |
|-------------------|------|
| `docs/_agent/state.md` | **État courant** — contexte actif, tâches en cours, variables |
| `docs/_agent/session_history/` | **Historique** — 1 fichier par session (append-only) |
| `docs/_agent/workspace/` | **Brouillons** — analyses, fichiers temporaires (nettoyés en fin de session) |

### Cycle de vie

1. **Bootstrap** : lire `docs/_agent/state.md` + `docs/REPRISE_SESSION.md`
2. **Pendant la session** : utiliser `docs/_agent/workspace/` pour les brouillons
3. **Fin de session** : mettre à jour `state.md`, archiver dans `session_history/`
4. **Trigger auto-commit** : synchronise `state.md` ↔ `REPRISE_SESSION.md` ↔ `ROADMAP`

---

## 🚀 Procédure de Bootstrap (si agent réinitialisé)

### Étape 1 — Connexion GitHub
1. Créer/retrouver connexion `static:github`
2. Activer les 7 outils requis

### Étape 2 — Lire la config + restaurer l'état
1. Lire `docs/AGENT_CONFIG.md` (ce fichier)
2. Lire `docs/REPRISE_SESSION.md` (point de reprise)
3. Lire `docs/_agent/state.md` (état agent)
4. Lire `docs/AGENT_SUBAGENTS.md` (instructions sous-agents)
5. Lire `docs/GOVERNANCE.md` et `docs/ROADMAP_KOMERCE.md`

### Étape 3 — Créer le sous-agent (lanceur minimal)
1. Créer `/agent/subagents/governance-autocommit.md`
2. Contenu : un lanceur qui lit `docs/AGENT_SUBAGENTS.md` du repo et exécute les instructions
3. Remplacer `[connectionId]` par le connectionId réel

### Étape 4 — Configurer le trigger
1. Créer un trigger `cronScheduler` avec expression `*/10 * * * *`
2. Timezone : `Europe/Paris`
3. Message d'invocation : voir section trigger

### Étape 5 — Vérification
1. Lister les issues ouvertes
2. Afficher un statut projet
3. Tester le trigger avec une simulation

---

## 📊 Statut des phases de gouvernance

| Phase | Description | Statut |
|-------|-------------|--------|
| Phase 1 | API `/api/config/rules` | ✅ Done |
| Phase 2 | Dashboard Pilotage | ✅ Done (11/11 vues) |
| Phase 3 | Boutique Live | ✅ Done (5/5) |
| Phase 4 | Bugs & Sécurité | ✅ Done (58 corrigés) |
| Phase 5 | Dashboard Configuration ⚙️ | ✅ Done (Komerce_Config.html) |

**Gouvernance : 5/5 phases complétées** 🎉

---

## 🏗️ Architecture du stockage

| Donnée | Emplacement | Survit si reset ? |
|--------|-------------|-------------------|
| Code + docs | ✅ GitHub repo | ✅ Oui |
| Config agent | ✅ `docs/AGENT_CONFIG.md` | ✅ Oui |
| Instructions sous-agents | ✅ `docs/AGENT_SUBAGENTS.md` | ✅ Oui |
| **État agent** | ✅ `docs/_agent/state.md` | ✅ **Oui** |
| **Historique sessions** | ✅ `docs/_agent/session_history/` | ✅ **Oui** |
| **Brouillons agent** | ✅ `docs/_agent/workspace/` | ✅ **Oui** |
| Point de reprise | ✅ `docs/REPRISE_SESSION.md` | ✅ Oui |
| Roadmap | ✅ `docs/ROADMAP_KOMERCE.md` | ✅ Oui |
| Lanceur local sous-agent | ⚠️ `/agent/subagents/` | ❌ Mais recréé au bootstrap |
| Trigger config | ⚠️ Plateforme Tasklet | ❌ Mais recréé au bootstrap |

> **Principe** : Tout ce qui est critique vit sur le repo. Les éléments locaux sont recréables automatiquement à partir du repo.
> **`/agent/home/` ne doit contenir AUCUN état projet.**

---

_Dernière mise à jour : 2026-04-07_
_Généré par Tasklet AI — Gardien de la gouvernance Komerce_
