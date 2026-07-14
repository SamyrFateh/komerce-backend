# LOT R4 — PREUVES ARGENT REAL_DB (WAVE 1) — PARTIE 1/2

BRANCH / HEAD : pas de `.git` réel fourni cette session (même réserve que R1
§0 : baseline locale `9b51613` initialisée sur l'arbre de `monokomerce.zip`,
HEAD réel non re-vérifiable). Postgres **16.14** (contrainte réseau identique
à R1 : pas de docker, `postgresql-18` indisponible en apt).

Pré-requis vérifiés avant de démarrer : R1 clos (deliverables +
`R1_realdb_truth.md`, DoD OUI avec réserves), R2 mergé (confirmé, migrations
`014c/d/e` présentes), R3 clos (fix `client.query` + test W3-1 REAL_DB
rouge-avant/vert-après confirmés dans cette même session).

## CE QUI A ÉTÉ FAIT

1. **Fix d'import** (périmètre R4 : `tests/integration/`) —
   `post-o8-payments-seams.test.js` importait `./test-harness/seed-helpers`
   (n'exporte que `createUser/tokenFor/revoke/cleanup`) au lieu de
   `./test-harness/seed-helpers.EXTENDED` (seul fichier exportant
   `createTestRelais/createLegacyProduct/createPendingOrder/createOrderItem/
   cleanupBusinessFixtures`). Bug de test isolé — confirmé en comparant aux
   9 autres fichiers `tests/integration/*.test.js` qui importent la base à
   raison (ils n'ont besoin que de `createUser/cleanup`).
2. **W1-4 (PayPal capture + webhook + race, P0-B)** — suite déjà écrite,
   débloquée par le fix ci-dessus, ré-exécutée REAL_DB.
3. **W1-1 / W1-2 / W1-3 (Stripe nominal / stockBlocked / replay)** — suites
   inexistantes, écrites dans ce lot : `tests/integration/stripe-payment-seams.test.js`,
   sur le même gabarit que la suite PayPal existante (lifecycle réel REAL_DB,
   seuls les hooks fire-and-forget sont spied).
4. Réalignement des verdicts dans `docs/POST_O8_BUSINESS_SEMANTIC_AUDIT.md`
   et `docs/ALERTS_CONTRACT_RECOVERY_AUDIT.md` sur la preuve réellement
   exécutée dans cette session (voir DÉCOUVERTES).

## COMMANDES EXÉCUTÉES (RUN/PASS/FAIL réels)

```
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/komerce_r3_check \
  node scripts/ci-migrate.js
→ [ci-migrate] Baseline git : 105 migration(s) au commit 9b51613f
→ [ci-migrate] Rien à appliquer — dump à jour. exit 0
```

| Suite | Statut | Détail |
|---|---|---|
| `tests/integration/post-o8-payments-seams.test.js` (PayPal, W1-4/P0-B) | 🔴 FAIL (réel, pas d'infra) | 3/3 — `hooks.loyalty/notif/invoice/purchasing` reçoivent 0 appel sur les 3 tests. Confirmé par lecture : `payment-paypal.js` ne `require()` aucun des 4 modules. |
| `tests/integration/stripe-payment-seams.test.js` — W1-1 STRIPE-NOMINAL | ✅ PASS | order paid+ordered, stock 10→8, `stripe_events_processed` inséré, hooks×1, `triggerPurchasing(order.id)`×1 |
| `tests/integration/stripe-payment-seams.test.js` — W1-2 STRIPE-STOCKBLOCKED (P0-A) | ✅ PASS | `createAlert` mocké en échec forcé dans le SAVEPOINT → transaction principale COMMIT quand même (order `paid`, note `paid_but_stock_blocked`), stock inchangé (1), hooks NON tirés (processedOk=false) |
| `tests/integration/stripe-payment-seams.test.js` — W1-3 STRIPE-REPLAY | ✅ PASS | 2e delivery du même `event.id` → `idempotent:true`, stock inchangé (7, décrémenté une seule fois), hooks non re-tirés |

Zéro suite en SKIP dans ce lot. Logs bruts non conservés au-delà de la
session (à rejouer via les commandes ci-dessus si besoin).

## PREUVE PRODUITE

- `tests/integration/stripe-payment-seams.test.js` (nouveau, 3 tests)
- `tests/integration/post-o8-payments-seams.test.js` (1 ligne : chemin d'import)
- Sorties Jest complètes vues en session (voir tableau ci-dessus pour le
  résumé ; ce rapport ne duplique pas les logs bruts par souci de longueur —
  à régénérer si archivage formel souhaité)

## DoD ATTEINTE ?

Partielle — **OUI pour le périmètre traité** (W1-1, W1-2, W1-3, W1-4), **NON
pour le lot R4 complet** (W1-5, W1-6, W1-8 restent en partie 2/2, décision
explicite de l'utilisateur de scinder R4 en 2).

- Chaque preuve du périmètre : RUN + statut réel ✅
- Verdicts SAFE/REAL_DB de POST_O8 confirmés ou rétrogradés avec date+détail ✅
  (Stripe confirmé SAFE avec preuve ; PayPal rétrogradé BROKEN, faux-vert
  documentaire découvert et corrigé)
- Aucune modif runtime argent : ✅ respecté — le hook PayPal manquant n'a
  **pas** été corrigé (hors périmètre R4, découverte documentée pour lot dédié)

## FICHIERS MODIFIÉS

```
tests/integration/stripe-payment-seams.test.js       (nouveau)
tests/integration/post-o8-payments-seams.test.js     (fix import, 1 ligne)
docs/POST_O8_BUSINESS_SEMANTIC_AUDIT.md              (verdicts réalignés)
docs/ALERTS_CONTRACT_RECOVERY_AUDIT.md               (flag CLAIM_UNPROVEN tranché)
.env.test                                             (infra test, déjà existant depuis R1)
```

## DETTE RESTANTE / DÉCOUVERTES

1. **PayPal post-commit toujours cassé** (W1-4/P0-B) : `payment-paypal.js`
   ne déclenche ni loyalty, ni notification paiement, ni invoice-ready, ni
   purchasing trigger — sur capture directe, webhook fallback, ET le
   scénario race. C'est une régression ou un fix jamais mergé sur ce HEAD ;
   le doc l'annonçait "corrigé" à tort. **Hors périmètre R4** (proof debt
   only) — nécessite un lot de code dédié (candidat : brancher les 4 hooks
   dans `payment-paypal.js` sur le même pattern que `payment-stripe.js`
   lignes ~ post-COMMIT).
2. Partie 2/2 de R4 à faire : W1-5 (wallet 100%), W1-6 (double-crédit
   concurrent, avec/sans index — le plus critique, cf. `idx_wtx_idempotency`
   de R1/R2), W1-8 (refund manual_cash/P0-C). Aucun test existant pour ces
   3 preuves — à écrire, même méthode (lifecycle réel REAL_DB, provider/hook
   spied).
3. Réserve Git inchangée depuis R1 : aucun HEAD réel vérifiable dans cette
   série de sessions (zip sans `.git`). Les résultats restent malgré tout
   des preuves d'exécution réelle contre une vraie Postgres — indépendantes
   de la question de provenance Git.
