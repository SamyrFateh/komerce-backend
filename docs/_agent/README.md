# 🤖 docs/_agent/ — Espace de travail Tasklet

> **Ce dossier est l'espace de travail persistant de l'agent Tasklet sur le repo.**
> Conformément à la Règle #0 : le repo est la mémoire — aucun état local.

---

## 📂 Structure

| Dossier / Fichier | Rôle |
|-------------------|------|
| `state.md` | État courant de l'agent (contexte actif, tâches en cours, variables) |
| `session_history/` | Historique des sessions passées (1 fichier par session) |
| `workspace/` | Brouillons, analyses en cours, fichiers temporaires de travail |

---

## 🔄 Cycle de vie

1. **Au bootstrap** : l'agent lit `state.md` pour restaurer son contexte
2. **Pendant la session** : l'agent utilise `workspace/` pour ses brouillons
3. **En fin de session** : l'agent met à jour `state.md` et archive dans `session_history/`
4. **Le trigger auto-commit** (toutes les 10 min) : synchronise cet espace avec la ROADMAP et REPRISE_SESSION

---

## ⚠️ Règles

- **NE JAMAIS stocker d'état dans `/agent/home/`** — tout vit ici
- Les fichiers de `workspace/` sont éphémères — nettoyés en fin de session
- `state.md` est la **source de vérité** de l'état agent
- `session_history/` est append-only (ne jamais modifier les anciens fichiers)

---

_Créé le 2026-04-07 par Tasklet AI_
