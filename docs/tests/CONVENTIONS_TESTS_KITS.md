# Convention d'appel des kits de test — par type de test

> **Version** : 1.0 — 2026-07-05 · Rattachée à DOCTRINE_INVARIANTS_METIER.md §7
> **Règle unique** : dans tout fichier de test **nouveau ou touché**, le kit est le seul chemin. Interdiction de redéfinir localement `makeReq`, `makeRes`, `makeNext`, `loadView` ou un mock d'API. (Vérifié par le grep-gate du chantier INV-7 ; en attendant : contrainte dans chaque prompt Sonnet + tampon Fable.)

---

## 1. Backend (`komerce-backend`) — `tests/helpers/backendTestKit.js`

| Type de test | Import à copier | Helpers |
|---|---|---|
| **Route / middleware Express** (auth, verrous 409, validations) | `const { makeReq, makeRes, makeNext, invokeHandler } = require('../helpers/backendTestKit');` | `invokeHandler(handler, {body, params, user})` fait tout le trio req/res/next |
| **Service avec DB / transaction** (idempotence, machine de statuts, remboursements) | `const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../helpers/backendTestKit');` | preuve canonique des P0 : rejeu → `expectTransactionRolledBack` ou no-op |
| **Service pur** (parseurs, validateurs, contrat pivot) | aucun kit nécessaire — on appelle la fonction réelle avec des fixtures (`tests/fixtures/catalog/…`) | c'est le régime des tests ING |

Squelette route :
```js
const { invokeHandler } = require('../helpers/backendTestKit');
it('candidat rejected → 409', async () => {
  const { res } = await invokeHandler(handler, { params: { id: 'x' }, user: { role: 'admin' } });
  expect(res.status).toHaveBeenCalledWith(409);
});
```

## 2. Boutique — `tests/unit/helpers/boutiqueTestKit.js`

| Type de test | Import à copier | Helpers |
|---|---|---|
| **Module `js/b-*.js`** (état, panier, favoris, modal) | `const { resetState, resetDom, mountFixture, mockWindowK, flush, resetLocalStorage, submitForm } = require('./helpers/boutiqueTestKit');` | `beforeEach : resetState(state)` obligatoire (état partagé module) ; `mockWindowK()` remplace l'API réseau |

⚠️ Particularité assumée par le kit : les `jest.mock('../../js/xxx.js', …)` de
dépendances restent **dans le fichier de test** (hoisting jest) — le kit
documente la forme à copier, il ne peut pas les factoriser.

## 3. Dashboards — `tests/unit/helpers/dashboardTestKit.js`

| Type de test | Import à copier | Helpers |
|---|---|---|
| **Vue admin (`admin/js/views/*.js`)** | `const { loadView, makeKmcApi, makeKmcFilters, makeKpiCard, cleanupGlobals, mockConfirm, mockPrompt, mockAlert, submitForm } = require('./helpers/dashboardTestKit');` | ordre canonique : `makeKmcApi({...})` → `makeKmcFilters()` → `loadView('../../admin/js/views/X.js','XView')` → `render` ; `afterEach : cleanupGlobals(...)` |

## 4. Ce qui rend l'appel « systématique » (3 crans)

1. **Maintenant** : la contrainte est dans chaque prompt Sonnet —
   « cas d'attaque écrits avec le kit » — et je la vérifie au tampon
   (grep des imports avant exécution).
2. **INV-7** : `testkit-ratchet-gate.js` refuse en CI tout fichier de test
   nouveau/touché qui redéfinit un mock local — plus besoin d'y penser.
3. **INV-7 aussi** : les mocks d'API front (`mockWindowK`, `makeKmcApi`)
   se nourrissent des fixtures `tests/fixtures/api-responses/` validées
   côté backend — l'appel du kit devient aussi l'appel de la vérité de
   forme API.
