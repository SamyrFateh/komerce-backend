# Contrats inter-services Komerce

> **Statut** : contrats des services critiques (points d'entrée stables)
> **Source** : lecture directe des `services/*.js` et `routes/*.js` — 24 mai 2026
> **But** : éviter les régressions silencieuses quand un service change de signature ou de comportement.
> **Règle** : un service listé ici a un contrat de sortie stable. Modifier sa signature publique = lot de gouvernance, pas un commit de feature.

---

## 1. Pourquoi ce document existe

Komerce est modulaire : 44 services, 75 routes, 93 tables. Sans contrats explicites, modifier `pricing-engine` ou `wallet-service` casse en silence des consommateurs dont on a oublié l'existence.

Ce document ne liste pas **tout**. Il liste les **services critiques** — ceux qui touchent à l'argent, au statut commande, au stock, à la sécurité, ou qui sont consommés par plusieurs routes.

Pour les autres services (helpers locaux, services périphériques), pas de contrat formel : la modification reste libre tant qu'elle ne casse pas un test.

---

## 2. Services critiques — vue d'ensemble

| Service | Domaine | Statut | Consommateurs |
|---|---|---|---|
| `order-status-machine.js` | Cycle de vie commande | Source de vérité absolue | Toutes routes mutantes commande |
| `order-payment-confirmation.js` | Cycle paiement → stock | Point d'entrée unique paiement | `payments.js`, `cash.js`, `wallet.js`, `shared-cart` |
| `wallet-service.js` | Wallet client / avoirs | Argent client — critique | `routes/wallet.js`, `payments.js`, annulations, refunds |
| `pricing-engine.js` | Pricing 4 niveaux + decision sourcing | Doctrine économique | `routes/pricing.js`, dashboards admin, sourcing |
| `routing.js` | Routage logistique | Décision île à partir du relais | `orders/create.js`, parcels |
| `parcel-security.js` | Codes externes, sceau, intégrité poids | Sécurité colis | `routes/parcels.js`, `parcel-api-v2.js`, scans |
| `shared-cart-engine.js` | Panier partagé MVP | Argent + commande | `routes/shared-cart.js`, webhook Stripe partagé |
| ~~`collective-workspace-engine.js`~~ | ~~Workspace collectif~~ | 🪦 **TOMBSTONE** — PR #486 | Ne pas étendre. Routes répondent 410. |
| ~~`collective-payment-orchestrator.js`~~ | ~~Orchestration paiement collectif~~ | 🪦 **TOMBSTONE** — no-op | Ne pas étendre. Cron no-op. |

> **Note A-BE-07 (2026-05-26)** : les deux services collectifs legacy sont déclassés depuis PR #486. Voir STATUS.md §WORKSPACE-DECOMMISSION. Ils ne doivent plus être étendus ni maintenus. Leurs sections de contrat sont conservées ci-dessous à titre historique uniquement.

---

## 2b. Legacy tombstone — ne pas étendre

Les services suivants sont désactivés. Leur code est conservé pour la maintenance d'urgence (`admin-collective-repairs.js`) mais aucune feature ne doit y être ajoutée.

| Service | Raison du tombstone | Maintenance |
|---|---|---|
| `collective-workspace-engine.js` | Remplacé par panier partagé boutique-first (PR #486) | Importé uniquement par `collective-stock-reservation-service.js` (repair admin dry_run) |
| `collective-payment-orchestrator.js` | No-op complet. `startExpirationCron` = no-op. | Aucune |

---

## 3. `services/order-status-machine.js`

> **Invariant I-01** : aucune mutation de `orders.status` hors ce service.
> **Invariant I-04** : toute transition trace dans `order_status_history`.

### Exports publics

```js
module.exports = {
  transitionOrderStatus,   // mutation
  isForwardTransition,     // helper pure
  generatePickupCode,      // génère un code pickup
  ORDER_STATUSES,          // constantes
  STATUS_RANK,
  VALID_TRANSITIONS,
};
```

### Contrat `transitionOrderStatus`

```js
await transitionOrderStatus({
  orderId,        // UUID — requis
  newStatus,      // ENUM order_status — requis  [⚠️ A-BE-02 fix 2026-05-26 : était "targetStatus" dans la doc, le code attend "newStatus"]
  source,         // 'patch' | 'scan' | 'system' | 'stripe_webhook'
                  // | 'cash_confirm' | 'wallet_full_payment'
                  // | 'shared_cart_full_payment' | 'collective_payment'
  actor,          // { id, role } — pour l'audit
  note,           // string optionnelle
  dbClient,       // optionnel — réutilise une transaction existante
});
```

### Garanties

- Insère une ligne dans `order_status_history`.
- Pose les timestamps `<status>_at` via `COALESCE` (jamais écrasés).
- Idempotent si la cible est déjà le statut courant.
- Sources `scan` / `system` : forward-only (jamais en arrière).
- Sources de paiement : strictement `pending → confirmed`. Toute autre transition = erreur ou no-op.
- Annulation : déclenche restauration stock + contrepassation wallet (via `wallet-service.reverseApplyToOrder`).

### Règle de modification

Ajouter un statut, une source, ou une transition = lot dédié documenté dans STATUS.md + mise à jour de CARTOGRAPHY et ZONE_IMPACT dans la même PR.

---

## 4. `services/order-payment-confirmation.js`

> **Point d'entrée unique du cycle paiement → confirmation commande → stock.**
> Tout paiement validé (Stripe, cash, wallet 100%, panier partagé, panier collectif) passe par ici.

### Export public

```js
module.exports = { confirmPaymentCycle };
```

### Contrat

```js
await confirmPaymentCycle({
  orderId,    // UUID — requis
  actor,      // { id, role } — qui confirme
  source,     // identique à transitionOrderStatus
  dbClient,   // optionnel
  note,       // string optionnelle
});
```

### Garanties

- Appelle `transitionOrderStatus(pending → confirmed)`.
- Met à jour `payment_status` à `paid`.
- Décrémente le stock des `order_items`.
- Déclenche les notifications post-paiement (SMS / email selon config).
- Idempotent : si déjà `confirmed`, no-op.

### Consommateurs (à maintenir)

- `routes/payments.js` (webhook Stripe principal)
- `routes/cash.js` (cash relais)
- `routes/wallet.js` (paiement intégral wallet)
- `routes/shared-cart.js` (webhook Stripe panier partagé)
- `routes/collective-payments.js` (capture collective)

**Règle** : aucune nouvelle source de paiement ne doit faire le job en direct. Toute nouvelle source passe par `confirmPaymentCycle`.

---

## 5. `services/wallet-service.js`

> **Invariant I-05** : pas de modification de `balance_kmf` hors transaction métier associée.
> **Argent client** — niveau de criticité maximal.

### Exports publics

```js
module.exports = {
  ensureWalletTables,
  getOrCreateWallet,
  credit,
  debit,
  applyToOrder,
  removeFromOrder,
  createCreditFromCancel,
  reverseLot,
  getBalance,
  getBalanceInTx,
  getTransactions,
  listWallets,
  getWalletDetail,
};
```

### Contrats principaux

**`credit(client, opts)`**
```js
{
  userId,
  amountKmf,         // > 0
  reason,            // string métier
  idempotencyKey,    // requis — empêche le double crédit
  expiresAt,         // optionnel
  source,            // string
  meta,              // jsonb
}
```

**`debit(client, opts)`** — consomme FIFO les lots de crédits.

**`applyToOrder(client, { userId, orderId, amountKmf })`** — applique le wallet sur une commande, créée transaction + consumptions.

**`removeFromOrder(client, { orderId })`** — annule l'application (utilisé en cas d'annulation commande). **Depuis migration 066 : ne supprime plus les lignes** — pose `reversed_at = NOW()` + `reversal_reason = 'order_cancel'` sur `wallet_consumptions`. Invariant I-05 renforcé.

**`createCreditFromCancel(client, { orderId, adminId, amountKmf })`** — crée un crédit suite à une annulation.

**`reverseLot(client, { lotId, adminId, note })`** — contrepassation d'un lot (avec garde anti-consommation déjà faite).

### Garanties

- Transactions immutables (jamais d'UPDATE).
- Consommation FIFO des lots.
- Idempotence sur les créations (clé `idempotency_key`).
- Contrepassation au lieu de suppression.
- Race condition gérée via `FOR UPDATE` sur la wallet.

### Règle de modification

Modifier la signature d'un de ces exports = lot dédié + revue financière + tests d'idempotence obligatoires.

---

## 6. `services/pricing-engine.js`

> **Invariant I-08** : pricing lit les composantes DB. Aucun coefficient dur.

### Exports principaux

```js
module.exports = {
  loadGlobalConfig,
  computeFixedCostAllocation,
  computeCDR,             // Coût De Revient
  buildCostBreakdown,
  computePrices,          // 4 prix : survival, minimum_safe, recommended, test_market
  computeScenarios,
  computeMarketConfidence,
  computeHealthStatus,
  computeSourcingDecision,
};
```

### Contrat `computePrices(cdr, cat, finance)`

Retourne un objet de la forme :
```js
{
  survival_price,        // KMF
  minimum_safe_price,    // KMF
  recommended_price,     // KMF
  test_market_price,     // KMF
  arrondi_psycho: true,  // appliqué
}
```

### Contrat `computeSourcingDecision({ health_status, market_confidence, weight_kg })`

Retourne une décision parmi : `proceed`, `caution`, `revisit`, `block`. Cf. `DOCTRINE_ECONOMIQUE_KOMERCE.md`.

### Sources DB lues

`finance_config`, `cost_components` (fallback `pricing_components`), `risk_provisions`, `charges`, `customs_categories`, `products`, `orders`, `order_items`.

### Règle de modification

Ne jamais remplacer le moteur par `prix = coût × coefficient unique`. Toute modification de formule = ADR + revue.

---

## 7. `services/routing.js`

> Décision logistique : île de destination déterminée **uniquement par le relais**.

### Exports

```js
module.exports = {
  normalizeIsland,
  resolveRoutingFromRelais,
  ensureRoutingColumns,
};
```

### Contrat `resolveRoutingFromRelais(relais)`

Retourne `{ destinationIsland, routingMode, hubRequired }` selon les champs du relais.

### Garantie

Un seul algorithme de routage. Pas de logique de routage dispersée dans `routes/`.

---

## 8. `services/parcel-security.js`

> **Invariant I-10** : codes de retrait et preuves de collecte = éléments de confiance.

### Exports

```js
module.exports = {
  generateExternalCode,
  generateSealCode,
  buildExternalLabel,
  buildInternalRecord,
  logParcelEvent,
  checkWeightIntegrity,
  verifySeal,
  ensureSecurityTables,
};
```

### Garanties

- Codes générés cryptographiquement.
- Étiquettes externes ne contiennent **aucune** info sensible (principe S1 du module).
- Vérifications de sceau et de poids sont des opérations comparatives, pas de simples assertions UI.

### Règle de modification

Toute modif du format de code externe ou sceau = lot sécurité, jamais en commit isolé.

---

## 9. `services/shared-cart-engine.js`

> Argent + commande. Webhook Stripe dédié (body brut requis — invariant I-07).

### Exports principaux

```js
{
  createSharedCartFromBasket,
  createSharedCartFromCartItems,
  getSharedCartForPublic,
  getSharedCartForOwner,
  listMySharedCarts,
  incrementViewCount,
  startContribution,
  attachStripeSession,
  confirmContributionFromStripe,
  markContributionFailed,
  convertSharedCartToOrder,
}
```

### Garantie clé

`confirmContributionFromStripe(session)` → appelle in fine `order-payment-confirmation.confirmPaymentCycle` pour le passage `pending → confirmed`. **Ne fait pas la mutation `orders.status` lui-même.**

---

## 10. `services/collective-workspace-engine.js`

> Workspace collectif (événements, cagnottes). Argent + commande.

### Exports principaux

```js
{
  createWorkspace,
  getWorkspaceByPublicToken,
  getWorkspaceByCreatorToken,
  addItem, updateItem, removeItem,
  addContribution,
  cancelContribution,
  cancelContributionByCreator,
  finalizationReview,
  finalizeWorkspace,
  resumeWorkspace,
}
```

### Garanties

- Tokens publics et créateur séparés (hashés en DB).
- Événements tracés dans `collective_workspace_events`.
- Contributions immutables côté workspace (cancel = nouveau événement, pas de DELETE).

---

## 11. `services/collective-payment-orchestrator.js`

> Orchestration Stripe pour le panier collectif. Capture différée + idempotence Stripe.

### Exports principaux

```js
{
  createOrGetPaymentIntent,
  onPaymentAuthorized,
  captureAllAndCreateOrder,
  confirmCashContribution,
  expireOverdueSessions,
  isStripeEventProcessed,
  markStripeEventProcessed,
  startExpirationCron,
  stopExpirationCron,
}
```

### Garanties

- Idempotence webhook Stripe via `stripe_events_processed`.
- Capture en bloc à finalisation (pas paiement par paiement).
- Création de commande passe par `order-payment-confirmation`.

---

## 11b. `services/purchasing-trigger-service.js` — triggerPurchasing

> Extrait de `routes/purchasing.js` lors du lot **A-BE-05 (2026-05-26)**.
> Contrat stable : les consommateurs historiques importent via `routes/purchasing.js` qui ré-exporte.

### Export public

```js
module.exports = { triggerPurchasing };
```

### Contrat `triggerPurchasing`

```js
// Fire-and-forget — JAMAIS awaité dans une transaction active
triggerPurchasing(orderId)  // UUID — requis
  .then(({ purchase_orders }) => { /* array de résultats par item */ })
  .catch(err => { /* logguer, ne pas propager */ });
```

**Retourne** `{ purchase_orders: Array<{ item, status, purchase_order_id, ... }> }`

Statuts possibles par item : `no_supplier`, `already_exists`, `auto_ordered`, `api_failed_notified`, `whatsapp_sent`, `admin_notified`, `error`.

**Idempotence I-SWEEP-3B** : si une PO non-cancelled existe déjà pour `(order_id, product_supplier_id)`, retourne `already_exists` sans créer de doublon.

**Consommateurs directs** (via `require('./purchasing').triggerPurchasing`) :
- `routes/payments.js` — post-webhook Stripe, fire-and-forget
- `routes/pickup-secret.js` — post-commit cash, fire-and-forget
- `services/repair-ordered-without-purchase-orders.js` — repair admin

**Garde-fous** :
- Ne jamais `await` dans une transaction ouverte.
- Chaque item protégé par SAVEPOINT P2-7 : échec d'une PO n'annule pas les autres.
- L'engine est dans `services/purchasing-trigger-service.js` ; la façade publique reste `routes/purchasing.js`.

---



1. Ouvrir CARTOGRAPHY, ZONE_IMPACT, SCHEMA et ce document.
2. Vérifier les consommateurs (recherche `require\\(['"](.*\\)/${service}['"]\\)`).
3. Si on change une signature publique : **lot dédié** + STATUS.md + tests.
4. Si on change un comportement (transition, calcul, garantie) : ADR + revue.
5. Si on ajoute un export public : ce document doit être mis à jour dans la même PR.
6. Si on retire un export public : vérifier qu'aucun consommateur ne l'appelle.

---

## 13. Services NON listés ici

Tous les autres services dans `services/` sont périphériques ou helpers internes. Pas de contrat formel — modification libre tant que les tests passent.

À considérer pour ajout futur si leur usage devient transverse :
- `dashboard-cache.js` (si plusieurs dashboards en dépendent)
- `notification-service.js` (déjà transverse en pratique)
- `inventory-service.js` (si l'inventaire devient critique vs le hub flow actuel)

---

## 14. Liens

- `CARTOGRAPHY_360.md` — domaines API et points de vérité.
- `ZONE_IMPACT.md` — invariants I-01 à I-10.
- `SCHEMA.md` — état réel de la DB.
- `AGENTS.md` — point d'entrée et règle de divergence.
