# Audit backend Komerce — addendum 5 passes

> Date : 2026-05-26  
> Branche : `audit-backend-incoherences-2026-05-26`  
> Complément du rapport : `docs/chantier/AUDIT_BACKEND_INCOHERENCES_2026_05_26.md`  
> Objectif : couvrir les 5 passes demandées, au-delà du premier balayage P0/P1.

---

## Résumé rapide

Les 5 passes confirment le diagnostic initial : le backend est proche d’un état go-live, mais il reste des **risques de cohérence** et **quelques bugs probables** à traiter avant une ouverture large.

Les nouvelles alertes les plus importantes après les 5 passes :

| ID | Sévérité | Zone | Résumé |
|---|---:|---|---|
| A-BE-11 | 🟠 Moyenne/Haute | Stripe | Création de PaymentIntent non idempotente côté `/stripe/intent` |
| A-BE-12 | 🔴 Haute | Wallet | `removeFromOrder()` semble non idempotent : ne filtre pas `reversed_at IS NULL` à la lecture |
| A-BE-13 | 🔴 Haute | Purchasing | Annulation PO reçue vérifie `hub_received`, mais la réception écrit `received` |
| A-BE-14 | 🟠 Moyenne | Purchasing | Confirmation manuelle d'une PO sans guard de statut terminal/cancelled |
| A-BE-15 | 🟠 Moyenne | Scans/QR | `verify-qr` transitionne l'ordre avant sync colis, choix à documenter/tester |
| A-BE-16 | 🟡 Moyenne | Tests | Couverture test panier partagé/refund queue non retrouvée par recherche |
| A-BE-17 | 🟡 Moyenne | Migrations | M1/M2 restent actions manuelles documentées, donc risque déploiement si oubli |

---

# PASS 1 — Argent / paiements / wallet / refunds / shared-cart

## Fichiers lus

- `routes/payments.js`
- `services/order-payment-confirmation.js`
- `services/refund-service.js`
- `services/wallet-service.js`
- `routes/shared-cart.js`
- `services/shared-cart-engine.js`
- `services/shared-cart-financial-guard.js`

## Verdict PASS 1

Le chemin central paiement → confirmation → stock est bien mieux tenu qu'avant : `confirmPaymentCycle()` centralise les transitions et le décrément stock avec `FOR UPDATE`.

Mais il reste trois risques :

1. ancien export financier shared-cart déjà identifié ;
2. PaymentIntent Stripe classique non idempotent ;
3. wallet reversal potentiellement non idempotent.

---

## A-BE-11 — Création de PaymentIntent Stripe non idempotente

**Sévérité : 🟠 Moyenne/Haute**  
**Fichier :** `routes/payments.js`  
**Endpoint :** `POST /api/payments/stripe/intent`

### Constat

La route crée un nouveau PaymentIntent à chaque appel :

```js
const intent = await stripe.paymentIntents.create({ ... });
await db.query('UPDATE orders SET stripe_payment_id = $1 WHERE id = $2', [intent.id, order.id]);
```

Elle refuse si `payment_status === 'paid'`, mais elle ne réutilise pas un `stripe_payment_id` existant si la commande est encore pending.

### Risque

Double clic, refresh, retry frontend ou perte réseau peuvent créer plusieurs PaymentIntents pour la même commande. Le dernier écrase `orders.stripe_payment_id`, mais un ancien PaymentIntent peut encore aboutir côté Stripe et déclencher webhook.

Le webhook est robuste par event id et ordre déjà paid, mais cela crée :

- bruit Stripe ;
- paiements orphelins potentiels ;
- support client plus difficile ;
- risque de remboursement manuel si plusieurs PIs sont payés.

### Correction recommandée

Avant création :

1. si `order.stripe_payment_id` existe, récupérer le PaymentIntent Stripe ;
2. si statut Stripe `requires_payment_method` / `requires_confirmation` / `requires_action`, retourner le même `client_secret` ;
3. sinon créer un nouveau PI avec idempotencyKey stable.

Patch cible :

```js
const intent = await stripe.paymentIntents.create(payload, {
  idempotencyKey: `order_pi_${order.id}_${order.updated_at?.getTime?.() || ''}`,
});
```

Encore mieux : clé stable `order_pi_${order.id}` tant que la commande n’est pas annulée/recréée.

---

## A-BE-12 — `wallet.removeFromOrder()` semble non idempotent

**Sévérité : 🔴 Haute**  
**Fichier :** `services/wallet-service.js`

### Constat

`removeFromOrder()` lit les consommations wallet comme ceci :

```js
SELECT wc.*, wl.wallet_id
FROM wallet_consumptions wc
JOIN wallet_credit_lots wl ON wl.id = wc.credit_lot_id
WHERE wc.order_id = $1
```

