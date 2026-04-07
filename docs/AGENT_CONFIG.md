# 🤖 AGENT_CONFIG.md — Configuration Tasklet pour Komerce

> **Ce fichier permet à l'agent Tasklet de se reconfigurer automatiquement sans perte.**
> Si l'agent est réinitialisé, il doit lire ce fichier et suivre les étapes de bootstrap.
> **Le repo est la source de vérité persistante. L'agent utilise un cache local pour la vitesse pendant la session.**

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

## 🏗️ Architecture du stockage — Flow hybride

> **Principe** : Le repo est la mémoire persistante. L'agent utilise un **cache local** (`/agent/home/komerce/`) pour la vitesse pendant la session, et **synchronise vers le repo en fin de session**.

### Pourquoi le flow hybride ?

L'approche précédente ("tout écrire directement dans `docs/_agent/` sur le repo") posait 3 problèmes :
1. **Lenteur** — chaque écriture = 1 appel API GitHub (~500ms-2s)
2. **Commits parasites** — brouillons, états intermédiaires polluent l'historique Git
3. **Coût API** — nombre d'appels GitHub multiplié inutilement

### Diagramme du flow

```
RESET AGENT ?
    │
    ▼
① BOOTSTRAP (repo → local)
    Lire docs/AGENT_CONFIG.md (repo)
    → Recréer /agent/subagents/governance-autocommit.md (local)
    → Recréer le trigger
    → Restaurer l'état depuis docs/REPRISE_SESSION.md (repo → local)
    │
    ▼
② PENDANT LA SESSION (local = rapide)
    → État courant : /agent/home/komerce/state.json (local)
    → Brouillons : /agent/home/komerce/workspace/ (local)
    → Commits de code : GitHub (via push_to_branch)
    → Deltas de gouvernance : docs/_pending/ (repo, via push)
    │
    ▼
③ FIN DE SESSION (local → repo, 1 seul commit)
    → Sauvegarder état sur le repo : docs/REPRISE_SESSION.md
    → Le trigger auto-commit traite les deltas normalement
```

### Tableau de stockage

| Donnée | Pendant session | Persistance repo | Survit si reset ? |
|--------|----------------|-----------------|-------------------|
| **État courant** | `/agent/home/komerce/state.json` (local) | `docs/REPRISE_SESSION.md` (sync fin de session) | ✅ Oui (via repo) |
| **Brouillons** | `/agent/home/komerce/workspace/` (local) | ❌ Pas persisté | ❌ Non (éphémère) |
| **Code** | — | GitHub via `push_to_branch` | ✅ Oui |
| **Deltas gouvernance** | — | `docs/_pending/` via push | ✅ Oui |
| **Config agent** | — | `docs/AGENT_CONFIG.md` | ✅ Oui |
| **Instructions sous-agents** | — | `docs/AGENT_SUBAGENTS.md` | ✅ Oui |
| **Roadmap** | — | `docs/ROADMAP_KOMERCE.md` | ✅ Oui |
| **Lanceur sous-agent** | `/agent/subagents/` | ❌ Recréé au bootstrap | ✅ Recréable |
| **Trigger** | Plateforme Tasklet | ❌ Recréé au bootstrap | ✅ Recréable |

### Règles du flow hybride

| # | Règle |
|---|-------|
| 1 | **Local = cache rapide** — `/agent/home/komerce/` est un cache de session, pas une source de vérité |
| 2 | **Repo = mémoire** — tout état critique doit être pushé sur le repo avant fin de session |
| 3 | **1 commit en fin de session** — pas de commits intermédiaires pour l'état (sauf deltas `_pending/`) |
| 4 | **Bootstrap idempotent** — l'agent peut se reconfigurer à 100% depuis le repo seul |
| 5 | **Brouillons jetables** — `workspace/` local n'est jamais persisté, c'est un scratch pad |

---

## 📁 `docs/_agent/` — Espace agent sur le repo (legacy)

> ⚠️ **Note** : Avec le flow hybride, `docs/_agent/` est principalement un **backup persistant** plutôt qu'un espace de travail actif.
> L'agent ne doit PAS écrire dans `docs/_agent/` pendant la session — il utilise le cache local.
> La synchronisation se fait via `docs/REPRISE_SESSION.md` en fin de session.

| Fichier / Dossier | Rôle | Mis à jour quand ? |
|-------------------|------|-------------------|
| `docs/_agent/state.md` | Backup de l'état agent | Fin de session uniquement |
| `docs/_agent/session_history/` | Historique (append-only) | Fin de session uniquement |
| `docs/_agent/workspace/` | Archivage brouillons notables | Rarement (si brouillon mérite d'être conservé) |

---

## 🚀 Procédure de Bootstrap (si agent réinitialisé)

### Étape 1 — Connexion GitHub
1. Créer/retrouver connexion `static:github`
2. Activer les 7+ outils requis

### Étape 2 — Lire la config + restaurer l'état
1. Lire `docs/AGENT_CONFIG.md` (ce fichier)
2. Lire `docs/REPRISE_SESSION.md` (point de reprise → hydrate `state.json` local)
3. Lire `docs/AGENT_SUBAGENTS.md` (instructions sous-agents)
4. Lire `docs/GOVERNANCE.md` et `docs/ROADMAP_KOMERCE.md`

### Étape 3 — Créer le cache local
1. Créer `/agent/home/komerce/state.json` (hydraté depuis REPRISE_SESSION)
2. Créer `/agent/home/komerce/workspace/` (vide)

### Étape 4 — Créer le sous-agent (lanceur minimal)
1. Créer `/agent/subagents/governance-autocommit.md`
2. Contenu : un lanceur qui lit `docs/AGENT_SUBAGENTS.md` du repo et exécute les instructions
3. Remplacer `[connectionId]` par le connectionId réel

### Étape 5 — Configurer le trigger
1. Créer un trigger `cronScheduler` avec expression `*/10 * * * *`
2. Timezone : `Europe/Paris`
3. Message d'invocation : voir section trigger

### Étape 6 — Vérification
1. Lister les issues ouvertes
2. Afficher un statut projet
3. Tester le trigger avec une simulation (optionnel)

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

_Dernière mise à jour : 2026-04-07_
_Généré par Tasklet AI — Flow hybride v2.0_
