# FULL STACK DEBT REGISTER — KOMERCE

> Snapshot. Non branché dans `map:check`. Les manifestations d'une même cause
> racine sont fusionnées (pas de gonflage en N dettes indépendantes).

AUDITED_HEAD `dcd6b46a` · AUDIT_DATE 2026-07-14 · 0 P0 PROVEN

---

### DEBT-01 — FSF-02 · Schéma monétaire wallet créé par DDL runtime, hors migrations

- **SEVERITY** P1
- **CONFIDENCE** HIGH_CONFIDENCE (reproductibilité) / SUSPECTED (double-crédit réel)
- **FEATURE** wallet
- **CATEGORY** DATA_CONTRACT · SCHEMA · TRANSACTION
- **DESCRIPTION** `wallets`, `wallet_transactions`, `wallet_credit_lots`,
  `wallet_consumptions`, l'index unique d'idempotence `idx_wtx_idempotency` et
  `orders.wallet_applied_kmf` sont créés par `ensureWalletTables()`
  (`services/wallet-service.js:43-110`), **absents de `migrations/`**. Le hook
  boot est post-`listen` et catch-swallowed. L'idempotence des crédits/débits
  wallet est un **read-then-insert** (`SELECT ... WHERE idempotency_key` puis
  INSERT) dont **le seul vrai backstop anti-double-crédit est cet index unique
  runtime**. Sans l'index (instance from-scratch, hook en échec silencieux), le
  TOCTOU n'a plus de garde.
- **EVIDENCE** `wallet-service.js:43,98,143` ; `bootstrap/server-lifecycle.js:59` ;
  absence dans `migrations/` (grep `CREATE TABLE.*wallet` → 0) ; présence dans
  `schema_railway.sql` (dump live, pas migration).
- **BUSINESS IMPACT** argent : double-crédit / double-débit possible si l'index
  manque ; contrat non reproductible ⇒ nouvel environnement fragile.
- **CURRENT MITIGATION** `getOrCreateWallet(... FOR UPDATE)` sérialise par
  wallet ; l'index existe *sur le live actuel*.
- **REQUIRED PROOF** REAL_DB : (1) instance from-migrations-only → vérifier
  présence tables/index ; (2) test concurrence double-crédit même
  `idempotency_key` sans l'index → prouver/infirmer le double-crédit.
- **RECOMMENDED ACTION** promouvoir le DDL wallet en migration versionnée +
  faire échouer le boot (fail-closed) si les tables/index manquent.
- **E2E LINK** WAVE-0 (schema reconstruction) · WAVE-1 (Wallet 100%)

---

### DEBT-02 — FSF-05 · 6 cas P0 alerts : contrat writer fermé, preuve E2E jamais exécutée

- **SEVERITY** P1 (en tant que **PROOF DEBT**, pas code)
- **CONFIDENCE** writer contract PROVEN · SAVEPOINT structure HIGH_CONFIDENCE ·
  commit métier réel NOT_PROVEN
- **FEATURE** payments, purchasing, refunds, cash
- **CATEGORY** DOCUMENTARY_TRUTH · TRANSACTION · TEST_DEPTH
- **DESCRIPTION** `LEGACY_ALERT_RUNTIME_WRITERS = 0` est vrai sur HEAD (vérifié).
  Les 6 cas P0-A..P0-F utilisent des SAVEPOINT corrects *à la lecture*. Mais la
  preuve bout-en-bout (vraies tables orders/PO + alerts, transaction qui commit
  réellement) **n'a jamais tourné** (auto-admis §12/§18 de
  `ALERTS_CONTRACT_RECOVERY_AUDIT.md`). De plus, `POST_O8` déclare ces chaînes
  `SAFE / REAL_DB` sur un HEAD **antérieur** aux SAVEPOINT ⇒ verdict STALE.
- **EVIDENCE** `payment-stripe.js:201-215`, `purchasing-trigger-service.js:294-305`,
  `docs/ALERTS_CONTRACT_RECOVERY_AUDIT.md §12`, `docs/POST_O8_...md` lignes SAFE.
- **BUSINESS IMPACT** faux sentiment de sécurité sur la couture argent↔alerte.
- **CURRENT MITIGATION** SAVEPOINT + tests unitaires (mocks) verts.
- **REQUIRED PROOF** exécuter `alerts-contract-real-db.test.js` + fixtures
  métier complètes, sur Postgres migré au schéma courant.