Puis il recrédite les lots :

```js
UPDATE wallet_credit_lots SET remaining_kmf = remaining_kmf + $1, status = 'active'
```

Et marque seulement ensuite :

```js
UPDATE wallet_consumptions
SET reversed_at = NOW(), reversal_reason = 'order_cancel'
WHERE order_id = $1 AND reversed_at IS NULL
```

### Problème

La lecture initiale ne filtre pas `wc.reversed_at IS NULL`.

Donc si `removeFromOrder()` est appelé une deuxième fois pour la même commande, il peut relire les consommations déjà reversées et recréditer à nouveau les lots/wallet.

### Risque

Double crédit wallet en cas de retry d’annulation, appel admin répété, ou bug de machine de statut.

### Correction recommandée

Modifier la lecture initiale :

```sql
WHERE wc.order_id = $1
  AND wc.reversed_at IS NULL
FOR UPDATE
```

Puis si aucune ligne : retourner un no-op idempotent au lieu de throw.

Patch logique :

```js
if (!cRes.rows.length) {
  return { transaction: null, reversed_kmf: 0, noop: true };
}
```

Ajouter un test : deux appels successifs à `removeFromOrder()` ne doivent pas augmenter le solde deux fois.

---

## A-BE-06 confirmé — `processRefundWithFallback()` à aligner

Le finding initial reste valide. Priorité P1 : mettre un row `refunds.pending` avant appel Stripe/fallback.

---

# PASS 2 — Orders / status machine / stock / purchasing

## Fichiers lus

- `services/order-status-machine.js`
- `services/order-payment-confirmation.js`
- `routes/orders/status.js`
- `routes/orders/cancel.js`
- `routes/payments.js`
- `routes/purchasing.js`

## Verdict PASS 2

Le statut commande est globalement protégé par la machine. Le risque fort se situe plutôt côté `purchasing.js`, qui reste un gros fichier métier et contient au moins un bug probable de statut PO.

---

## A-BE-13 — Annulation PO reçue vérifie un mauvais statut

**Sévérité : 🔴 Haute**  
**Fichier :** `routes/purchasing.js`  
**Endpoint :** `DELETE /api/purchasing/po/:po_id`

### Constat

La réception PO écrit :

```js
status = po_complete ? 'received' : 'partially_received'
```

Mais l’annulation interdit seulement :

```js
if (po.status === 'hub_received' && !forceDelete) { ... }
```

### Problème

`hub_received` ne semble pas être le statut réellement écrit par la route de réception. Une PO en `received` peut donc être annulée par `DELETE /po/:po_id` sans `forceDelete`.

### Risque

Incohérence logistique : marchandise déjà reçue au hub, mais PO annulée après coup. Le dashboard et la complétude de commande peuvent devenir faux.

### Correction recommandée

Remplacer le guard par :

```js
if (['received', 'partially_received', 'hub_received'].includes(po.status) && !forceDelete) {
  return res.status(409).json({ error: 'Impossible d’annuler une PO déjà reçue au Hub.' });
}
```

Et vérifier l’ENUM/contrainte réelle des statuts `purchase_orders.status`.

---

## A-BE-14 — Confirmation manuelle PO sans guard terminal/cancelled

**Sévérité : 🟠 Moyenne**  
**Fichier :** `routes/purchasing.js`  
**Endpoint :** `POST /api/purchasing/:order_id/confirm`

### Constat

La route confirme une PO par :

```sql
UPDATE purchase_orders
SET status = 'confirmed', ...
WHERE id = $6 AND order_id = $7
RETURNING *
```

Il n’y a pas de guard explicite :

```sql
AND status NOT IN ('cancelled', 'received', 'partially_received')
```

### Risque

Un admin peut confirmer une PO déjà annulée ou déjà reçue, par erreur UI ou retry.

### Correction recommandée

Ajouter un guard statut :

```sql
WHERE id = $6
  AND order_id = $7
  AND status IN ('pending', 'notified')
```

Retourner `409` si la PO est dans un statut terminal ou avancé.

---

## A-BE-05 confirmé — `routes/purchasing.js` à extraire

Le fichier mélange route, moteur, notifications, stubs fournisseurs, réception hub et transitions commande. À extraire en services après correction des bugs de statut.

---

# PASS 3 — Parcels / scans / pickup / relais / hub / transitaire

## Fichiers lus

- `routes/scans.js`
- `routes/relay-dashboard.js`
- recherches sur `parcelSync`, `pickup-secret`, `scan-engine`, `verify-qr`

## Verdict PASS 3

