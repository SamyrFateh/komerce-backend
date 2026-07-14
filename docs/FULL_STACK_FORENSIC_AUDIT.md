# FULL STACK FORENSIC AUDIT — KOMERCE

> Snapshot d'audit. **Ce document n'est pas une autorité Feature First.** Il
> n'est branché dans aucun gate, ne génère rien, et ne remplace aucune source
> de vérité existante. Il décrit un état à un instant, avec la hiérarchie de
> preuve de la mission.

---

## 1. Executive verdict

Komerce est un système à **gouvernance dense et honnête sur ses limites**, dont
la dette dominante n'est **pas** du code manifestement cassé mais de la **dette
de preuve** : les coutures argent/transaction les plus critiques sont
structurellement correctes à la lecture, mais leur preuve exécutable de bout en
bout (REAL_DB, navigateur, concurrence) **n'a pas été produite sur le HEAD
courant**, et plusieurs mécanismes de sécurité métier (idempotence wallet,
schéma monétaire) reposent sur du **DDL runtime invisible aux gates et aux
migrations**.

Aucun **P0 PROVEN** (argent perdu / corruption démontrée) n'a été trouvé sur ce
HEAD. Les angles morts de type PR563 (writer sur colonnes inexistantes, COMMIT
après transaction aborted) sont, sur le contrat `alerts`, **effectivement
fermés** : 0 writer legacy runtime, et les 6 cas P0 utilisent des SAVEPOINT
corrects *à la lecture*. Mais la preuve exécutée de ces 6 cas n'existe toujours
pas (auto-admise par l'audit de clôture lui-même).

Verdict final en §25.

---

## 2. Audited commit and environment

```
AUDITED_HEAD    dcd6b46a29bc29963764bd22a6b372efef185517
ORIGIN_MAIN     dcd6b46a29bc29963764bd22a6b372efef185517   (HEAD == origin/main)
BRANCH          main
WORKTREE_STATUS voir FSF-01 — le .git a été fourni séparément du working tree
AUDIT_DATE      2026-07-14
```

Log de tête (confirme la baseline attendue) :

```
dcd6b46a fix(ci): use official postgres:18 Docker image for pg_dump ...
3596cc22 fix(ci): force PG18 bin dir to front of PATH ...
45d54611 fix(ci): install postgresql-client-18 via PGDG repo ...
4cd0dbc5 fix(ci): retry+backoff schema-refresh ...
5757d83e lot correction ALERTS CONTRACT RECOVERY / FERMETURE DÉFINITIVE PR563
ad590543 lot refonte feature capabilities O8 closure 4
...
```

HEAD est bien **postérieur** à `O8 Feature 360 closure` et à
`ALERTS CONTRACT RECOVERY / PR563`. Les 4 commits de tête sont **CI-only**
(pg_dump / schema-refresh), sans impact runtime.

**Réconciliation des deux artefacts fournis (FSF-01)** : `monokomerce.zip` est
un snapshot du working tree pris ~1h avant HEAD ; il **ne contenait pas** de
`.git`. Le `.git` autoritatif a été fourni dans un second artefact
(`_github.zip`). Diff entre le HEAD Git matérialisé et le snapshot zip : **5
fichiers seulement**, tous des artefacts *générés* ou CI — `docs/META_GRAPH.*`,
`docs/BOUTIQUE_360.*` (regénérés, `generatedAt` postérieur) et
`.github/workflows/schema-refresh.yml` (dernier fix pg_dump). **Le code runtime
est byte-identique.** Conclusion : Git HEAD `dcd6b46a` prévaut ; l'audit a été
mené sur l'arbre Git matérialisé.

Limite d'environnement (honnête) : **aucune PostgreSQL** n'est disponible dans
le sandbox (pas de `psql`, réseau sortant restreint). Toutes les suites REAL_DB
ne peuvent donc être exécutées ici — cette limite est *identique* à celle
auto-déclarée par l'audit de clôture PR563 (§7/§12 de
`ALERTS_CONTRACT_RECOVERY_AUDIT.md`). Les findings « transaction » sont donc au
mieux `HIGH_CONFIDENCE` (lecture structurelle), jamais `PROVEN` par exécution.