- **RECOMMENDED ACTION** *run REAL_DB* (aucun refactor). Puis rafraîchir les
  docs pour ne pas dépasser la preuve.
- **E2E LINK** WAVE-0 · WAVE-1

---

### DEBT-03 — FSF-03 · `wa_url` fournisseur perdu (write pool sur ligne non commitée)

- **SEVERITY** P2
- **CONFIDENCE** HIGH_CONFIDENCE (READ COMMITTED = défaut)
- **FEATURE** purchasing
- **CATEGORY** TRANSACTION · LIFECYCLE
- **DESCRIPTION** `notifySupplierWhatsApp` (`purchasing-trigger-service.js:84`)
  fait `db.query('UPDATE purchase_orders SET notes=$1 WHERE id=$2', [wa_url, po.id])`
  via le **pool**, alors que `po.id` vient d'un INSERT dans la **transaction
  encore ouverte** du même flux. La connexion pool ne voit pas la ligne non
  commitée ⇒ 0 ligne mise à jour ⇒ `wa_url` perdu.
- **EVIDENCE** `purchasing-trigger-service.js:84-105` (fonction) + `:260-266`
  (appel dans la boucle transactionnelle).
- **BUSINESS IMPACT** chemin fournisseur WhatsApp : lien de commande non
  persisté (perte d'info opérationnelle, pas d'argent).
- **CURRENT MITIGATION** aucune.
- **REQUIRED PROOF** REAL_DB : déclencher un purchasing `platform='whatsapp'` →
  vérifier `notes` de la PO après COMMIT.
- **RECOMMENDED ACTION** passer le `client` transactionnel à
  `notifySupplierWhatsApp` (écrire dans la même TX), ou déplacer l'écriture
  post-COMMIT.
- **E2E LINK** WAVE-3 (purchasing)

---

### DEBT-04 — FSF-04 · Preuves E2E argent conditionnelles (skip silencieux)

- **SEVERITY** P2
- **CONFIDENCE** PROVEN
- **FEATURE** wallet, refunds, orders
- **CATEGORY** TEST_DEPTH · GOVERNANCE_BLIND_SPOT
- **DESCRIPTION** `wallet-payment.spec.js` `if (balance<=0) test.skip()` ;
  idem `wallet-lifecycle`, `cancel-refund`, `order-history`, `stress-business`.
  Un run vert peut = skip total ⇒ ne prouve pas le paiement wallet. 26
  `test.skip()` conditionnels au total.
- **EVIDENCE** `public/boutique/tests/e2e/authenticated/wallet-payment.spec.js:44-66`.
- **BUSINESS IMPACT** vert trompeur sur la fonctionnalité argent la plus visible.
- **CURRENT MITIGATION** aucune (le skip *est* le problème).
- **REQUIRED PROOF** fixtures déterministes (compte de test approvisionné) qui
  rendent le skip impossible ; échec dur si précondition absente.
- **RECOMMENDED ACTION** transformer `test.skip()` argent en `beforeAll` qui
  *crée* la donnée, ou marquer la suite `expect(fixture).toBeTruthy()`.
- **E2E LINK** WAVE-1 · WAVE-6

---

### DEBT-05 — FSF-08 · DDL runtime (parcel_events, routing, ALTER parcels)

- **SEVERITY** P2 (même cause racine que DEBT-01)
- **CONFIDENCE** PROVEN (existence)
- **FEATURE** logistics, infrastructure
- **CATEGORY** SCHEMA · DATA_CONTRACT · GOVERNANCE_BLIND_SPOT
- **DESCRIPTION** `parcel-security.js:200` `CREATE TABLE IF NOT EXISTS
  parcel_events` + index ; `:238` boucle `ALTER TABLE parcels ADD COLUMN IF NOT
  EXISTS` ; `routing.js:160-164` `ALTER TABLE relais/orders ADD COLUMN`. Même
  angle mort que DEBT-01 vis-à-vis du gate schema-drift.
- **EVIDENCE** grep `CREATE TABLE IF NOT EXISTS|ADD COLUMN IF NOT EXISTS` →
  3 fichiers runtime.