Bonne nouvelle : les routes critiques lues ont des protections substantielles :

- `POST /api/scans/collect` limite par rôle admin/agent_relais ;
- cross-relais strict ;
- blocage temporaire après tentatives ;
- `FOR UPDATE` sur commande disponible ;
- `collected` interdit sur endpoint générique `/api/scans` ;
- `relay-dashboard` contient un guard IDOR explicite sur détail commande.

---

## A-BE-15 — `verify-qr` transitionne l'ordre avant sync colis

**Sévérité : 🟠 Moyenne**  
**Fichier :** `routes/scans.js`  
**Endpoint :** `POST /api/scans/verify-qr`

### Constat

`verify-qr` :

1. fait `transitionOrderStatus(... newStatus:'collected', source:'patch')` dans la transaction ;
2. invalide le QR token ;
3. insère le scan ;
4. commit ;
5. appelle `safeSyncScanToParcels(...)` après commit.

Le commentaire dit que c’est attendu : la machine écrit l’historique, puis parcelSync met à jour les colis après coup.

### Risque

Si le process crash entre le commit et `safeSyncScanToParcels`, l’ordre est `collected`, le scan existe, mais les parcels peuvent rester dans un état antérieur.

### Correction recommandée

Deux options :

1. assumer ce modèle et ajouter un job de réparation `parcelSyncRepair` pour scans collected non synchronisés ;
2. faire `safeSyncScanToParcels(..., client)` dans la transaction avec un flag `skipHistory` si possible.

À minima : ajouter un test ou script d’audit :

```sql
SELECT o.id, o.reference, o.status, p.status AS parcel_status
FROM orders o
JOIN parcels p ON p.order_id = o.id
WHERE o.status = 'collected'
  AND p.status != 'collected';
```

---

## Non-finding PASS 3

Pas d’IDOR évident dans les extraits lus de `relay-dashboard` : les commandes listées sont scopées par `relais_id`, et le détail bloque si `order.relais_id !== req.user.relais_id` pour un agent relais.

---

# PASS 4 — Admin / sécurité / RBAC / IDOR / rate-limit

## Fichiers lus

- `routes/admin.js`
- `routes/admin/index.js`
- `routes/admin/system.js`
- `routes/relay-dashboard.js`
- `server.js`
- recherches sur `requireRole`, admin auth, reset, seed

## Verdict PASS 4

Les endpoints destructifs admin sont protégés par :

- `authenticate` ;
- `requireRole(['admin'])` ;
- garde production `ALLOW_FLUSH` pour reset ;
- garde production `ALLOW_SEED` pour seed-test ;
- rate-limit admin monté dans `server.js` sur `/api/admin/`.

Pas de nouveau trou critique confirmé dans cette passe.

---

## A-BE-18 — Auto-création de tables dans une route runtime

**Sévérité : 🟡 Moyenne**  
**Fichier :** `routes/relay-dashboard.js`

### Constat

`ensureRelayTables()` est exécuté au module load et crée `order_incidents`, `order_comments`, index, etc.

### Pourquoi c’est une dette

Le boot applicatif peut modifier le schéma hors système de migrations. Cela marche en dev/staging, mais en prod go-live, les modifications de schéma devraient être exclusivement dans `migrations/` ou `bootstrap/startup-migrations.js` clairement maîtrisé.

### Risque

- drift DB invisible ;
- droits SQL inattendus ;
- différences entre environnements ;
- difficile à auditer.

### Correction recommandée

Déplacer ces créations dans une migration versionnée, puis transformer `ensureRelayTables()` en simple vérification non destructive ou supprimer.

---

# PASS 5 — Migrations / scripts / tests / docs contracts

## Sources consultées

- `docs/chantier/STATUS.md`
- recherches migrations `068`, `069`, `070`
- recherches tests `shared-cart`, `refund`, `test:p0`
- `docs/CONTRACTS.md`

## Verdict PASS 5

La documentation de chantier est utile et assez honnête sur M1/M2, mais plusieurs points restent hors tests ou en actions manuelles.

---

## A-BE-16 — Couverture test panier partagé/refund queue non retrouvée

**Sévérité : 🟡 Moyenne**  
**Zone :** tests

### Constat

La recherche disponible ne retrouve pas de test explicite `describe(... shared-cart ...)` ou suite dédiée refund queue panier partagé.

### Risque

Le panier partagé devient critique commercialement, mais les chemins suivants peuvent régresser sans alerte :

- création shared-cart depuis cart-items ;
- contribution Stripe pending → paid ;
- `paid_not_counted` ;
- refund queue ;
- `mark-refunded` ;
- finalization fully_funded → order.

### Correction recommandée

Créer une suite test minimale :

