# O9.2 — Full Test Campaign

## Scope

Exécuter l'existant avant d'ajouter de nouveaux tests.

Ordre :

1. Unit tests.
2. Integration tests sur vraie PostgreSQL avec schéma Railway + migrations.
3. Playwright public.
4. Playwright authenticated/business sur staging.
5. Inventaire exact des rouges, skips, todos et faux verts.

## Règles

- Aucun nouveau test avant l'inventaire des preuves manquantes.
- `skip`, `todo` ou mock sur un cas critique ne vaut pas preuve.
- Corriger uniquement les rouges réels.
- Les tests mutants sont staging uniquement.

## Statut

- O9.1 : CLOSED — 6/6 P0 REAL_DB PROVEN.
- O9.2A : IN_PROGRESS.
