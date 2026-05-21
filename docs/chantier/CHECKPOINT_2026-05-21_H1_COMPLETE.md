# Checkpoint — 2026-05-21 — H1 terminé

## État confirmé

La découpe progressive de `server.js` H1 est terminée et mergée sur `main`.

| Lot | État | PR |
|-----|------|----|
| H1A — API routes manifest | ✅ fait | #427 |
| H1B — HTML routes / SPA fallback | ✅ fait | #443 |
| H1C — Security / CORS / Helmet | ✅ fait | #448 |
| H1D — Operational crons | ✅ fait | #449 |
| H1E — Environment validation | ✅ fait | #451 |
| H1F — Startup migrations bootstrap | ✅ fait | #454 |

## État runtime post-H1

Validation post-merge H1F :

```text
npm test                                     PASS
GET /health                                  PASS HTTP 200
GET /api/health                              PASS HTTP 200
admin order refund dry-run                   SKIP P0_ORDER_ID absent
collective ready_to_capture repair dry-run   PASS HTTP 200
collective stock reservations repair dry-run PASS HTTP 200
```

Conclusion : runtime sain. Le seul skip restant est optionnel et dépend de la fourniture d'un `P0_ORDER_ID` pour le dry-run refund.

## Correctifs P0 collectifs réalisés pendant le chantier

Les dry-runs collectifs admin sont maintenant exécutables en production avec JWT admin valide.

Corrections appliquées :

- `cw.public_token` remplacé par `cw.public_token_hash`.
- statut workspace `cancelled` remplacé par `archived`.
- requête stock repair corrigée : suppression du `SELECT DISTINCT` incompatible avec `ORDER BY`.
- requête ready_to_capture corrigée : `cps.created_at` utilisé au lieu de `cps.updated_at`.

## Nouvelle forme de `server.js`

`server.js` conserve encore le rôle de point d'entrée runtime, mais délègue maintenant les blocs suivants :

- `bootstrap/env.js`
- `bootstrap/security.js`
- `bootstrap/api-routes.js`
- `bootstrap/html-routes.js`
- `bootstrap/crons.js`
- `bootstrap/startup-migrations.js`

## Prochains lots recommandés

1. Mettre `docs/chantier/STATUS.md` à jour pour remplacer l'ancien état H1B/H1C par ce checkpoint.
2. Décider du prochain axe :
   - H2 — finir le nettoyage structurel de `server.js` autour de `listen/shutdown/crash guards` ; ou
   - F1 — reprendre la dette logging par domaines ; ou
   - P0-FULL — fournir un `P0_ORDER_ID` pour transformer P0 PARTIAL en PASS complet.

## Règle de prudence

Ne pas supprimer les codemods H1 immédiatement. Ils constituent une trace utile du chantier et un filet de reproduction du diff.
