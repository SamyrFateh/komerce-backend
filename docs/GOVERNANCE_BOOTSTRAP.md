# 🚀 GOVERNANCE_BOOTSTRAP.md — Auto-configuration Agent Tasklet

> **Version** : 1.0 — 06/04/2026
> **Statut** : OBLIGATOIRE pour tout agent Tasklet connecté à ce repo
> **But** : Permettre à n'importe quel agent Tasklet de se configurer en 1 session

---

## 🎯 Objectif

Ce fichier contient les instructions pour qu'un agent Tasklet se configure automatiquement comme **gardien de la gouvernance** du repo Komerce.

L'agent n'a besoin d'aucun état préalable — tout est dans le repo.

---

## ⚡ Instructions de bootstrap (pour l'agent Tasklet)

### Étape 1 — Connecter GitHub

Si pas déjà connecté :
1. Créer une connexion GitHub (`static:github`)
2. Activer les outils : `github_list_repositories`, `github_get_file_content`, `github_push_to_branch`, `github_list_issues`, `github_search_issues`

### Étape 2 — Créer le sous-agent de gouvernance

Créer le fichier `/agent/subagents/governance-autocommit.md` avec les instructions suivantes :

```
Sous-agent stateless qui :
1. Liste docs/_pending/ pour trouver les fichiers delta
2. Scanne la structure du repo (routes/, dashboard-app/, docs/, etc.)
3. Lit ROADMAP_KOMERCE.md et CARTOGRAPHY_360.md
4. Applique les deltas + corrige la dérive structurelle
5. Commit les changements + supprime les deltas traités
6. Format commit : docs(governance): auto-sync — [description]

Owner: SamyrFateh | Repo: komerce-backend | Branch: main
Connection ID: [celui créé à l'étape 1]
```

### Étape 3 — Configurer le trigger

Créer un trigger `cronScheduler` :
- **Cron** : `*/10 * * * *` (toutes les 10 minutes)
- **Timezone** : `Europe/Paris`
- **Title** : `Governance auto-commit Komerce`
- **Message** : `Run the governance auto-commit subagent at /agent/subagents/governance-autocommit.md`

### Étape 4 — Vérifier

Simuler le trigger pour vérifier que tout fonctionne.

---

## 📂 Système de deltas (`docs/_pending/`)

### Comment ça marche

Tout agent (Cursor, Tasklet, humain) qui modifie le code **dépose un fichier delta** dans `docs/_pending/` :

```
docs/_pending/2026-04-06_18-30_dashboard-9-views.md
```

### Format d'un delta

```markdown
# Delta — [Description courte]

## Contexte
[Ce qui a été fait]

## ROADMAP
- Section X: [changement]
- Tâche Y.Z: ⬜ → ✅

## CARTOGRAPHY
- Section X: [changement]
- Ajout fichier: path/to/file.tsx
- Suppression fichier: path/to/old.tsx

## AUDIT (si applicable)
- [changement sécurité]
```

### Cycle de vie

```
Agent dépose delta → Trigger Tasklet (10 min) → Lit delta → Applique aux docs → Commit → Supprime delta
```

---

## 🔑 Principes

1. **Zéro état agent** — tout est dans le repo, rien dans la DB ou le filesystem de l'agent
2. **Stateless** — chaque run scanne le repo from scratch
3. **Idempotent** — si rien n'a changé, rien n'est commité
4. **Universel** — n'importe quel agent Tasklet peut reprendre le rôle de gardien
5. **Delta-only** — on ne régénère jamais un doc entier, on applique des changements ciblés

---

> _"Le repo est le système. L'agent est remplaçable."_
> — Gouvernance Komerce v1.0
