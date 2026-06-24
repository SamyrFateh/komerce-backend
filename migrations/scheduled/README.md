# migrations/scheduled/

Migrations écrites mais **volontairement pas prêtes à s'exécuter** (garde-fou
date, attente d'une fenêtre de stabilité, dépendance sur un événement futur).

## Pourquoi ce dossier existe (incident 2026-06-24)

`scripts/run-migrations.js` scanne `migrations/*.sql` (non récursif) et exécute
**tout fichier numéroté pas encore dans `schema_migrations`**, dans une seule
transaction par fichier — sur le premier échec, il `throw` et abandonne tout
le run. `railway.toml` appelle ce runner via `scripts/migrate.js` comme
`releaseCommand`, déclenché à chaque déploiement touchant `migrations/**`.

Conséquence : un fichier dans `migrations/` avec un garde-fou SQL
(`RAISE EXCEPTION` si une condition n'est pas remplie) fait échouer le
releaseCommand → **le déploiement Railway échoue**, pas juste un warning. Une
migration date-guardée (`089_drop_deprecated_cost_weight_columns.sql`) a
bloqué les déploiements jusqu'à découverte du problème.

## Convention

- Un fichier ici **n'est jamais exécuté automatiquement** (le scanner ne
  descend pas dans les sous-dossiers).
- Quand la condition qui bloquait le fichier est levée (date passée,
  dépendance résolue, vérification manuelle faite — voir l'en-tête du
  fichier lui-même pour la procédure exacte) :
  ```
  git mv migrations/scheduled/NNN_xxx.sql migrations/NNN_xxx.sql
  ```
  Le prochain déploiement l'appliquera normalement via le runner.
- Garder le garde-fou SQL (`RAISE EXCEPTION ...`) dans le fichier même après
  réactivation prévue : défense en profondeur si quelqu'un le déplace trop
  tôt par erreur.

## Contenu actuel

- `089_drop_deprecated_cost_weight_columns.sql` — réactivable à partir du
  2026-07-08 (fenêtre de stabilité C5/087), procédure de vérification dans
  l'en-tête du fichier.
