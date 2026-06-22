# P4-1 — diagnostic du run bloquant rouge + correctifs

## Ce que le run a vraiment dit
- ❌ ~450 échecs = **rate-limiter (429)**, PAS des bugs. Schemathesis émet des centaines
  de requêtes → le limiteur global (`max:500`/15min) explose → check « API rejected
  schema-compliant request » compte chaque 429 comme un échec. **Bruit d'environnement.**
- ❌ La porte avait été **promue en bloquant trop tôt** → PR bloquées sur ce bruit.
- ❌ `log is not defined` : **disparu** (fix #1 OK).
- ❌ `DELETE /api/admin/signals/generate` → 500 uuid : **toujours là** — parce que ce
  handler fait un `catch { res.status(500) }` **local** qui court-circuite l'error-handler
  global (où le `22P02 → 400` a été posé). Le fix global ne couvre que les routes en `next(err)`.

## Correctifs livrés
1. **`middleware/rate-limit.js`** — bypass env-gated : `DISABLE_RATE_LIMIT=1` (+ garde
   `NODE_ENV!=='production'`, donc jamais en prod) → tous les limiteurs deviennent pass-through.
2. **`contract-conformance.yml`** — `DISABLE_RATE_LIMIT: '1'` dans l'env de la sonde +
   **retour en OBSERVE** (`continue-on-error: true`) : la porte ne bloque plus les PR le
   temps de voir le vrai signal 5xx sans le bruit 429.

## Prochain run (après merge) — ce qu'on attend
Sans le bruit 429, le rapport montrera la **vraie** surface 5xx. Probable : plusieurs
routes `:id` qui 500 sur uuid invalide via un `catch { res.status(500) }` local
(signals, etc.). C'est la liste à corriger ensuite.

## Étapes suivantes
1. Lire le rapport propre → lister TOUTES les routes qui 5xx.
2. Corriger le pattern : remplacer les `catch { res.status(500) }` par `catch(err){ next(err) }`
   sur les routes concernées (l'error-handler global mappe alors `22P02 → 400`), OU valider
   le format uuid en amont.
3. Une fois 0 vrai 5xx : re-promouvoir en **bloquant scopé** `--checks server_error`
   (bloque sur les crashs, ignore le bruit de contrat des autres checks) + garder un step
   observe pour la visibilité.
