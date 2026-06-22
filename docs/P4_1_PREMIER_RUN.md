# P4-1 — 1er run de conformité (Schemathesis) : triage

469 cas testés, 468 « en échec ». **C'est attendu** pour un 1er run observe : le contrat
ne déclare presque que des `200` (schémas `UNKNOWN`), donc tout statut réel d'erreur
paraît « non documenté ». Le tri sépare le bruit de contrat du vrai signal applicatif.

## Répartition réelle
| Check | Nb | Verdict |
|---|---:|---|
| Undocumented HTTP status code | 312 | **bruit de contrat** — dominé par **261× HTTP 429** (Schemathesis martèle → rate-limiter) + 44× 400 (validation) + 401/403/404/410. Le contrat ne déclare que 200. |
| Unsupported methods | 244 | **bruit** — TRACE → 404 au lieu de 405. Pédant, à exclure. |
| Server error (5xx) | 3 | **VRAI SIGNAL** (voir ci-dessous). |
| Schema Error (200 *errors*) | 200 | **défaut du contrat** — « Path parameter `{id}` is not defined » : le générateur n'émet pas les `parameters` des templates `{…}` → toutes les routes paramétrées sont intestables. |

## Les 3 vrais 5xx
1. **`POST /api/admin/signals/generate` → 500 `log is not defined`** — ✅ **CORRIGÉ.**
   Vérifié dans le code : `services/signal-service.js` appelait `log.warn(...)` dans 5 catch
   (l.152/199/250/299/348) **sans jamais définir `log`**. Une sous-erreur non-fatale levait
   `ReferenceError` → 500. Ne se déclenche que sur chemin d'erreur → invisible aux tests
   classiques, attrapé par la sonde. Fix = import manquant (`require('../utils/logger').child`),
   conforme au pattern du repo. No-op sur le happy-path.
2. **`/signals/:id` & `/sourcing/candidates/:id` → 500 `invalid input syntax for type uuid`**
   — robustesse : un `:id` non-UUID part direct en requête Postgres → erreur DB → 500 au lieu
   de 400/404. Pattern large (toute route `:id` sur colonne uuid). **→ backlog L-robustesse.**
3. **`POST /api/auth/auto-register` → 503 `Endpoint désactivé`** — **intentionnel** (endpoint
   désactivé), pas un bug. Juste non reflété au contrat.

## Fausse alerte écartée
La réponse 500 de `scan-batch` exposait une `stack` → **correctement gardé** par
`middleware/error-handler.js` (`if NODE_ENV !== 'production'`). Visible ici car CI =
`NODE_ENV=test`. **Aucune fuite en prod.**

## Calibration pour le prochain run (lot L3 → bloquant)
1. **Contrat : déclarer les path params** (`scripts/contract-generate.js`) — pour chaque
   `{param}` du chemin, émettre `parameters:[{name,in:path,required:true,schema:{type:string}}]`.
   Débloque les ~200 routes paramétrées (sinon « Schema Error »).
2. **Désactiver le rate-limit dans l'env de la sonde** (261× 429 noient la couverture) —
   variable d'env dédiée ou limites hautes pour le job conformance.
3. **Réduire le bruit** : `--exclude-checks unsupported_methods` ; documenter les réponses
   d'erreur communes (400/401/403/404/409/429) **ou** `--exclude-checks status_code_conformance`
   tant que le contrat ne les déclare pas.
4. Une fois 1-3 faits, les vrais 5xx ressortent nets → passer la porte en bloquant.

## Bilan
La sonde a fait exactement son travail dès le 1er run : **1 vrai bug de code trouvé et
corrigé** (`log is not defined`), 1 classe de robustesse identifiée (uuid → 500), 1 fausse
alerte écartée (stack gardée), le reste = dette de contrat déjà cadrée (L3/L4).