---

## 3. Evidence hierarchy appliquée

```
CODE / RUNTIME réellement appelé  >  DOCUMENT CLAIM
PHYSICAL SCHEMA (schema_railway)  >  SQL ASSUMPTION
CURRENT HEAD                      >  OLD AUDIT REPORT
```

Contradiction majeure relevée et **non corrigée** (documentée) : les verdicts
`SAFE / REAL_DB_INTEGRATION` de `POST_O8_BUSINESS_SEMANTIC_AUDIT.md` sur les
chaînes Stripe/PayPal/Cash décrivent un HEAD **antérieur** aux SAVEPOINT
ajoutés par la clôture PR563 sur *ces mêmes fichiers*. Voir §19 et FSF-05.

---

## 4. Feature First integrity — PARTIEL

- 24 manifests `features/*.feature.js` présents. La mission référence « 28
  features gouvernées ». L'écart (24 vs 28) n'a **pas** été entièrement
  réconcilié dans cette passe (voir couverture §34 — `NOT_FULLY_AUDITED`). Les
  manifests dépréciés/duplicatifs (`auth` vs `auth-identity`, `wallet` vs
  `wallet-loyalty`) expliquent une partie de l'écart mais pas sa totalité de
  façon prouvée ici.
- Doctrine **WRITER != LIFECYCLE OWNER** : validée sur `orders` (l'autorité de
  transition est mécaniquement centralisée dans
  `services/order-status-machine.js` via `transitionOrderStatus`, avec
  `SELECT ... FOR UPDATE` + garde idempotente — voir §7). Non ré-audité
  exhaustivement pour `parcels`, `purchase_orders`, `shared_cart_events`,
  `wallet*` dans cette passe.

Statut : **INCOMPLETE** (pas de drift prouvé, mais fidélité non entièrement
reconstruite).

---

## 5. Feature 360 fidelity — NON RE-DÉRIVÉE

La projection Feature 360 n'a pas été régénérée ni comparée feature-par-feature
au runtime dans cette passe (coût/temps). **Limite de mandat identifiée** :
Feature 360 mesure la *santé de boundary* (imports croisés, contrats déclarés).
Elle **ne rend pas visible** une dette transactionnelle *interne* à une feature
« Boundary HEALTHY » — exactement le cas de FSF-02 (idempotence wallet couplée à
un DDL runtime) et FSF-03 (write pool sur ligne non commitée). Formulation
juste :

```
Feature 360 est correct pour la santé de boundary,
mais insuffisant comme santé sémantique runtime.
```

Ce n'est pas un défaut de Feature 360 ; c'est la limite de son mandat. Ne pas
étendre par réflexe.

---

## 6. Physical SQL contract — SPOT-CHECK

378 écritures SQL (`INSERT INTO` / `UPDATE ... SET`) recensées dans
`services/ routes/ utils/`. **Non** vérifiées colonne-par-colonne
intégralement. Spot-checks probants :

- `alerts` : le contrat legacy `(level, source, message, payload)` est
  **absent** du runtime — 0 occurrence. Seuls
  `type, entity_type, entity_id, severity, title, description` sont écrits
  (`utils/alerts.js`, `services/catalog-approval.js`). ⇒ contrat aligné sur
  `schema_railway.sql`. **PROVEN (statique).**
- `stripe_events_processed` : INSERT `(stripe_event_id, event_type,
  payload_summary)` ⊆ colonnes réelles. **PROVEN.**
- `wallets`, `wallet_transactions`, `wallet_credit_lots`,
  `wallet_consumptions`, `parcel_events`, `orders.wallet_applied_kmf` :
  **présents dans `schema_railway.sql`** — mais parce que ce fichier est un
  *dump du live*, pas un produit des migrations. Voir FSF-02/FSF-08.

SQL dynamique (`STATIC_PROVEN` vs `DYNAMIC_REVIEW_REQUIRED`) : non inventorié
exhaustivement. `NOT_FULLY_AUDITED`.

