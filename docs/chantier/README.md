# docs/chantier/

Ce dossier est le **poste de commande** du chantier de consolidation backend Komerce.

## Ce qu'il contient

| Fichier | Rôle |
|---------|------|
| `STATUS.md` | **Point d'entrée unique.** État du jour, prochain lot, règles. À lire en premier. |
| `CLOTURE_CYCLE_CRITIQUE_BACKEND.md` | Récapitulatif de la clôture I-SWEEP / TEST-1 (18 mai 2026). |
| `PROMPTS_KIT_POST_CRITIQUE.md` | Kit de prompts opérationnel après clôture critique. Remplace `_archive/PROMPTS_KIT.md`. |
| `{D1..D8}_*.md`, `FLOW_AUDIT_*.md` | Livrables des sessions d'audit D et G (à la racine). |
| `I_SWEEP_*.md` | Plan et patch I-SWEEP. |
| `MIGRATIONS_FOLDERS_A5.md` | Note A5 sur la cohabitation `db/migrations/` ↔ `migrations/`. |
| `garde-fous/audit-backend-arch.js` | Garde-fou architectural exécutable (à déplacer vers `scripts/` au lot H3). |

> Note : un sous-dossier `audits/` a existé un temps. Les livrables d'audit sont désormais **à la racine de ce dossier**, pas dans un sous-dossier.

## Workflow

```
Nouvelle session agent
        ↓
    Lire STATUS.md (30 sec)
        ↓
    Lire la fiche du lot dans BACKEND_GOLIVE_ROADMAP.md (2 min)
        ↓
    Créer la branche → faire le travail → mettre STATUS.md à jour
        ↓
    Ouvrir PR → attendre validation humaine
```

## Convention de nommage des branches

```
chore/backend-{LOT}-{slug}      ex: chore/backend-A3-move-groupe-paiement-test
fix/backend-{LOT}-{slug}        ex: fix/backend-D1-admin-auth-coverage
refacto/backend-{LOT}-{slug}    ex: refacto/backend-B1-extract-sourcing-engine
test/backend-{LOT}-{slug}       ex: test/backend-C2-sourcing-analyzer
docs/backend-{LOT}-{slug}       ex: docs/backend-A5-clarify-migrations-folders
```

## Règle de fin de session (rappel AGENTS.md §6)

Avant tout commit ou PR :
- cocher le lot terminé dans STATUS.md (☐ → ✅)
- mettre à jour la section **PROCHAIN LOT À EXÉCUTER**
- mettre à jour la date en tête (`> Mis à jour : YYYY-MM-DD`)
- si divergence doc/code/DB détectée : ajouter une ligne dans "Pièges critiques"
