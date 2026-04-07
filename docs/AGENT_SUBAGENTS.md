# 🤖 AGENT_SUBAGENTS.md — Instructions des sous-agents Komerce

> **Ce fichier est la source de vérité pour tous les sous-agents.**
> Les agents locaux doivent lire ce fichier à chaque exécution.

---

## governance-autocommit

### Mission
Sous-agent stateless qui surveille `docs/_pending/` et applique automatiquement les fichiers delta aux documents de gouvernance.

### Contexte

| Clé | Valeur |
|-----|--------|
| **Owner** | SamyrFateh |
| **Repo** | komerce-backend |
| **Branch** | main |
| **Fichier local** | `/agent/subagents/governance-autocommit.md` |

### Outils GitHub nécessaires
Les outils sont préfixés par le `connectionId` actif (ex: `conn_XXX__github_`).

| Outil | Usage |
|-------|-------|
| `github_get_file_content` | Lire fichiers/dossiers |
| `github_push_to_branch` | Pusher des commits |
| `github_list_issues` | Lister les issues |
| `github_search_issues` | Rechercher issues/PRs |

### Workflow complet

#### Step 0 — Lire la configuration (OBLIGATOIRE)
**Avant toute action**, lire `docs/AGENT_CONFIG.md` du repo pour avoir la config à jour.

#### Step 1 — Vérifier les deltas en attente
Lister le contenu de `docs/_pending/` dans le repo.
- Si le dossier est vide ou ne contient que `README.md` → Rapporter "No pending deltas found" et **STOP**.
- Ne rien committer s'il n'y a rien à faire (idempotent).

#### Step 2 — Lire chaque fichier delta
Pour chaque `.md` trouvé dans `docs/_pending/` (sauf `README.md`), lire son contenu et identifier :
- **ROADMAP** — mises à jour de statuts, nouvelles tâches
- **CARTOGRAPHY** — nouveaux fichiers, endpoints, tables
- **AUDIT** — corrections de sécurité

#### Step 3 — Lire les documents actuels
Lire les documents qui doivent être mis à jour :
- `docs/ROADMAP_KOMERCE.md` — si le delta contient des changements ROADMAP
- `docs/CARTOGRAPHY_360.md` — si le delta contient des changements CARTOGRAPHY (fichier volumineux ~75KB, ne lire que si nécessaire)
- `docs/AUDIT_REPORT.md` — si le delta contient des changements AUDIT

#### Step 4 — Appliquer les deltas
Appliquer les changements avec une **approche delta-only** :
- Ne modifier QUE les lignes/sections concernées
- Ne JAMAIS régénérer un document entier
- Préparer le contenu mis à jour

#### Step 5 — Commit atomique
Pusher TOUTES les modifications en UN SEUL commit :
- Fichiers docs mis à jour (ROADMAP, CARTOGRAPHY, AUDIT selon besoin)
- Supprimer les fichiers delta traités avec `delete: true`

Format du message de commit :
```
docs(governance): auto-sync — [description brève des changements]
```

#### Step 6 — Rapport
Retourner un résumé :
- Nombre de deltas traités
- Documents mis à jour
- Description brève des changements
- Erreurs éventuelles (pour que l'agent parent puisse agir)

### Règles

| Règle | Description |
|-------|-------------|
| 🔄 Idempotent | Si aucun delta → ne rien faire |
| 🎯 Delta-only | Jamais de régénération complète |
| ⚛️ Single commit | Toutes les modifs en un seul commit |
| 🧹 Clean up | Toujours supprimer les deltas traités |
| 🚫 Stateless | Aucun état en base de données ou fichier local |
| 📖 Repo first | Toujours lire AGENT_CONFIG.md en premier |
| ❗ Error reporting | Rapporter clairement les erreurs |

---

## Ajouter un nouveau sous-agent

Pour ajouter un nouveau sous-agent :
1. Ajouter une section dans ce fichier avec la même structure
2. Mettre à jour `AGENT_CONFIG.md` avec la référence
3. Créer le fichier lanceur local minimal dans `/agent/subagents/`

---

_Dernière mise à jour : 2026-04-07_
_Source de vérité pour tous les sous-agents Komerce_