---

## 7. Transactions

50 fichiers ouvrent une transaction (`query('BEGIN')`). 74 `FOR UPDATE`, 0
`SKIP LOCKED`, 61 SAVEPOINT.

**Ce qui est bon (points de confiance, pas des findings) :**

- **Concurrence webhook argent : fermée.** `transitionOrderStatus`
  (`order-status-machine.js:196`) fait `SELECT ... FOR UPDATE` sur la ligne
  `orders` quand un client transactionnel est fourni, puis garde idempotente
  `previousStatus === newStatus → noop`. Deux livraisons Stripe/PayPal
  concurrentes se sérialisent sur le verrou de ligne ; la seconde no-op.
- **Stripe replay séquentiel : fermé.** Garde précoce
  `SELECT payment_status ... = 'paid' → skip` (`payment-stripe.js:143`) +
  `stripe_events_processed ON CONFLICT DO NOTHING`.
- **TX-E (provider externe dans TX) : pas sur les chemins argent.** Les captures
  Stripe/PayPal sont faites **avant** `BEGIN`. `callSupplierAPI` est un stub
  Phase 2 (`{success:false}`). Aucun `stripe.`/`paypal.capture` entre BEGIN et
  COMMIT sur les cycles de paiement.
- **6 cas P0 alerts (SAVEPOINT)** : structure correcte à la lecture
  (`SAVEPOINT → INSERT alerts → RELEASE`, sinon `ROLLBACK TO SAVEPOINT`), la
  transaction métier survit à un échec d'alerte. **HIGH_CONFIDENCE**, pas
  PROVEN (REAL_DB non exécuté).

**Findings transaction :**

- **FSF-03 (P2)** — `notifySupplierWhatsApp` (`purchasing-trigger-service.js:84`)
  écrit `wa_url` via `db.query` (**pool**) sur une ligne `purchase_orders`
  **INSÉRÉE dans la transaction encore ouverte** (client transactionnel).
  Sous READ COMMITTED (défaut Postgres), la connexion pool **ne voit pas** la
  ligne non commitée ⇒ `UPDATE ... WHERE id = $2` matche **0 ligne** ⇒ le
  `wa_url` du fournisseur est **silencieusement perdu**. Le chemin
  `platform = 'whatsapp'` du purchasing produit donc une PO sans lien de
  commande stocké. HIGH_CONFIDENCE (dépend de l'isolation ; READ COMMITTED =
  défaut). **Code debt.**

Reste `NOT_FULLY_AUDITED` : TX-A (catch SQL + continue) et TX-B (COMMIT après
aborted) au-delà du périmètre alerts ; TX-G (release/leak) sur les 50 owners.

---

## 8. Lifecycles — PARTIEL

Autorité `orders` mécaniquement centralisée (§7). Les writers directs
(`UPDATE orders SET status`) hors state-machine n'ont pas été inventoriés
exhaustivement dans cette passe. `NOT_FULLY_AUDITED` pour parcel/PO/wallet
lifecycles.

---

## 9. Payments — matrice de parité (partielle, voir E2E matrix)

Signature + dedupe présents pour Stripe (`constructEvent` + `express.raw` +
`stripe_events_processed`) et PayPal (`verifyWebhookSignature` délégué à PayPal
+ `paypal_events_processed`). Parité fine (loyalty / invoice-ready / pickup
secret par moyen) non re-prouvée ligne-à-ligne ici ; le document
`POST_O8_BUSINESS_SEMANTIC_AUDIT.md` la déclare SAFE mais sur un HEAD antérieur
(FSF-05). **Statut : YES_CODE_ONLY** pour l'essentiel des effets, à confirmer
REAL_DB.

---

## 10. Replay / concurrency / crash windows

- Séquentiel : couvert (§7).
- Concurrent double-delivery : **fermé** par `FOR UPDATE` (§7) — point de
  confiance.