- **BUSINESS IMPACT** reproductibilité from-scratch non garantie.
- **REQUIRED PROOF** build from-migrations-only + diff schéma vs live.
- **RECOMMENDED ACTION** promouvoir en migrations ; ajouter au gate un check
  « aucun DDL runtime dans services/ ».
- **E2E LINK** WAVE-0

---

### DEBT-06 — FSF-07 · E2E boutique ciblent la production par défaut

- **SEVERITY** P2
- **CONFIDENCE** HIGH_CONFIDENCE
- **FEATURE** frontend / ops
- **CATEGORY** DEPLOYMENT · TEST_DEPTH
- **DESCRIPTION** scripts `test:e2e:public` → `BASE_URL=https://komerce.co` ;
  suites mutantes (`stress-business`, `cancel-refund`) dans `authenticated/`.
  Exécuter mutant sur prod viole §27. Aucun script `:readonly` réel.
- **EVIDENCE** `public/boutique/package.json:44-49`.
- **REQUIRED PROOF** N/A (revue config).
- **RECOMMENDED ACTION** runner fail-closed : interdire les specs mutantes si
  `BASE_URL` = prod ; créer le script `:readonly` référencé.
- **E2E LINK** WAVE-6 · §27

---

### DEBT-07 — Crash window post-COMMIT (pas d'outbox)

- **SEVERITY** P2
- **CONFIDENCE** SUSPECTED
- **FEATURE** payments, notifications, purchasing, invoice, loyalty
- **CATEGORY** TRANSACTION · OBSERVABILITY
- **DESCRIPTION** effets post-COMMIT (notif, invoice-ready, loyalty, trigger
  purchasing) en fire-and-forget après `client.release()`. Crash entre COMMIT et
  hook ⇒ effet jamais rejoué, aucune trace (les hooks ne sont pas idempotents
  via une file persistée).
- **EVIDENCE** `payment-stripe.js:280-340`.
- **REQUIRED PROOF** test crash-window (kill après COMMIT).
- **RECOMMENDED ACTION** outbox transactionnelle (INSERT effet dans la même TX +
  worker rejouable).
- **E2E LINK** WAVE-7

---

### DEBT-08 — Observabilité : catch vides sur lectures dashboard

- **SEVERITY** P3
- **CONFIDENCE** PROVEN
- **CATEGORY** OBSERVABILITY
- **DESCRIPTION** `relay-dashboard-queries.js:254/262/271` `catch(e){}` avale des
  erreurs de lecture. 30 catch vides runtime au total (majorité = ROLLBACK
  best-effort légitime).
- **RECOMMENDED ACTION** logger a minima (`log.warn`) sur les catch de lecture.

---

### DEBT-09 — Réconciliation baseline / drift d'artefact généré

- **SEVERITY** P3
- **CONFIDENCE** PROVEN
- **CATEGORY** DOCUMENTARY_TRUTH · DEPLOYMENT
- **DESCRIPTION** le snapshot `monokomerce.zip` (sans `.git`) précède HEAD de
  ~1h ; 5 fichiers générés/CI drift (`META_GRAPH`, `BOUTIQUE_360`,
  `schema-refresh.yml`). Runtime identique. Rappel : ne jamais confondre un zip
  workspace avec la vérité `main`.
- **RECOMMENDED ACTION** régénérer les graphes avant tout snapshot d'audit.

---

### DEBT-10 — Feature First : écart de comptage & fidélité 360 non re-dérivée

- **SEVERITY** P3
- **CONFIDENCE** SUSPECTED
- **CATEGORY** GOVERNANCE_BLIND_SPOT
- **DESCRIPTION** 24 manifests vs « 28 features gouvernées » annoncées ; Feature
  360 non régénérée/comparée feature-par-feature dans cette passe.
- **RECOMMENDED ACTION** reconstruire la matrice de fidélité 360 (mission §7)
  dans une passe dédiée avec exécution des générateurs.

---

## Synthèse

```
P0  : 0
P1  : 2   (DEBT-01, DEBT-02)   ← dont 1 proof-debt pure (DEBT-02)
P2  : 5   (DEBT-03,04,05,06,07)
P3  : 3   (DEBT-08,09,10)

CODE DEBT  : DEBT-03, DEBT-05, DEBT-08, (partie de DEBT-01)
PROOF DEBT : DEBT-02, DEBT-04, (partie de DEBT-01), sécurité IDOR non exécutée,
             payments parité non prouvée REAL_DB
```
