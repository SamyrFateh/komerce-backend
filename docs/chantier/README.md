# docs/chantier/

Ce dossier est le **poste de commande** du chantier de consolidation backend Komerce.

## Ce qu'il contient

| Fichier | Rôle |
|---------|------|
| `STATUS.md` | **Point d'entrée unique.** État du jour, prochain lot, règles. À lire en premier. |
| `garde-fous/audit-backend-arch.js` | Garde-fou architectural exécutable (lot H3). |
| `audits/AUDIT_*.md` | Livrables des sessions d'audit approfondies. |

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