- **Fenêtre crash post-COMMIT** : les effets post-commit Stripe (notifications,
  invoice-ready, loyalty, purchasing trigger) sont **fire-and-forget** après
  `client.release()`. Un crash process entre COMMIT et l'exécution du hook ⇒
  effet **jamais rejoué** (pas de file persistée / d'outbox). Observable ? Le
  `triggerPurchasing` en échec crée une alerte, mais un **crash** (pas une
  erreur) ne laisse aucune trace. `SUSPECTED` (P2) — pas d'outbox
  transactionnelle. Non prouvé par exécution.

---

## 11. Observability

30 `catch(e){}` vides en runtime (`services/routes/utils`). Majorité =
`try { ROLLBACK } catch(_){}` (légitime, best-effort). Sous-ensemble à
signaler : `relay-dashboard-queries.js:254/262/271` (`catch(e){}` sur des
requêtes de lecture dashboard) ⇒ `LOSS_OF_OPERATIONAL_SIGNAL` mineur. Verdict
reconstructibilité incident : **partiel** — les ids provider/order/event sont
loggés sur les chemins argent, mais l'absence d'outbox (§10) limite la
reconstruction d'un effet post-commit perdu.

---

## 12. Security — PARTIEL

Positifs vérifiés : webhooks Stripe/PayPal en `express.raw` + vérification de
signature ; dedupe event. **Non** audité exhaustivement dans cette passe :
sweep IDOR/BOLA par route mutante, scoping ownership `order_id`, tokens publics
(invoice/tracking/QR), pickup secret anti-bruteforce. Des sondes existent
(`tests/integration/relais-idor-probe.test.js`, `admin-authz-probe.test.js`)
mais **gardées `DATABASE_URL`** ⇒ non exécutées ici. `NOT_FULLY_AUDITED`.

---

## 13. Boutique frontend

- **FSF-04 (P2)** — specs E2E argent auto-skip sur données staging :
  `wallet-payment.spec.js` (`if balance<=0 → test.skip()`),
  `wallet-lifecycle.spec.js`, `cancel-refund.spec.js`, `order-history.spec.js`,
  `stress-business.spec.js`. Un run **vert** peut signifier **skip total** ⇒ ne
  prouve rien sur le paiement wallet. Exactement le pattern interdit (§15).
- **FSF-07 (P2)** — les scripts E2E boutique par défaut ciblent
  `BASE_URL=https://komerce.co/boutique/` (**production**). Des specs mutantes
  (`stress-business`, `cancel-refund`) vivent dans la suite `authenticated/`.
  Exécuter mutant sur prod viole la doctrine §27. Aucun script
  `test:e2e:business:readonly` n'existe (la commande §33 de la mission
  référence un script absent).

