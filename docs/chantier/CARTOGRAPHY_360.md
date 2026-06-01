# CARTOGRAPHY_360 — redirection chantier

La cartographie canonique est :

`../CARTOGRAPHY_360.md`

Ce fichier n'est conservé que pour compatibilité avec d'anciens liens. **Ne plus le mettre à jour.**
Toute modification structurelle se fait dans `docs/CARTOGRAPHY_360.md`.

## Dashboards admin (état vérifié 2026-06-01)
- **Migration en cours, deux portes servies en parallèle** :
  - `public/dashboards/admin/` (moderne, SPA) — servi sur `/admin/pilotage`, `/admin/control-tower`, `/admin/costing`, etc. (cible).
  - `public/dashboards/admin-legacy/control-tower.html` — servi sur l'URL héritée `/control-tower.html` (encore vivant).
- **Ne pas supprimer `admin-legacy/` tant que `/control-tower.html` n'est pas redirigé vers `/admin/control-tower`.**
- Les anciens `public/js/ct-*.js` ont bien été supprimés (zombies non servis).