```txt
tests/unit/shared-cart-financial-guard.test.js
tests/unit/shared-cart-refund-queue.test.js
tests/integration/shared-cart-flow.test.js
```

Priorité : financial guard + refund queue.

---

## A-BE-17 — Migrations M1/M2 restent des actions manuelles

**Sévérité : 🟡 Moyenne**  
**Zone :** migrations / déploiement

### Constat

`STATUS.md` conserve :

```bash
rm migrations/068_check_balance_non_negative.sql
psql $DATABASE_URL -f migrations/068_wallets_check_balance.sql
psql $DATABASE_URL -f migrations/069_analytical_indexes.sql
```

Cela signifie que l’état go-live dépend encore d’actions manuelles sur DB.

### Risque

- oublier M1 ou M2 en prod ;
- croire que Railway startup a tout appliqué ;
- écart entre local/staging/prod ;
- index analytiques non appliqués si `CREATE INDEX CONCURRENTLY` est incompatible avec le runner transactionnel.

### Correction recommandée

Créer un document opérationnel court `docs/chantier/GO_LIVE_DB_MANUAL_STEPS.md` ou intégrer dans `STATUS.md` une checklist exécutable, avec validation SQL après exécution.

Exemples de validation :

```sql
SELECT conname FROM pg_constraint WHERE conname ILIKE '%wallet%balance%';
SELECT indexname FROM pg_indexes WHERE indexname ILIKE '%analytical%';
```

---

# Synthèse après les 5 passes

## Findings cumulés à traiter avant ouverture large

| Priorité | Findings |
|---|---|
| P0 | A-BE-01, A-BE-02, A-BE-12, A-BE-13 |
| P1 | A-BE-03, A-BE-04, A-BE-06, A-BE-11, A-BE-14, A-BE-16, A-BE-17 |
| P2 | A-BE-05, A-BE-09, A-BE-10, A-BE-15, A-BE-18 |

## Ce qui est rassurant

- Pas de mutation directe évidente `orders.status` hors machine dans les recherches ciblées.
- Webhooks Stripe raw avant `express.json`.
- `confirmPaymentCycle()` centralise paiement → statut → stock.
- `shared-cart` actif utilise `confirmContributionFromStripeSafely()`.
- `scan/collect` a des garde-fous relais sérieux.
- Admin destructive routes protégées par rôle + flags prod.

## Ce qui reste vraiment à corriger en premier

### 1. Wallet double reversal possible

C’est le plus sérieux trouvé en pass 1.

Patch court : filtrer `wallet_consumptions.reversed_at IS NULL` dans `removeFromOrder()`.

### 2. Purchasing PO reçue annulable

Patch court : remplacer `hub_received` par la liste réelle `received`, `partially_received`, `hub_received`.

### 3. Ancienne confirmation financière shared-cart exportée

Patch court : supprimer l’export et ajouter un test/grep.

### 4. Contrat `targetStatus` vs `newStatus`

Patch court : aligner doc ou accepter alias.

---

# Plan de PR recommandé

## PR-AUDIT-FIX-1 — Wallet reversal idempotent

Fichier : `services/wallet-service.js`

- `WHERE wc.order_id = $1 AND wc.reversed_at IS NULL FOR UPDATE`
- no-op si aucune ligne non reversée
- test double appel

## PR-AUDIT-FIX-2 — Purchasing PO guards

Fichier : `routes/purchasing.js`

- annulation bloquée sur `received`, `partially_received`, `hub_received`
- confirmation limitée à `pending`, `notified`

## PR-AUDIT-FIX-3 — Shared-cart financial surface cleanup

Fichier : `services/shared-cart-engine.js`

- supprimer export `confirmContributionFromStripe`
- vérifier aucun import externe
- test contractuel

## PR-AUDIT-FIX-4 — Contract status alignment

Fichiers :

- `docs/CONTRACTS.md`
- éventuellement `services/order-status-machine.js`

Décision : soit doc-only `newStatus`, soit alias `targetStatus` accepté.

## PR-AUDIT-FIX-5 — Legacy collective runtime off

Fichiers :

- `server.js`
- `docs/CONTRACTS.md`
- `docs/chantier/STATUS.md`

Ne plus démarrer le cron no-op. Clarifier les routes 410.

---

# Verdict après 5 passes

Le backend n’est pas “cassé”, mais il a encore **4 corrections courtes à forte valeur** avant go-live large :

```txt
1. Wallet reversal idempotent
2. Purchasing PO status guards
3. Retirer ancien export financier shared-cart
4. Aligner transitionOrderStatus contract/code
```

Ces corrections sont courtes, localisées, et plus importantes que toute nouvelle fonctionnalité.
