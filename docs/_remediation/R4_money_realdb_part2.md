# LOT R4 — PREUVES ARGENT REAL_DB (WAVE 1) — PARTIE 2/2

BRANCH / HEAD : même réserve que partie 1/2 — pas de `.git` réel fourni,
baseline locale sur l'arbre courant, HEAD non re-vérifiable. Postgres 16.14,
même instance/base que la partie 1/2 (`komerce_r3_check`, chargée via le
dump live + `ci-migrate.js`).

## CE QUI A ÉTÉ FAIT

Écriture de `tests/integration/wallet-refund-seams.test.js` (3 tests,
inexistants avant ce lot) :

1. **W1-5 wallet-100% REAL_DB** — `credit()` puis `debit()` contre une vraie
   Postgre : idempotency_key respecté sur crédit ET débit (rejouer avec la
   même clé = no-op, solde inchangé), solde insuffisant → `throw`, aucun
   débit partiel silencieux.
2. **W1-6 wallet-double-credit-concurrent** — deux appels `credit()`
   véritablement concurrents (2 connexions/transactions distinctes via
   `Promise.allSettled`), même `idempotency_key`. Assertion centrale : peu
   importe le mécanisme exact (l'un des deux résout en
   `{duplicate:true}` OU lève une violation de contrainte unique), **il ne
   doit jamais y avoir 2 lignes ni un solde doublé**. Vérifié : exactement 1
   ligne `wallet_transactions` pour la clé, solde crédité une seule fois.
3. **W1-8 refund manual_cash (P0-C)** — `refundCancelledOrder()` avec
   `createAlert` mocké en échec forcé dans le SAVEPOINT dédié : le contrat
   fonctionnel (202 + `manual_required:true`, commande reste `cancelled`,
   pas de transition vers `refunded`) doit survivre à cet échec — même
   pattern que W1-2/P0-A, dans un fichier différent (`admin-order-refund.js`).
   Rejoué une 2e fois (alerte réussie cette fois) pour prouver que l'échec
   précédent n'a pas laissé la commande dans un état bloquant.

## COMMANDES EXÉCUTÉES (RUN/PASS/FAIL réels)

```
bash -c 'set -a; source .env.test; set +a; npx jest tests/integration/wallet-refund-seams.test.js --runInBand'
```

| Test | Statut | Détail |
|---|---|---|
| W1-5 WALLET-100% | ✅ PASS | crédit 15000, re-crédit même clé → duplicate (solde inchangé 15000), débit 4000 → 11000, re-débit même clé → duplicate (11000 inchangé), débit surestimé → throw `Solde insuffisant`, 1 seule ligne tx pour la clé de débit |
| W1-6 WALLET-DOUBLE-CREDIT-CONCURRENT | ✅ PASS | 2 `credit()` concurrents même clé → 1 seule ligne `wallet_transactions`, solde = 20000 (jamais 40000) |
| W1-8 REFUND-MANUAL-CASH (P0-C) | ✅ PASS | alerte forcée en échec → 202/`manual_required:true` quand même, commande reste `cancelled`, rejeu après fix alerte → toujours 202 cohérent |

Zéro suite en SKIP. 3/3 PASS réel sur vraie Postgres.

## DÉCOUVERTE — W1-6, mécanisme réel de la protection

Instrumentation manuelle (`check_race_tmp.js`, script jetable, non livré)
pour comprendre **comment** le doublon est bloqué, pas seulement **que** ça
marche : les logs montrent que l'appel B ne démarre son `BEGIN` qu'**après**
que A ait committé — la protection réelle observée ici est le verrou
`SELECT ... FOR UPDATE` sur la ligne `wallets` dans `getOrCreateWallet()`
(les deux tentatives portent sur le **même** `userId` donc le **même**
wallet), pas directement une violation de la contrainte unique
`idx_wtx_idempotency` (qui reste un filet de sécurité en profondeur, utile
si jamais deux wallets différents partageaient la même clé par erreur
applicative). **Le SELECT de dédup dans `credit()` reste, lui, sans
`FOR UPDATE` — le TOCTOU documenté par la mission existe toujours en théorie**
pour deux transactions qui n'opèrent pas sur le même wallet, mais dans le
cas nominal (même user, même wallet) le verrou wallet suffit déjà à
empêcher le double-crédit avant même que l'index n'ait à intervenir.
Conclusion : le garde-fou global (verrou + index) fonctionne, prouvé en
conditions réelles ; l'index seul, isolément, n'a pas été déclenché dans ce
run précis — nuance à garder pour toute analyse future de DEBT-01.

## DoD ATTEINTE ?

**OUI** pour R4 dans son ensemble (parties 1/2 + 2/2 combinées) :
- W1-1, W1-2, W1-3 (Stripe) : PASS réel — partie 1/2
- W1-4 (PayPal) : RUN réel, verdict FAIL confirmé (faux-vert documentaire
  découvert et corrigé) — partie 1/2
- W1-5, W1-6, W1-8 (Wallet + Refund) : PASS réel — cette partie
- Aucune modif runtime argent : respecté sur l'ensemble du lot R4.
- Verdicts documentaires réalignés sur preuve exécutée (POST_O8, ALERTS) —
  partie 1/2 + clarification wallet ajoutée ici.

**Hors périmètre R4 (rappel, dette restante globale)** :
- W1-7 (collective-payment capture, shared-cart) n'était pas dans le lot
  demandé — resterait à couvrir si souhaité.
- Fix runtime PayPal post-commit (W1-4) — code non touché, lot dédié à
  prévoir.

## FICHIERS MODIFIÉS (cette partie)

```
tests/integration/wallet-refund-seams.test.js   (nouveau, 3 tests)
docs/POST_O8_BUSINESS_SEMANTIC_AUDIT.md         (clarification ligne "Wallet 100% downstream")
```
