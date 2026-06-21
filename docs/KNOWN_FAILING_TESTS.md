# Suites de test en échec — historique quarantaine (lot P7-tests) · ✅ RÉSORBÉE

État au baseline de câblage : 9 suites unit échouaient de façon **préexistante**
(pas causé par les lots gouvernance P3-A/P4-2 — vérifié), exclues de la gate
bloquante mais visibles en non-bloquant. **Session P7-tests : les 9 sont
traitées** (8 réparées, 1 supprimée). La gate `unit` couvre maintenant
l'intégralité de `tests/unit` sans exclusion — voir `.github/workflows/ci.yml`.

## Suites quarantaine (9, unit) — résolution
| Suite | Nature constatée (spot-check) | Résolution |
|---|---|---|
| confirm-payment-cycle | assertion de mock sur le contrôle de stock (`toBeUndefined` vs requête SELECT) — **infra**, sans rapport avec payment_status. | ✅ **mock périmé** : `.includes('UPDATE')` matchait `SELECT ... FOR UPDATE OF p` (verrou de ligne) au lieu de la vraie `UPDATE products`. Précisé en `.includes('UPDATE products')`, même pattern que le test sain voisin. |
| payment-paypal | happy-path refund **passe** ; seul l'edge « 502 si refundCapture échoue » casse. | ✅ **vrai bug** : `refundPaypalOrder` n'avait pas de try/catch autour de `paypal.refundCapture` → promesse rejetée non gérée au lieu d'un 502 propre (la route fait `res.status(result.status).json(result.body)`, qui suppose que la fonction résout toujours). Corrigé dans `services/payment-paypal.js`. |
| shared-cart-v4 | logique métier shared-cart avec mocks DB. | ✅ **mock périmé** : test S3-04 écrit pour l'ancien `expireOldCarts` à requête unique, avant qu'il délègue à `runSharedCartStateMachineTick` V4.1 (5 transitions T1-T5, 6 requêtes DB dans le scénario testé). Mock et assertions réécrits pour matcher la séquence réelle. |
| shared-cart-lot9-business | logique métier shared-cart avec mocks DB. | ❌ **Suite supprimée** — testait le modèle de statuts LOT 9 (`closed_for_settlement`/`settlement_in_progress`/`ready_to_finalize`) produit par `services/shared-cart-v4-settlement.js`. Ce modèle a été **remplacé par la doctrine V4.1 figée** (migration 080, projection dans `services/shared-cart-v41-transitions.js` — `LEGACY_CLOSED` y mappe explicitement ces statuts vers `CLOSED`). `convertSharedCartToOrder` (`services/shared-cart-engine.js`) n'accepte à raison que `['closed', 'awaiting_choice']`, le modèle courant. Vérifié : `openSettlement()` (la fonction qui écrit ces statuts legacy) n'est appelée nulle part en prod — code mort, seul ce test l'exerçait encore. **Dette restante, hors scope L1** : `services/shared-cart-v4-settlement.js` exporte encore `openSettlement` (mort) à côté de `isSettlementOpen`/`assertCartCanAcceptParticipantPayment` (vivants, utilisés par `shared-cart-commitment-service.js`) — à nettoyer dans un lot dédié. |
| shared-cart-refund-queue | logique métier shared-cart avec mocks DB. | ✅ **mock périmé (×2)** : (1) mock manquant pour `SELECT finalized_order_id FROM shared_carts`, requête ajoutée avec la feature de trace comptable (`INSERT refunds`) postérieure au test ; (2) `result.status` au lieu de `result.contribution.status` — la fonction retourne maintenant `{ contribution, refundRowId }`, confirmé par le seul appelant réel (`routes/shared-cart-refund-admin.js`) qui destructure déjà cette forme. |
| cancel-shared-cart-with-refunds | logique métier shared-cart avec mocks DB. | ✅ **mock périmé** : même cause que ci-dessus — `refundOneContribution` fait désormais `UPDATE` → `INSERT refunds` (trace comptable) → `INSERT event`, le test ne mockait que 2 requêtes/contribution au lieu de 3. Queue de mock complétée pour les 2 contributions du scénario. |
| dashboard-ops-queries | assertions sur chaînes de requêtes. | ✅ **mock périmé** : liste `STAGES` attendue oubliait `'pending'`, présent dans le code réel (`services/dashboard-ops-queries.js`). |
| soft-auth | `req.user` non peuplé par le mock. | ✅ **2 bugs de fragilité du test** (pas un bug prod) : (1) `process.env.JWT_SECRET` était réassigné *après* le `require('../../middleware/soft-auth')`, qui capture le secret au chargement du module (même convention que `middleware/auth.js`) — tokens signés avec un secret jamais vu par le middleware ; (2) `makeToken()` par défaut ne pose pas de `jti`, donc le check `revoked_tokens` est sauté pour plusieurs tests qui mockaient quand même 2 appels DB — combiné à `jest.clearAllMocks()` qui ne vide pas la file `mockResolvedValueOnce`, des valeurs mockées non consommées fuitaient d'un test au suivant. `jti` ajouté où nécessaire, `clearAllMocks` → `resetAllMocks`. |
| authkey-client | client externe mocké. | ✅ **mock périmé (×2)** : (1) `result.countryCode`/`result.number` alors que `parseMobile()` retourne `{ country_code, mobile }` (snake_case, vérifié contre le code réel) ; (2) en profitant du passage, mock fetch du test C utilisait `.json()` alors que le code réel appelle toujours `.text()` puis `JSON.parse` — corrigé pour éviter une erreur interne silencieuse (rattrapée mais bruitait les logs). |

## Hors quarantaine, traité dans la même session
- `tests/integration/isweep-invariants.test.js` : garde `DATABASE_URL` ajouté
  (même pattern que `security-grid.test.js`), par cohérence avec les autres suites
  d'intégration — même si cette suite ne touche jamais la DB (lecture statique de
  fichiers source uniquement). Suite verte (7/7) avec `DATABASE_URL` fourni.
  Une assertion de `G5` était périmée (cherchait
  `recordProductPriceChange`/`auditProductStockChange`/`validatePublicationUpdate`
  dans `routes/products.js`, alors que cette logique a été déplacée dans
  `services/product-admin-service.js` — vérifié, bien wirée là-bas) — corrigée.

## Dette restante identifiée (hors scope P7-tests)
- `services/shared-cart-v4-settlement.js` : `openSettlement()` est du code mort
  (aucun appelant en prod). `isSettlementOpen`/`assertCartCanAcceptParticipantPayment`
  restent vivants et utilisés. À trancher dans un lot dédié : supprimer `openSettlement`
  ou le réaligner sur le modèle V4.1.

## DoD du lot P7-tests — ✅ atteint
Chaque suite triée **mock périmé** (réparé) vs **vrai bug** (corrigé + test gardé) vs
**modèle obsolète** (supprimé, justifié). Les 8 suites réparées sont retirées de
toute exclusion dans `.github/workflows/ci.yml` — la gate `unit` est désormais
verte et bloquante sur l'intégralité de `tests/unit` (51/51 suites).
