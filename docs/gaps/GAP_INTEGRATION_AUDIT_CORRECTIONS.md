# GAP — Corrections issues de l'audit des abstractions d'intégration

> **Destinataire** : agent d'exécution (Sonnet / Codex)
> **Auteur** : architecte (Opus) — aucune ligne de code de production, aucune PR de correction
> **Base** : `origin/main` @ `a13d87fe5` (post-#1699) ; PR #1700 ouverte
> **Source** : `docs/audits/INTEGRATION_ABSTRACTIONS_AND_ARCHITECTURE_AUDIT_V1.md`
> **Règle de conception** : on corrige une divergence démontrée, on ne crée aucune abstraction nouvelle. Aucun moteur central, aucun bus d'événements global, aucun writer transversal, aucun branchement provider dans le cœur métier.

---

## État d'exécution — mis à jour au fil des GAP

> Seule section à mettre à jour pendant l'exécution. Le corps (GAP-0 → GAP-7) est la spécification stable.

| GAP | Sujet | Priorité | Statut | PR | Notes |
|-----|-------|----------|--------|-----|-------|
| **GAP-1** | Wallet appliqué après coup → cycle canonique | **Haute** (argent + stock) | ⏳ À faire | — | Première tranche recommandée |
| **GAP-2** | Webhook WhatsApp : ne plus journaliser le corps brut | **Haute** (données personnelles) | ⏳ À faire | — | Indépendant de GAP-1 |
| **GAP-3** | Resynchroniser le registre provider + en-têtes périmés | Moyenne | ⏳ À faire | — | Documentation / gouvernance |
| **GAP-4** | Recadrer la PR #1700 avant merge | Moyenne | ⏳ À faire | #1700 | Coordination avec l'auteur de #1700 |
| **GAP-5** | Capter les statuts de livraison WhatsApp | Moyenne | ⏳ À faire | — | Après GAP-2 (même fichier) ; preuve externe requise |
| **GAP-6** | Petits correctifs de cohérence | Faible | ⏳ À faire | — | 7 correctifs indépendants |
| **GAP-7** | Ménage structurel du repo | Faible | 🔒 DEFER | — | Décision du propriétaire requise avant tout déplacement |

**Ordre et dépendances** : GAP-1, GAP-2 et GAP-3 sont indépendants et parallélisables. GAP-5 après GAP-2. GAP-4 avant tout raccordement d'un consommateur à Catalog Change Intake. GAP-6 à tout moment. GAP-7 jamais sans arbitrage.

---

## Comment lire ce document

Chaque GAP suit le même gabarit : **Problème → Preuve → Fichiers actuels → Contrat cible → Delta minimal → Fichiers touchés → Tests requis → Migration ? → Risque → Critères d'acceptation**. Un GAP = une PR. Ne pas regrouper deux GAP dans une même PR.

Avant chaque GAP : relire la section « Preuve » dans le code réel (le code a pu bouger), puis prouver la plus petite brique. Pas d'E2E pour découvrir un défaut élémentaire.

---

## GAP-0 — Baseline (ce qui est déjà correct, à ne pas re-litiger)

- **Paiement** : `services/order-payment-confirmation.js#confirmPaymentCycle` est le point d'entrée unique (doctrine `confirmPaymentCycle_unique`). Seuls `payment-service.js` (markPaid/markRefunded/markFailed, gardés par `payment-status-validator`) et `order-status-machine.js` écrivent `payment_status`. Stripe, PayPal, Mobile Money, cash et **checkout wallet** passent tous par `confirmPaymentCycle` et gèrent `stockBlocked`.
- **Purchasing** : GAP-1 → GAP-7 de `GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md` mergés (#1596 → #1608).
- **Logistique** : `scan-engine.js` est owner du statut colis. `routes/parcels.js`, `routes/carriers.js` et `parcel-security.js` n'écrivent pas le statut (poids, champs douane, code externe).
- **Prix engagés** : aucun code ne réécrit le prix d'une ligne de commande ; `order-cost-snapshot.js` fige les imputations.
- **Aucune intégration transporteur externe** : ne pas créer de contrat de traduction transporteur (aucune source à traduire).

---

## GAP-1 — Wallet appliqué après coup → cycle canonique de confirmation

### Problème
Quand un client applique son wallet **après** création de la commande (`POST /api/wallet/apply`) et que le wallet couvre le reste à payer, la commande passe `payment_status='paid'` **sans** `confirmPaymentCycle` : pas de décrément de stock `FOR UPDATE`, pas de contrôle `stockBlocked`, pas de transition de statut, pas de facture, **pas de code de retrait client**.

### Preuve
- `routes/wallet.js:97` `router.post('/apply')` → `walletService.applyToOrder(client, …)` (l.130) → `COMMIT` (l.135).
- `services/wallet-service.js` : si `remainingToPay <= 0`, appel direct `markPaid(orderId, { client })` (l.406). **Zéro** occurrence de `confirmPaymentCycle` ou `stockBlocked` dans le fichier.
- Le chemin équivalent au checkout le fait correctement : `services/order-checkout-persistence.js#completeWalletFullPayment` appelle `confirmPaymentCycle` (`source: 'wallet_full_payment'`), renvoie 409 si `stockBlocked`, puis `ensureSecretGenerated` (code de retrait). Son propre commentaire : *« Sans cet appel : status reste 'pending', stock non décrémenté, machine contournée. »*
- Aucun rattrapage : 0 requête ciblant `payment_status='paid' AND status='pending'` dans `services/`, `routes/`, `scripts/`.
- Le test existant `tests/unit/wallet-service.test.js` (~l.451-462) valide `markPaid` sans jamais vérifier le cycle.

### Fichiers actuels
`routes/wallet.js`, `services/wallet-service.js`, `services/order-checkout-persistence.js`, `services/order-payment-confirmation.js`.

### Contrat cible
Il n'existe qu'**une seule** façon de finaliser une commande intégralement payée par wallet : celle de `completeWalletFullPayment`. Les deux chemins (checkout et application après coup) produisent le même état final : même statut, stock décrémenté une fois, même code de retrait, même comportement en cas de stock insuffisant.

### Delta minimal
1. Rendre `completeWalletFullPayment` réutilisable (l'exporter depuis `order-checkout-persistence.js` s'il ne l'est pas — **ne pas la dupliquer**).
2. Dans `applyToOrder`, branche `remainingToPay <= 0` : remplacer l'appel direct à `markPaid` par l'appel au cycle canonique, dans **la même transaction** (`client`).
3. Le relais nécessaire à `ensureSecretGenerated` est lu depuis la commande côté serveur (jamais depuis le body).
4. Si `stockBlocked` : lever une erreur typée (409) → le `ROLLBACK` déjà présent dans `routes/wallet.js` annule le débit wallet et `wallet_applied_kmf`. Aucune commande ne reste `paid` sans stock.
5. Ne pas modifier la branche « wallet partiel » (`remainingToPay > 0`).

⚠️ À vérifier en premier : `confirmPaymentCycle` appelle-t-il lui-même `markPaid`, ou l'appelant doit-il le faire avant ? Reproduire **exactement** l'ordre utilisé au checkout (`applyWalletDebit` puis `completeWalletFullPayment`), sans deviner.

### Fichiers touchés
`services/wallet-service.js`, `services/order-checkout-persistence.js` (export uniquement), `routes/wallet.js` (mapping 409 uniquement si nécessaire), `tests/unit/wallet-service.test.js`, nouveau `tests/integration/wallet-apply-full-payment-real-db.test.js`.

### Tests requis
- **Unitaire** : la branche 100 % appelle le cycle canonique avec le même `client` ; la branche partielle n'y touche pas.
- **PostgreSQL jetable** (pattern `*-real-db.test.js`, avant/delta, jamais de comptage absolu) :
  1. Stock suffisant → `paid`, stock décrémenté **une** fois, statut identique au checkout wallet complet, code de retrait présent.
  2. Stock insuffisant → 409, commande non `paid`, débit wallet **non** persisté, `wallet_applied_kmf` inchangé.
  3. Rejeu (`idempotencyKey checkout_${orderId}`) → aucun double débit, aucun double décrément.
- Pas d'E2E, pas de Golden, aucun provider externe.

### Migration ?
Non.

### Risque
Faible et localisé. Revert trivial (un seul point de branchement). Risque principal : ordre des appels différent du checkout → le neutraliser en réutilisant la fonction existante.

### Critères d'acceptation
- [ ] `grep markPaid services/wallet-service.js` ne montre plus d'appel direct dans la branche 100 %.
- [ ] Les 3 cas PostgreSQL passent ; la suite unitaire complète reste verte.
- [ ] Aucun nouveau writer de `payment_status` (`arch-header-sql-check` vert).
- [ ] `feature-audit --strict`, `feature-guard --strict`, `contract-check` verts.

---

## GAP-2 — Webhook WhatsApp : ne plus journaliser le corps brut

### Problème
`routes/meta-whatsapp.js` `POST /webhook/meta-whatsapp` exécute `log.info('[META-WA][WEBHOOK]', JSON.stringify(body))` : numéros de téléphone et contenus de messages clients écrits en clair dans les logs.

### Preuve
`routes/meta-whatsapp.js` l.~89 (après `verifyMetaSignature`).

### Contrat cible
Le webhook ne journalise qu'un résumé borné et non personnel : type d'événement (`statuses` / `messages`), nombre d'entrées, identifiant technique `wamid` si présent, statut (`sent/delivered/read/failed`). Jamais de numéro, de nom, ni de texte de message.

### Delta minimal
Remplacer la ligne de log par une fonction pure `summarizeMetaWebhook(body)` (dans le même fichier ou `services/notifications/`), exportée pour test. Comportement HTTP inchangé (200 / 500).

### Tests requis
Unitaire (supertest + signature valide) : le logger n'est jamais appelé avec un numéro ou un texte présent dans le payload ; le résumé contient le type et le statut.

### Migration ?
Non. **Hors code** : informer le propriétaire que les logs Railway historiques contiennent ces données (décision de purge hors périmètre de ce GAP).

### Risque
Très faible.

### Critères d'acceptation
- [ ] Aucune donnée personnelle dans les logs pour un payload `statuses` et un payload `messages` de test.
- [ ] Réponse HTTP inchangée ; signature toujours vérifiée.

---

## GAP-3 — Resynchroniser le registre provider et les en-têtes périmés

### Problème
Les métadonnées que les agents lisent en premier sont fausses.

### Preuve
- `governance/external-provider-registry.json` : `paypal.highest_proof = UNQUALIFIED` alors que la PR #1698 a archivé une preuve P1 Sandbox (create/readback) et que `tests/unit/paypal-sandbox-order-contract-proof.test.js` existe.
- `brevo` déclaré consommé par `notifications` : 0 référence dans `services/` et `routes/`.
- `twilio`, `africas-talking` : aucun consommateur déclaré.
- `services/suppliers/execution-adapter-registry.js` : l'en-tête décrit GAP-4 comme futur alors que GAP-4A/4B est mergé (#1601) et que le gate est branché dans `purchasing-trigger-service.js`.

### Delta minimal
1. **PayPal** : relire l'archive de preuve de #1698 et les critères P1 de `docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md`. Ne passer à `P1` **que si** l'archive satisfait ces critères (Sandbox ≠ Production : le qualifier explicitement si le schéma le permet). Sinon, documenter pourquoi elle reste `UNQUALIFIED`.
2. **Brevo / Twilio / Africa's Talking** : `consumers: []` + note « déclaré, non intégré », ou retrait si l'inventaire le permet. Ne pas supprimer d'un fichier de gouvernance sans vérifier ce que lit `scripts/external-provider-boundary-scan.js`.
3. Corriger l'en-tête de `execution-adapter-registry.js` (état réel post-GAP-4/5).

### Tests requis
`external-provider-boundary-scan` et `external-provider-batch-proof` restent verts ; `tests/unit/external-provider-boundary-scan.test.js` vert.

### Migration ?
Non.

### Risque
Très faible. Seul piège : surclasser PayPal sans preuve conforme — interdit par l'invariant « UNKNOWN ne devient jamais PASS ».

### Critères d'acceptation
- [ ] Chaque niveau `highest_proof` renvoie à une preuve archivée ou reste `UNQUALIFIED`.
- [ ] Aucun provider déclaré consommé sans code réel.

---

## GAP-4 — Recadrer la PR #1700 (Catalog Change Intake) avant merge

### Problème
L'enveloppe `catalog-change-intake.js` est saine mais **sans consommateur**. Le contrat `catalog-provider-capability-contract.js` déclare aussi des capacités d'écriture et d'exécution déjà possédées ailleurs.

### Preuve
- `@used-by: future catalog change application owner` — aucun appelant.
- `CAPABILITIES` inclut `purchase`, `atomic_reservation`, `stock_write`, `price_write`, `content_write`, `publication_write`.
- La capacité d'achat est **déjà** exprimée par `services/suppliers/supplier-fulfillment-adapter-contract.js` (`placeOrder` + `buildOrderPayload`), consommé par 4 frontières (readiness, gate, execution boundary, confirmation boundary).
- Sourcing possède déjà : `sourcing_observations` (`observed_at`, `normalized`, `field_provenance`, `raw_fragment`), `sourcing_observation_evidence`, `sourcing_source_provides` (`catalog/offers/units`), `sourcing_source_execution_modes` (`human/api`).
- **Pas un doublon** : `normalized-product.js` normalise un produit complet (découverte), l'enveloppe #1700 des faits partiels (maintenance). Rôles différents.

### Delta minimal (sur la branche de #1700, en coordination avec son auteur)
1. Limiter `CAPABILITIES` aux capacités de **lecture et de réception** : `discovery`, `exact_read`, `change_feed`, `webhook`, `stock_read`, `price_read`, `offer_status_read`, `media_read`. Les capacités d'écriture/exécution restent dans Purchasing (achat, réservation) et Catalog (publication).
2. Documenter dans `DOCTRINE_CATALOG_CHANGE_INTAKE.md` : premier consommateur = owner d'observation Sourcing (écriture dans `sourcing_observations`), **pas** de nouvelle table ; correspondance `sourcing_source_provides.layer` ↔ capacités de lecture.
3. Ne raccorder aucun consommateur dans #1700 : le raccordement fera l'objet d'un GAP dédié après merge.

### Tests requis
Tests unitaires existants de #1700 adaptés (capacité d'écriture refusée).

### Migration ?
Non.

### Risque
Organisationnel : #1700 appartient à une autre session. Proposer ces changements en revue plutôt que de pousser sur sa branche sans accord.

### Critères d'acceptation
- [ ] Aucune capacité d'écriture/exécution dans le contrat de #1700.
- [ ] La doctrine nomme explicitement le premier consommateur et interdit une table parallèle.

---

## GAP-5 — Capter les statuts de livraison WhatsApp

### Problème
Le webhook reçoit `sent/delivered/read/failed` mais les ignore (`// Ici plus tard`) ; l'identifiant de message (`wamid`) n'est pas conservé à l'envoi. Komerce ne peut jamais prouver qu'un client a reçu un message.

### Preuve
`routes/meta-whatsapp.js` l.~91-94 ; `services/notifications/internals.js#logNotification` écrit `notification_log(order_ref, parcel_ref, channel, event, recipient, status, detail)` sans `wamid`.

### Contrat cible
À l'envoi : le `wamid` retourné par Meta est conservé dans `notification_log.detail`. Au webhook : mise à jour du `status` de la ligne correspondante. Un accusé « accepted/sent » n'est **jamais** présenté comme une livraison. Notifications toujours non bloquantes.

### Delta minimal
Raccordement des deux côtés, dans la feature `notifications`. Aucun nouveau moteur, aucune nouvelle table (vérifier d'abord si une colonne dédiée est préférable à `detail` — si oui, c'est une migration, à signaler avant d'écrire).

### Tests requis
Unitaire + PostgreSQL jetable (envoi simulé → ligne avec `wamid` ; webhook `delivered` → statut mis à jour ; webhook pour un `wamid` inconnu → ignoré sans erreur). **Preuve externe** : un vrai numéro de test Meta est nécessaire pour qualifier `meta-whatsapp` au-delà de `UNQUALIFIED` (P1/P2) — à ne pas simuler.

### Migration ?
Possible (index ou colonne `wamid`). À décider avant d'écrire.

### Risque
Moyen : corrélation `wamid` ↔ ligne ; en cas d'ambiguïté, ne rien mettre à jour (fail-closed).

---

## GAP-6 — Petits correctifs de cohérence

Sept correctifs indépendants, chacun sa PR ou une PR « chore » unique si le propriétaire l'accepte.

1. **Simulateur** : `services/simulator/state-advancer.js:127` insère dans `notification_log (order_id, message, …)` — colonnes inexistantes (schéma : `order_ref`, `detail`). Aligner sur `logNotification` ou supprimer l'insert. Test : unitaire sur le SQL émis.
2. **Valeur fantôme** `'cash_relay'` (1 occurrence JS, `services/operations-workspace.js#buildQueues`) : hors enum `payment_mode` (`stripe_eur, cash_relais, mixed_shared_cart_cash, paypal_eur, mobile_money`). Inoffensive en JS mais casse tout SQL qui la caste. La retirer. Test : unitaire existant du workspace.
3. **Frontière des incidents** : documenter dans les manifestes `incident-management` et `orders`/`logistics` la séparation `incidents` (moteur de scans, réconciliation, alertes — 8 services) vs `order_incidents` (signalement terrain relais/hub, order-360 — 7 fichiers). Documentation seule.

4. **Enum fantôme `mixed_shared_cart_cash`** (`payment_mode`) : 0 usage dans `services/` et `routes/`, vestige des contributions supprimées par `migrations/125_shared_cart_minimal_domain.sql`. Le documenter comme valeur morte (le retrait d'une valeur d'enum Postgres est une migration à arbitrer, pas un correctif rapide).
5. **Manifeste PWA** : `public/manifest.json` décrit « Le e-commerce des Comores » alors que Komerce opère aussi au Cameroun et au Congo. À aligner avec le chantier `hero-market-aware`.
6. **`order_incidents` sans owner** : écrite par `routes/relay-dashboard.js` et `routes/hub-dashboard.js`, mentionnée seulement par le manifeste `dashboard` (lecture). Déclarer une feature propriétaire (candidat : `incident-management` ou `orders`) — à arbitrer avec le point 3.
7. **Doctrine contredite par le code** : `docs/doctrine/DOCTRINE_PANIER_COLLECTIF.md` décrit contributions, règlement collectif et finalisation créateur, supprimés par la migration 125 (liste publiée par lien, chaque acheteur paie ses lignes). Le document se signale lui-même « revue de conformité requise ». Le marquer comme remplacé par `PANIER_PARTAGE_BOUTIQUE_FIRST.md` ou le réécrire.

---

## GAP-7 — Ménage structurel du repo (DEFER)

Constats, **sans action avant arbitrage du propriétaire** :
- Deux arbres de migrations : `db/migrations/` (12 fichiers anciens `004_…`) n'est pas lu par `scripts/ci-migrate.js` (qui ne lit que `migrations/`).
- Doctrine dispersée : `docs/doctrine/` (77), `docs_doctrine/` (4), `governance/` (18), 9 `.md` à la racine.
- Fichiers errants : `tmp-concurrency-proof.js`, `audit-backend-arch.js` (racine), `public/boutique/check-sourcing.js` (non suivi, appartient à une autre session — ne pas supprimer).
- Monkey-patching de `mount()` dans 6 fichiers de dashboards et `MetricStrip` détourné sur 3 pages : source de bugs silencieux. Remplacement par un point d'extension déclaré = chantier dédié, pas un correctif.

---

## Garde-fous d'exécution (tous les GAP)

- Ne pas toucher au RESET, à la production, aux paiements réels, aux commandes fournisseur ni aux données commerciales réelles.
- Aucun nouveau service Railway.
- Respecter Feature First et les owners de tables : pas de SQL direct sur la table d'un autre domaine, pas de writer transversal, pas de branche provider dans le cœur métier.
- **Ne jamais modifier ni restaurer (`git checkout --`, `git stash`, `git clean`) des fichiers non suivis ou modifiés qui ne font pas partie du GAP en cours** : d'autres sessions travaillent en parallèle sur le même dépôt.
- Toujours `git add <fichiers explicites>`, jamais `git add -A`.
- Après toute nouvelle requête SQL : `npm run arch:gen` puis `arch-header-sql-check`.
