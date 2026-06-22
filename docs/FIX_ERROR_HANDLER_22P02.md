# Fix — error-handler : 22P02 (uuid/texte invalide) → 400

## Origine
Sonde de conformité P4-1 : `/signals/:id` et `/sourcing/candidates/:id` renvoyaient
**500** `invalid input syntax for type uuid: "..."` quand un `:id` non-UUID partait
direct en requête Postgres. Un mauvais identifiant client est une **erreur 400**, pas
une panne serveur 500.

## Correctif
`middleware/error-handler.js` — ajout du code pg `22P02` (invalid_text_representation)
à la classification, à côté des 23xxx déjà gérés :
- `classifyError` : `22P02` → `'invalid_input'`
- `getStatusCode` : `'invalid_input'` → **400**
- `getUserMessage` : « Identifiant ou paramètre invalide »

Global et sûr : couvre toute la classe (`:id`, query, etc.) en un point ; les erreurs
**inconnues restent 500** (la sonde attrape toujours les vrais crashs).

## Vérifié (local)
- `err.code='22P02'` → **400** « Identifiant ou paramètre invalide ».
- `err` inconnue → **500** (préservé).
- `backend:audit` 0 · `arch:check` 0 · pas de drift de graphe.

## Après push
Prochain run conformance : `server_error` doit tomber à **1** cas — `POST /api/auth/auto-register`
(503 intentionnel, endpoint désactivé). Dernière étape avant promotion en bloquant :
exclure cet endpoint de la sonde **ou** le passer en 410 Gone, puis rendre `server_error` bloquant.
