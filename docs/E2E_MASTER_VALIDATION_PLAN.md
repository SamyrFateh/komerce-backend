# E2E MASTER VALIDATION PLAN — KOMERCE

> Snapshot. Ordonné **par risque**, pas par feature. Objectif : fermer la proof
> debt argent/transaction avant toute exploitation sereine. AUDITED_HEAD
> `dcd6b46a`.

---

## Environnements

```
UNIT                mocks — déjà verts
LOCAL POSTGRES      docker postgres:18, schéma migré
TEST POSTGRES       CI éphémère (DATABASE_URL) — requis WAVE 0/1/2/3
STAGING             komerce staging (PAS prod)
PROVIDER SANDBOX    Stripe test, PayPal sandbox, AuthKey test
PROD READ-ONLY      lecture seule uniquement
```

| TEST CLASS | PROD ALLOWED | STAGING REQ | REAL DB REQ | EXT CREDS REQ |
|---|---|---|---|---|
| REAL_DB transaction | ❌ | non | ✅ | non |
| E2E navigateur mutant | ❌ | ✅ | ✅ | selon moyen |
| provider sandbox smoke | ❌ | ✅ | ✅ | ✅ |
| lecture / read-only | ✅ | — | non | non |

Recommandation (à **implémenter hors cette mission**) : runner **fail-closed** —
refuser toute suite mutante si `BASE_URL`/`DATABASE_URL` pointe une prod.

---

## WAVE 0 — REALITY / DB CONTRACT (bloquant tout le reste)

| TEST-ID | WHY | RISK COVERED | ENV | FIXTURE |
|---|---|---|---|---|
| W0-1 schema-from-migrations | build instance depuis `migrations/` **seules**, diff vs `schema_railway.sql` | DEBT-01/05 : DDL runtime hors migrations | LOCAL PG | LOW |
| W0-2 wallet-index-present | après boot, vérifier `idx_wtx_idempotency` existe | DEBT-01 : backstop idempotence | LOCAL PG | LOW |
| W0-3 alerts-red-proof (exec réelle) | exécuter `alerts-contract-red-proof.test.js` avec DATABASE_URL | RED-2/RED-2b (aborted, COMMIT silencieux) | TEST PG | LOW |
| W0-4 column-conformance | générer les colonnes réellement écrites (378 stmts) et confronter au dump | contrats SQL non spot-checkés | TEST PG | MEDIUM |

---

## WAVE 1 — MONEY (le cœur du risque)

| TEST-ID | WHY | RISK | ENV | FIXTURE |
|---|---|---|---|---|
| W1-1 stripe-nominal REAL_DB | prouver commit métier réel post-SAVEPOINT | DEBT-02 (FSF-05) | TEST PG + Stripe sandbox | MEDIUM |
| W1-2 stripe-stockBlocked REAL_DB | SAVEPOINT alerte + commande survit | P0-A réel | TEST PG | MEDIUM |
| W1-3 stripe-replay | double webhook même event → 1 seul effet | idempotence (FOR UPDATE) | TEST PG | MEDIUM |
| W1-4 paypal-capture + webhook race | parité + fallback | P0-B, POST_O8 stale | TEST PG + PayPal sandbox | HIGH |
| W1-5 wallet-100% REAL_DB | débit + idempotency_key + solde | DEBT-01 | TEST PG | MEDIUM |
| W1-6 wallet-double-credit-concurrent | 2 crédits même clé sans l'index → prouver le garde | DEBT-01 (TOCTOU) | TEST PG | HIGH |
| W1-7 collective-payment capture | contributions → ready → capture → order | shared-cart non audité | TEST PG | HIGH |
| W1-8 refund manual_cash | 202 / manual_required indépendant de l'alerte | P0-C | TEST PG | MEDIUM |

---

## WAVE 2 — PAYMENT DOWNSTREAM

pickup secret · loyalty · payment notification · invoice-ready · **public
invoice** · purchasing trigger — chacun en REAL_DB, en vérifiant *exactly once*
et l'observabilité en cas d'échec.

| TEST-ID | WHY | RISK | ENV |
|---|---|---|---|
| W2-1 pickup-secret reveal | génération/stockage hash, anti-bruteforce | sécurité non prouvée | TEST PG |
| W2-2 invoice-ready AuthKey | routing template (ancienne suspicion) | provider mock only | STAGING + AuthKey test |
| W2-3 purchasing-trigger exactly-once | 1 seul déclenchement | crash window (DEBT-07) | TEST PG |

---

## WAVE 3 — ORDER / PURCHASING

| TEST-ID | WHY | RISK | ENV |
|---|---|---|---|
| W3-1 purchasing whatsapp wa_url | vérifier `notes` PO persisté après COMMIT | **DEBT-03** | TEST PG |
| W3-2 per-item savepoint | échec 1 item ne casse pas les autres | P0-E | TEST PG |
| W3-3 repair-ordered-without-PO idempotent | repair rejouable | admin non audité | TEST PG |

---

## WAVE 4 — LOGISTICS

parcel → scan (forward-only) → receive → availability → pickup → QR →
cross-relais → brute force. `parcel_events` étant DDL runtime (DEBT-05), inclure
W0-1 en précondition.

---

## WAVE 5 — CATALOG / ECONOMIC / INVENTORY

import → enrichment → pricing → approval → override → publication → stock audit.
`NOT_FULLY_AUDITED` — priorité P2.

---

## WAVE 6 — BROWSER BUSINESS (staging, dé-conditionné)

| TEST-ID | WHY | RISK | ENV |
|---|---|---|---|
| W6-1 wallet-payment (no-skip) | fixtures approvisionnées → skip impossible | **DEBT-04** | STAGING + real DB |
| W6-2 cancel-refund (no-skip) | idem | DEBT-04 | STAGING |
| W6-3 API-fail → pas de loader infini | REX PR563 | non re-prouvé | STAGING |
| W6-4 session expiry / 401-403 states | états sans sortie | non vérifié | STAGING |

---

## WAVE 7 — RESILIENCE / CRASH / REPLAY

double webhook · double submit · mutation concurrente · provider timeout · DB
error · **crash post-COMMIT** (DEBT-07) · repair jobs · API 500/timeout.

---

## WAVE 8 — EXTERNAL PROVIDER SMOKES

AuthKey · Stripe sandbox · PayPal sandbox · Meta WhatsApp. Jamais SAFE sur mock.

---

## Format par test (gabarit à remplir à l'exécution)

```
TEST-ID
WHY / RISK COVERED
ENVIRONMENT · FIXTURE (LOW/MEDIUM/HIGH) · PRECONDITIONS
ACTION
EXPECTED HTTP/UI · EXPECTED DB · EXPECTED EXTERNAL EFFECT
IDEMPOTENCY ASSERTION · CLEANUP
MUTATING? · PROD FORBIDDEN?
```

---

## Ordre d'exécution recommandé

```
W0 (reality)  →  W1 (money)  →  W2 (downstream)  →  W3 (purchasing)
              →  W6 (browser argent dé-conditionné)  →  W7 (resilience)
              →  W4/W5/W8 (couverture large)
```

W0 et W1 ferment ~80% de la proof debt à plus haut risque pour un coût fixture
majoritairement LOW/MEDIUM.
