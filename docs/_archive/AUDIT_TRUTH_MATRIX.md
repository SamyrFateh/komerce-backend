# AUDIT TRUTH MATRIX — KOMERCE

> Objectif : repérer les **faux verts**. L'honnêteté est le livrable, pas
> l'obtention de `PROVEN` partout. AUDITED_HEAD `dcd6b46a`.

Niveaux de preuve : `PROVEN_ON_CURRENT_HEAD` · `STALE` · `ARTIFACT_MISSING` ·
`ENVIRONMENT_NOT_REPRODUCED` · `OVERCLAIMED` · `CONTRADICTED_BY_CODE` ·
`NOT_AUDITED`.

| CLAIM | SOURCE | EXPECTED TRUTH | CURRENT HEAD EVIDENCE | PROOF LEVEL | VERDICT |
|---|---|---|---|---|---|
| `LEGACY_ALERT_RUNTIME_WRITERS = 0` | ALERTS_CONTRACT_RECOVERY §11 | aucun INSERT alerts(level,source,message,payload) | grep runtime = 0 occurrence ; seuls `type/entity_type/...` | statique | **PROVEN_ON_CURRENT_HEAD** |
| 6 P0 prouvés | ALERTS_CONTRACT_RECOVERY §6 | commit métier réel malgré échec alerte | SAVEPOINT corrects à la lecture ; REAL_DB **non exécuté** (auto-admis §12) | lecture | **ENVIRONMENT_NOT_REPRODUCED** |
| Stripe chain SAFE (REAL_DB) | POST_O8 §ligne 104 | commit réel prouvé sur DB | fichier modifié **après** (SAVEPOINT) ; preuve décrit HEAD antérieur | — | **STALE** |
| Cash chain SAFE (REAL_DB) | POST_O8 §105 | idem | idem | — | **STALE** |
| PayPal post-commit SAFE (REAL_DB) | POST_O8 §106 | parité prouvée | idem, + verifyWebhookSignature présent mais non exécuté live | — | **STALE** |
| invoice-ready SAFE | POST_O8 §103 | routing template correct | code présent, provider mocké | mock | **ENVIRONMENT_NOT_REPRODUCED** |
| PayPal SAFE (global) | POST_O8 | parité complète | signature+dedupe présents ; REAL_DB non exécuté | code | **ENVIRONMENT_NOT_REPRODUCED** |
| alerts contract closed | ALERTS_CONTRACT_RECOVERY | dette fermée | writer contract fermé (PROVEN) ; preuve transactionnelle non exécutée | mixte | **PARTIEL** (writer PROVEN / tx ENV_NOT_REPRODUCED) |
| concurrent webhook safe | (implicite payments) | pas de double-processing | `SELECT ... FOR UPDATE` + garde idempotente `order-status-machine.js:196` | lecture | **PROVEN_ON_CURRENT_HEAD (par code)** |
| Stripe replay séquentiel safe | payment-stripe I-07 | 1 seul effet | garde `payment_status='paid'` + ON CONFLICT | lecture | **PROVEN_ON_CURRENT_HEAD (par code)** |
| REAL_DB validated | POST_O8 / clôture | suites REAL_DB vertes | aucune Postgres dans sandbox ; suites auto-skip | — | **ENVIRONMENT_NOT_REPRODUCED** |
| E2E validated (business) | boutique e2e | parcours argent prouvés navigateur | specs argent `test.skip()` conditionnels | — | **OVERCLAIMED** (peut skip total) |
| all tests green | KNOWN_FAILING_TESTS « RÉSORBÉE » | 0 suite rouge | non ré-exécuté ici ; 9 suites déclarées réparées | doc | **NOT_AUDITED (non ré-exécuté)** |
| map:check green | ALERTS §11 | gate vert | non exécuté ici (générateurs non lancés) | doc | **NOT_AUDITED** |
| schema drift = 0 | arch:gate | code ⊆ schéma | vrai vs dump live, mais dump inclut DDL runtime | statique | **PROVEN mais TROMPEUR** (voir FSF-02/08) |
| build from scratch == Railway | (implicite) | reproductibilité | wallet/parcel_events/routing = DDL runtime hors migrations | — | **CONTRADICTED_BY_CODE** (NOT_PROVEN) |
| wallet idempotent | wallet-service | pas de double-crédit | read-then-insert + index unique **runtime** | lecture | **SUSPECTED** (backstop non versionné) |
| purchasing whatsapp OK | purchasing | wa_url persisté | write pool sur ligne non commitée → 0 row | lecture | **CONTRADICTED_BY_CODE** (FSF-03) |
| O7 CLOSED / O8 CLOSED | LOT_O7/O8 livrables | lots fermés | non ré-audité feature-par-feature | doc | **NOT_AUDITED** |
| CROSS imports = 0 / cycles = 0 | O7.3 boundary | pas d'import croisé | non re-dérivé (générateur non lancé) | doc | **NOT_AUDITED** |
| Feature boundary healthy | Feature 360 | boundary saine | vrai *pour la boundary* ; muet sur dette tx interne | doc | **PARTIEL (mandat limité)** |
| deployment healthy | CI/Railway | deploy vert | logs live non inspectables ici | — | **DEPLOY_FAILURE_NOT_ANALYZED** |
| Baseline = zip fourni | prompt | zip == main | zip sans .git, ~1h stale, 5 fichiers générés drift | git | **STALE (git HEAD prévaut)** |

---

## Lecture rapide des faux verts

1. **Toute la couche REAL_DB** = `ENVIRONMENT_NOT_REPRODUCED` ici et (auto-admis)
   dans la clôture PR563 → le « vert » unitaire ne prouve pas le commit métier.
2. **POST_O8 « REAL_DB SAFE » argent** = `STALE` : le code a changé après la
   preuve.
3. **E2E business vert** = `OVERCLAIMED` : peut avoir tout skippé.
4. **schema drift = 0** = vrai mais **trompeur** : compare au dump live, qui
   masque le DDL runtime hors migrations.

L'écart réel de Komerce n'est pas « peu de tests » — c'en est beaucoup — mais
l'espace entre *vérité déclarée*, *vérité du code*, *vérité physique du runtime*
et *preuve réellement exécutée*.