États success/empty/auth/error/retry par vue : **non** vérifiés mécaniquement
un par un ici (le REX PR563 « pas de loader infini » n'a pas été re-prouvé).

---

## 14. Admin / operations — NON AUDITÉ

Repairs (`repair-*.js`), idempotence des repairs, dryRun vs réel, auditabilité :
`NOT_FULLY_AUDITED` dans cette passe.

---

## 15. Schema / migrations

- **FSF-02 (P1)** — `wallets`, `wallet_transactions`, `wallet_credit_lots`,
  `wallet_consumptions` + l'index unique d'idempotence `idx_wtx_idempotency` +
  `orders.wallet_applied_kmf` sont créés par **DDL runtime**
  (`wallet-service.js:ensureWalletTables`), **absents des `migrations/`**. Le
  hook de boot (`bootstrap/server-lifecycle.js:59`) est **catch-swallowed**
  (`.catch(e => console.error(...))`) et s'exécute *après* `listen`. Une
  instance construite **uniquement depuis les migrations** n'a pas ces tables
  tant que wallet-service n'a pas booté avec succès.
- **FSF-08 (P2, même cause racine)** — même pattern pour `parcel_events`
  (`parcel-security.js:200`), colonnes `relais/orders` (`routing.js:160-164`),
  et une boucle `ALTER TABLE parcels ADD COLUMN IF NOT EXISTS`
  (`parcel-security.js:238`).

Réponse à la question centrale §17 :

```
Une nouvelle instance construite depuis zéro (migrations seules)
obtient-elle le même contrat que Railway ?
→ NOT_PROVEN.  (dépend de DDL runtime au boot, hors migrations, hors gate)
```

Nuance importante : `schema_railway.sql` **contient** ces objets, car c'est un
*dump du live* — donc le gate `arch-schema-drift-check` (qui compare le code au
dump) les voit « exister » et **ne signale rien**. C'est précisément l'angle
mort : le gate prouve « la table existe dans le dump live », pas « la table est
reproductible déterministiquement par migration ».

---

## 16. External providers — NON AUDITÉ (live)

Clients présents : `authkey-client.js`, `paypal-client.js`, `whatsapp-meta.js`,
Stripe SDK. Timeouts/retry/idempotence/sandbox-switch : `NOT_PROVEN_EXTERNAL`
(aucun smoke live possible dans le sandbox). Ne jamais marquer SAFE un provider
mocké.

---

## 17. Test suite forensics

- 382 fichiers de test backend, 35 specs Playwright boutique.
- **103** `test/describe/it.skip`, **11** `.todo`, **26** `test.skip()`
  conditionnels data-dépendants.
- Les skips conditionnels sur chemins **argent** (wallet, refund, stress) =
  `CRITICAL_PROOF_SKIPPED` (FSF-04).
- 19 fichiers de test gardent `DATABASE_URL` ⇒ **auto-skip sans Postgres**.
  Comme aucune Postgres n'est dispo, **toute la couche REAL_DB est
  non-exécutée** dans cet environnement (proof debt structurelle, pas un défaut
  des tests).
- Mocks DB : plusieurs suites reposent sur des mocks « par file d'attente »
  qui **n'modélisent pas** l'état `aborted` ni les contraintes uniques — c'est
  la classe de faux-vert que PR563 a révélée. Le test
  `alerts-contract-red-proof.test.js` documente correctement RED-2/RED-2b mais
  est lui-même garde-`DATABASE_URL` (non exécuté ici).

---

## 18. Governance gate blind spots

```
arch-schema-drift-check
  PROUVE      : la table/colonne référencée existe dans le dump live
  NE PROUVE PAS: qu'elle vient d'une migration (vs DDL runtime) → FSF-02/08
  NE PROUVE PAS: types SQL compatibles colonne-par-colonne
  NE PROUVE PAS: sémantique transactionnelle (aborted, savepoint)

alerts:contract:check
  PROUVE      : 0 writer legacy (level/source/message/payload) — SOLIDE
  NE PROUVE PAS: que les 6 P0 committent réellement (REAL_DB) → FSF-05

Playwright business (vert)
  NE PROUVE PAS: que le paiement wallet marche (peut skip total) → FSF-04
```

Question principale — *quels bugs graves restent mécaniquement invisibles ?* :
(a) DDL runtime hors migrations (reproductibilité), (b) perte d'update
cross-connexion sur ligne non commitée (FSF-03), (c) absence d'outbox
post-commit (crash window), (d) preuve argent E2E conditionnelle (FSF-04).

---

## 19. Documentary truth

`ALERTS_CONTRACT_RECOVERY_AUDIT.md` est **honnête** : il déclare lui-même
(§12/§18) que les 6 preuves P0 REAL_DB **n'ont pas été exécutées** faute de
Postgres.

`POST_O8_BUSINESS_SEMANTIC_AUDIT.md` affiche des verdicts
`SAFE / REAL_DB_INTEGRATION` pour Stripe/PayPal/Cash. **Mais** les fichiers
`payment-stripe.js` / `payment-paypal.js` ont été **modifiés après** (ajout des
SAVEPOINT par la clôture PR563). Donc ces verdicts « REAL_DB SAFE » décrivent un
**HEAD antérieur** → sur le HEAD courant ils sont **STALE /
ENVIRONMENT_NOT_REPRODUCED**. Règle appliquée : *un audit ne peut pas être plus
vert que le commit qu'il décrit.* Voir matrice dédiée.

---

## 20. CI / deployment — PARTIEL

Les 4 commits de tête sont des fixes CI pg_dump/schema-refresh (PG18 via Docker,
retry+backoff sur la race de déploiement Railway). Aucun log de déploiement
live n'est inspectable ici ⇒ tout statut deploy = `DEPLOY_FAILURE_NOT_ANALYZED`
par défaut. `railway.toml` : `releaseCommand = node scripts/migrate.js`. Les
tables wallet/parcel_events n'étant pas dans les migrations, `migrate.js` **ne
les crée pas** — cohérent avec FSF-02.

---

## 21. Feature-by-feature confidence

Passe **légère** (le mandat exhaustif par feature n'a pas été complété — voir
§34). Confiances synthétiques :

| Feature | Semantic confidence | E2E priority | Note |
|---|---|---|---|
| payments (stripe/paypal) | MEDIUM | P0 | code correct à la lecture, REAL_DB non exécuté (FSF-05) |
| wallet | LOW→MEDIUM | P0 | idempotence couplée à index runtime (FSF-02) |
| purchasing | MEDIUM | P1 | wa_url perdu (FSF-03) |
| orders (lifecycle) | HIGH | P1 | autorité centralisée + FOR UPDATE (point fort) |
| shared-cart / collective | LOW | P1 | non ré-audité en profondeur |
| logistics / pickup | LOW | P1 | parcel_events DDL runtime, anti-bruteforce non prouvé |
| refunds | LOW | P1 | E2E cancel-refund auto-skip |
| catalog / sourcing / inventory | LOW | P2 | non audité |
| auth / auth-identity | LOW | P2 | sondes IDOR non exécutées |
| autres (dashboard, customs, docs, loyalty, notifications, recommendations, economic-engine, incident, infrastructure, platform-ops, decision-signals, unsold-resolution) | UNPROVEN | P2/P3 | `NOT_FULLY_AUDITED` |

`SEMANTIC_CONFIDENCE = HIGH` n'est accordé qu'à `orders` (preuve structurelle du
verrou + garde idempotente).

---

## 22. Master business journeys

Reconstruits au niveau structurel (voir `E2E_MASTER_VALIDATION_PLAN.md` pour le
détail START/STEPS/EFFECTS/PROOF par journey A→K). Les journeys argent (B Stripe,
C PayPal, E Wallet, F Collective) ont tous la même signature de dette : **code
plausible, preuve REAL_DB absente**.

---

## 23. Top findings

Voir `FULL_STACK_DEBT_REGISTER.md` (registre complet) et le TOP 20 du résumé
final. Compte : **0 P0 PROVEN**, **2 P1** (FSF-02, FSF-05 en proof-debt),
**4 P2** (FSF-03, FSF-04, FSF-07, FSF-08), **~3 P3**.

---

## 24. Code debt vs proof debt

| Type | Findings | Remède |
|---|---|---|
| **CODE DEBT** | FSF-03 (wa_url perdu), FSF-08 (DDL runtime), partiellement FSF-02 | correction ciblée / migration |
| **PROOF DEBT** | FSF-05 (6 P0 REAL_DB), FSF-04 (E2E argent skip), payments parité, sécurité IDOR | **exécuter** REAL_DB / E2E — pas de refactor |

Distinction cardinale : **ne pas** relancer un cycle de modifications pour la
proof debt. Le remède de FSF-05 est *run REAL_DB test*, pas *re-corriger le
code*.

---

## 25. Final verdict

Voir le bloc de synthèse (confiances par axe + phrase finale + verdict) dans le
résumé de sortie. En une ligne :

> **P0 CODE REMEDIATION n'est PAS requise** (aucun P0 prouvé) — mais l'état
> réel est **AUDIT INCOMPLET sur territoires matériels** (REAL_DB, sécurité
> IDOR, features non-argent) **+ proof debt argent élevée**. Avant une
> exploitation sereine : exécuter la Wave 0/1 REAL_DB et dé-conditionner les
> E2E argent.
