# 🤖 AGENT_CONFIG.md — Configuration Tasklet pour Komerce

> **Ce fichier permet à l'agent Tasklet de se reconfigurer automatiquement sans perte.**
> Si l'agent est réinitialisé, il doit lire ce fichier et suivre les étapes de bootstrap.

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

## 🤖 Sous-agent — governance-autocommit

**Fichier** : `/agent/subagents/governance-autocommit.md`

### Mission
Surveille `docs/_pending/` et applique automatiquement les fichiers delta aux documents de gouvernance.

### Workflow
1. **Check** `docs/_pending/` pour des fichiers `.md`
2. **Lire** chaque delta et identifier les changements (ROADMAP, CARTOGRAPHY, AUDIT)
3. **Lire** les documents cibles actuels
4. **Appliquer** les deltas (approche delta-only, jamais de régénération complète)
5. **Commit** toutes les modifications en un seul commit atomique
6. **Supprimer** les fichiers delta traités dans le même commit

### Règles
- **Idempotent** — Si aucun delta, ne rien faire
- **Delta-only** — Ne jamais régénérer un document entier
- **Single commit** — Toutes les modifications en un seul commit
- **Clean up** — Toujours supprimer les deltas traités
- **Stateless** — Aucun état en base de données

### Format du commit
```
docs(governance): auto-sync — [description brève]
```

### Contenu complet du sous-agent

```markdown
# Governance Auto-Commit — Komerce

Sous-agent stateless qui surveille et applique les deltas de gouvernance du repo Komerce.

## Context

- **Owner**: SamyrFateh
- **Repo**: komerce-backend
- **Branch**: main
- **GitHub Connection ID**: [à remplacer par le connectionId actif]

The GitHub tools are prefixed with `[connectionId]__github_`. Available tools:
- `[connectionId]__github_get_file_content` — Read files/directories
- `[connectionId]__github_push_to_branch` — Push commits
- `[connectionId]__github_list_issues` — List issues
- `[connectionId]__github_search_issues` — Search issues

## Instructions

Execute the following steps in order. Be completely autonomous — do not ask questions.

### Step 1 — Check for pending deltas
List the contents of `docs/_pending/` in the repo.
If the directory is empty or contains no `.md` files, report "No pending deltas found" and STOP.

### Step 2 — Read each delta file
For each `.md` file found, read its content and parse to identify:
- ROADMAP changes
- CARTOGRAPHY changes
- AUDIT changes

### Step 3 — Read current docs
Read the documents that need updating:
- `docs/ROADMAP_KOMERCE.md` — if ROADMAP changes
- `docs/CARTOGRAPHY_360.md` — if CARTOGRAPHY changes (large file, only if needed)
- `docs/AUDIT_REPORT.md` — if AUDIT changes

### Step 4 — Apply deltas
Apply changes using delta-only approach. Never regenerate entire documents.

### Step 5 — Commit changes
Push all changes in a SINGLE commit. Delete processed delta files with `delete: true`.
Commit message: `docs(governance): auto-sync — [brief description]`

### Step 6 — Report
Return summary: deltas processed, documents updated, changes applied.
```

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
| Point 6 | `docs/komerce-point6-gouvernance-operationnelle.md` | Détail gouvernance opérationnelle |
| Pending deltas | `docs/_pending/*.md` | Fichiers delta à traiter |

---

## 🚀 Procédure de Bootstrap (si agent réinitialisé)

### Étape 1 — Connexion GitHub
1. Créer/retrouver connexion `static:github`
2. Activer les 7 outils requis

### Étape 2 — Lire la config
1. Lire `docs/AGENT_CONFIG.md` (ce fichier)
2. Lire `README.md` et `.cursorrules`
3. Lire `docs/GOVERNANCE.md` et `docs/ROADMAP_KOMERCE.md`

### Étape 3 — Créer le sous-agent
1. Créer `/agent/subagents/governance-autocommit.md` avec le contenu ci-dessus
2. Remplacer `[connectionId]` par le connectionId réel

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

_Dernière mise à jour : 2026-04-07T10:49+02:00_
_Généré par Tasklet AI — Gardien de la gouvernance Komerce_
