# Audit backend Komerce — incohérences, bugs probables et dette go-live

> Date : 2026-05-26  
> Branche d'audit : `audit-backend-incoherences-2026-05-26`  
> Base lue : `main` après merge du hotfix `Payer en groupe` (`e525f483...`)  
> Périmètre : backend Node/Express, routes, services, middleware, bootstrap, paiements, panier partagé, purchasing, statuts, docs contractuelles.  
> Méthode : audit statique par lecture ciblée GitHub + recherches de patterns dangereux. Pas d'exécution locale complète dans ce lot.

---

## 0. Résumé exécutif

Le backend est globalement plus propre qu'avant : `server.js` est refactoré, les webhooks Stripe raw sont bien placés, la machine de statut reste la source de vérité, le panier partagé actif est protégé par un guard financier, et l'ancien workspace collectif est largement tombstoné.

Mais l'audit trouve encore plusieurs incohérences importantes :

| ID | Sévérité | Sujet | Verdict |
|---|---:|---|---|
| A-BE-01 | 🔴 Haute | Deux chemins de confirmation financière du panier partagé | Ancienne fonction encore exportée, dangereuse si réutilisée |
| A-BE-02 | 🟠 Moyenne/Haute | `CONTRACTS.md` décrit `targetStatus` alors que le code utilise `newStatus` | Drift documentaire dangereux |
| A-BE-03 | 🟠 Moyenne | Runtime collectif legacy encore monté dans `server.js` | Tombstone incomplet côté boot/runtime |
| A-BE-04 | 🟠 Moyenne | `auth-guest` et front phone guard n'ont pas la même normalisation téléphone | API fragile hors front officiel |
| A-BE-05 | 🟠 Moyenne | `routes/purchasing.js` garde une grosse logique métier inline | Refacto incomplète + risque régression sourcing/réception |
| A-BE-06 | 🟡 Moyenne | `processRefundWithFallback()` ne crée pas de ligne pending avant Stripe | Moins robuste que `processRefund()` |
| A-BE-07 | 🟡 Moyenne | `CONTRACTS.md` encore orienté ancien collectif actif | Contrat obsolète / confusion future |
| A-BE-08 | 🟡 Moyenne | `confirmContributionFromStripe()` ancien reste exporté depuis `shared-cart-engine` | Surface publique inutile et dangereuse |
| A-BE-09 | 🟡 Moyenne | `shared-cart` admin expire/cancel sans workflow refund auto | OK MVP, mais file de risque opérationnel |
| A-BE-10 | 🟢 Faible | logs Pino parfois avec arguments non structurés | Pas bloquant, mais perte de contexte logs |

Priorité recommandée :

```txt
P0 court : A-BE-01, A-BE-02, A-BE-03
P1 go-live : A-BE-04, A-BE-06, A-BE-07
P2 post go-live : A-BE-05, A-BE-09, A-BE-10
```

---

## 1. Sources lues

### Documents de vérité

- `docs/chantier/STATUS.md`
- `docs/CONTRACTS.md`
- `docs/ZONE_IMPACT.md`

### Code backend lu directement

- `server.js`
- `services/order-status-machine.js`
- `services/order-payment-confirmation.js`
- `services/shared-cart-engine.js`
- `services/shared-cart-financial-guard.js`
- `services/refund-service.js`
- `middleware/auth-guest.js`
- `routes/shared-cart.js`
- `routes/purchasing.js`

### Recherches ciblées effectuées

- mutations directes de `orders.status` ;
- appels à `transitionOrderStatus` ;
- export et usage de `confirmContributionFromStripe` ;
- usage de `stripe.refunds.create` ;
- traces `TODO` / `FIXME` ;
- `console.*` dans routes/services/bootstrap/middleware ;
- références `collective-workspace-engine` ;
- usages de `store_credits` ;
- stockage JWT/localStorage.

---

## 2. Constat positif : les invariants majeurs tiennent mieux qu'avant

### 2.1 Webhooks Stripe raw correctement placés

Dans `server.js`, les webhooks Stripe principaux sont montés en `express.raw({ type: 'application/json' })` avant `express.json()` :

```js
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/shared-carts/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/collective-payments/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '1mb' }));
```

Conclusion : invariant I-07 respecté côté ordre de boot.

### 2.2 Machine de statut : pas de violation flagrante `UPDATE orders SET status` hors service

La recherche `UPDATE orders SET status` dans routes/services ne ressort pas de mutation directe active hors `services/order-status-machine.js`.

Conclusion : I-01 reste globalement tenu.

### 2.3 Panier partagé : webhook actif utilise le guard financier sécurisé

`routes/shared-cart.js` importe :

```js
const { confirmContributionFromStripeSafely } = require('../services/shared-cart-financial-guard');
```

Puis utilise ce guard dans le webhook `checkout.session.completed`.

Le guard verrouille la contribution et le panier (`FOR UPDATE`), refuse les paiements tardifs/non comptabilisables, empêche `contributed_kmf > total_kmf_snapshot`, et marque les contributions à rembourser manuellement si elles arrivent trop tard ou dépassent le remaining.

Conclusion : le chemin actif est beaucoup plus robuste que l'ancien.

---

# Findings détaillés

---

## A-BE-01 — Deux chemins de confirmation financière du panier partagé

**Sévérité : 🔴 Haute**  
**Fichiers :**

- `services/shared-cart-engine.js`
- `services/shared-cart-financial-guard.js`
- `routes/shared-cart.js`

### Constat

Le webhook actif utilise bien :

```js
confirmContributionFromStripeSafely(session)
```

Mais `services/shared-cart-engine.js` contient encore une ancienne fonction publique :

```js
async function confirmContributionFromStripe(session) { ... }
```

Et elle est exportée :

```js
module.exports = {
  ...,
  confirmContributionFromStripe,
  ...
};
```

### Pourquoi c'est dangereux

L'ancienne fonction :

- marque la contribution `paid` avant de recalculer le panier ;
- ne contient pas les mêmes règles explicites `paid_not_counted` ;
- ne marque pas `requires_manual_refund` en cas de paiement tardif ou dépassement ;
- garde une logique financière concurrente avec le guard moderne.

Même si elle n'est pas appelée aujourd'hui, elle reste exportée et donc réutilisable par erreur dans une future route, test ou refacto.

### Risque

Régression financière : double comptabilisation, surfinancement, ou absence de refund queue si quelqu'un repasse par l'ancien export.

### Correction recommandée

Option stricte : supprimer l'export `confirmContributionFromStripe` et renommer la fonction interne en `_deprecatedConfirmContributionFromStripe_DO_NOT_USE` si besoin historique.

Option propre : déplacer tout le comportement financier dans `shared-cart-financial-guard.js`, puis supprimer l'ancienne fonction de `shared-cart-engine.js`.

### Patch cible

```js
// services/shared-cart-engine.js
module.exports = {
  createSharedCartFromBasket,
  createSharedCartFromCartItems,
  getSharedCartForPublic,
  getSharedCartForOwner,
  listMySharedCarts,
  incrementViewCount,
  startContribution,
  attachStripeSession,
  markContributionFailed,
  convertSharedCartToOrder,
  cancelSharedCart,
  expireOldCarts,
  generateToken,
  CONFIG,
};
```

Ajouter un test grep/contract : aucun import de `engine.confirmContributionFromStripe` autorisé.

---

## A-BE-02 — Drift critique entre `CONTRACTS.md` et `order-status-machine.js`

**Sévérité : 🟠 Moyenne/Haute**  
**Fichiers :**

- `docs/CONTRACTS.md`
- `services/order-status-machine.js`
- appelants `transitionOrderStatus(...)`

### Constat

`CONTRACTS.md` documente le contrat comme :

```js
await transitionOrderStatus({
  orderId,
  targetStatus,
  source,
  actor,
  note,
  dbClient,
});
```

Mais l'implémentation réelle attend :

```js
async function transitionOrderStatus({
  orderId,
  newStatus,
  actor = { id: null, role: 'system' },
  source = 'patch',
  ...
})
```

Les appels existants utilisent majoritairement `newStatus`.

### Pourquoi c'est dangereux

Un développeur qui suit le document de contrat passera `targetStatus`. Dans ce cas, `newStatus` sera `undefined`, et la machine pourra retourner un no-op ou une erreur selon le chemin, sans que l'intention métier soit appliquée.

### Risque

Transitions silencieusement non appliquées, notamment sur des lots scans, sourcing, annulations ou admin.

### Correction recommandée

Deux options :

1. **Aligner la doc** : remplacer `targetStatus` par `newStatus` partout dans `CONTRACTS.md`.
2. **Rendre le code tolérant** : accepter `targetStatus` comme alias de `newStatus`, puis documenter `newStatus` comme champ canonique.

### Patch recommandé

Dans `order-status-machine.js` :

```js
async function transitionOrderStatus(opts) {
  const {
    orderId,
    actor = { id: null, role: 'system' },
    source = 'patch',
    scanId = null,
    note = null,
    cancelReason = null,
    dbClient = null,
  } = opts;
  const newStatus = opts.newStatus || opts.targetStatus;
  if (!newStatus) return { success: false, error: 'newStatus requis' };
  ...
}
```

Et mettre à jour `CONTRACTS.md` pour éviter de propager l'ancien nom.

---

## A-BE-03 — Runtime collectif legacy encore monté dans `server.js`

**Sévérité : 🟠 Moyenne**  
**Fichier :** `server.js`

### Constat

La doctrine dit que le modèle `collective workspace` est tombstoné. Les routes répondent `410` et l'orchestrateur est no-op.

Mais `server.js` monte encore :

```js
app.post('/api/collective-payments/stripe/webhook', collectiveWS.stripeWebhookHandler);
app.use('/api/collective-workspaces', collectiveWS.router);
app.use('/api/collective-payments', collectiveWS.paymentsRouter);
```

Et démarre encore :

```js
collectivePaymentOrchestrator.startExpirationCron(intervalMs);
```

### Pourquoi c'est incohérent

Même no-op, ce runtime donne l'impression que le collectif legacy est encore vivant. Il garde un webhook, des routes et un cron dans le boot principal.

### Risque

- bruit opérationnel ;
- confusion future ;
- surface d'attaque inutile ;
- réintroduction accidentelle du legacy par un patch ultérieur.

### Correction recommandée

Créer un lot `COLLECTIVE-RUNTIME-OFF` :

- garder les routes `410` si on veut une réponse explicite ;
- ne plus démarrer le cron no-op ;
- éventuellement isoler le montage collectif dans `bootstrap/legacy-routes.js` avec commentaire tombstone ;
- retirer le webhook Stripe collectif du boot si aucun PaymentIntent collectif n'est censé exister.

### Patch minimal

```js
// server.js
// Ne pas démarrer l'orchestrateur collectif legacy : runtime tombstone.
// collectivePaymentOrchestrator.startExpirationCron(...) supprimé.
```

Puis documenter dans `STATUS.md` : legacy routes kept only as 410 compatibility surface.

---

## A-BE-04 — Normalisation téléphone incohérente entre front guard et backend guest

**Sévérité : 🟠 Moyenne**  
**Fichiers :**

- `public/boutique/js/b-share-phone-guard.js`
- `middleware/auth-guest.js`

### Constat

Le front guard sait normaliser :

- `+33...`
- `00...`
- `06...` vers `+33...`
- `3211234` vers `+2693211234`

Mais le backend `auth-guest.normalizePhone()` accepte seulement :

- E.164 déjà préfixé `+...` ;
- format international `00...` ;
- sinon il retourne `null`.

### Pourquoi c'est un problème

Si l'API `/api/shared-carts/from-cart-items` est appelée hors front officiel, ou si un bug front envoie un numéro local brut, le backend rejette. C'est cohérent avec une API stricte, mais incohérent avec l'expérience utilisateur attendue et le guard frontend.

### Risque

Créations guest rejetées pour des numéros pourtant valides culturellement (`06...`, `3211234`).

### Correction recommandée

Centraliser la normalisation téléphone dans un util backend partagé, par exemple :

```txt
utils/phone.js
normalizePhone(raw, defaultCountry?)
```

Puis :

- `auth-guest.js` utilise `normalizePhone(raw, '+269' ou '+33')` ;
- les routes sensibles peuvent imposer E.164 en sortie ;
- le front garde son sélecteur pays, mais le backend ne dépend plus uniquement de lui.

---

## A-BE-05 — `routes/purchasing.js` reste un gros bloc métier inline

**Sévérité : 🟠 Moyenne**  
**Fichier :** `routes/purchasing.js`

### Constat

Malgré plusieurs refactos `GOD-FILES`, `routes/purchasing.js` contient encore :

- `triggerPurchasing(orderId)` ;
- notifications admin/fournisseur ;
- stubs API fournisseurs ;
- logique savepoint par item ;
- routes fournisseurs ;
- routes réception hub ;
- transitions commande `ordered → preparation` ;
- déclenchement `triggerScan3`.

### Pourquoi c'est risqué

Ce fichier mélange :

```txt
route HTTP admin
moteur métier sourcing
notification
intégration fournisseur future
réception hub
transition commande
```

Le fait que `triggerPurchasing()` soit exporté depuis une route (`module.exports.triggerPurchasing = triggerPurchasing`) est un signe d'architecture inversée : des services peuvent dépendre d'un fichier de routes.

### Risque

- dépendances circulaires ;
- bugs de boot ;
- transition commande cassée lors d'une refonte UI admin ;
- tests difficiles ;
- difficulté à garantir l'idempotence sourcing.

### Correction recommandée

Lot `PURCHASING-SERVICE-1` :

```txt
services/purchasing-trigger-service.js
services/purchasing-notification-service.js
services/purchasing-receive-service.js
routes/purchasing.js = façade HTTP uniquement
```

Commencer par extraire `triggerPurchasing(orderId)` sans changer le comportement.

---

## A-BE-06 — `processRefundWithFallback()` moins robuste que `processRefund()`

**Sévérité : 🟡 Moyenne**  
**Fichier :** `services/refund-service.js`

### Constat

`processRefund()` a été durci : il insère une ligne `refunds` en `pending` avant l'appel Stripe, puis met à jour en `completed`.

Mais `processRefundWithFallback()` :

- appelle Stripe ;
- fallback wallet si échec ;
- insère la ligne `refunds` seulement à la fin.

### Pourquoi c'est moins robuste

Si Stripe rembourse puis que l'INSERT final échoue, on peut avoir un remboursement réel sans trace DB dans cette variante.

### Risque

Écart comptable rare mais critique dans les chemins utilisant `processRefundWithFallback()`.

### Correction recommandée

Aligner `processRefundWithFallback()` sur `processRefund()` :

1. créer un row `refunds.status='pending'` avant l'appel externe ;
2. update `completed` si Stripe ou wallet OK ;
3. update `failed` avec payload d'erreur si les deux échouent ;
4. idempotence via `idempotencyKey` stable.

---

## A-BE-07 — `CONTRACTS.md` liste encore le collectif comme service critique actif

**Sévérité : 🟡 Moyenne**  
**Fichier :** `docs/CONTRACTS.md`

### Constat

`CONTRACTS.md` inclut encore :

- `collective-workspace-engine.js` ;
- `collective-payment-orchestrator.js` ;
- consommateurs `routes/collective-workspaces.js`, `routes/collective-payments.js`, webhook collectif.

Mais la doctrine actuelle dit que ce modèle est tombstoné et que le modèle actif est le panier partagé boutique-first.

### Risque

Un développeur peut croire que le collectif est encore un service critique à maintenir/étendre.

### Correction recommandée

Mettre à jour `CONTRACTS.md` :

- déplacer les services collectifs dans une section `Legacy tombstone — ne pas étendre` ;
- retirer `collective_payment` des sources actives si le runtime est vraiment désactivé ;
- renforcer `shared-cart-engine + shared-cart-financial-guard` comme contrat actif.

---

## A-BE-08 — Export public inutile de `confirmContributionFromStripe`

**Sévérité : 🟡 Moyenne**  
**Fichier :** `services/shared-cart-engine.js`

### Constat

Même finding racine que A-BE-01, mais côté API de module : l'export public expose une primitive financière qui ne devrait plus être consommée.

### Correction recommandée

Supprimer de `module.exports` et ajouter un test contractuel simple :

```js
expect(engine.confirmContributionFromStripe).toBeUndefined();
```

ou un test grep dans `scripts/audit-backend-arch.js`.

---

## A-BE-09 — Expiration/annulation panier partagé laisse une dette refund manuelle

**Sévérité : 🟡 Moyenne**  
**Fichiers :**

- `services/shared-cart-engine.js`
- `routes/shared-cart.js`
- `services/shared-cart-refund-queue.js`

### Constat

`cancelSharedCart()` note explicitement :

```js
// NOTE : refunds des contributions = action manuelle admin pour le MVP
```

`expireOldCarts()` expire les paniers `active` / `partially_funded` et insère un événement, sans opération financière automatique.

### Pourquoi ce n'est pas un bug bloquant

C'est conforme au MVP validé : refund queue et mark-refunded manuel.

### Risque

C'est une dette opérationnelle : des contributions payées sur paniers expirés/annulés nécessitent un traitement admin fiable. Si l'admin ne traite pas, l'argent reste en anomalie.

### Recommandation

Avant go-live : vérifier explicitement que la refund queue affiche :

- paniers `cancelled` avec `contributed_kmf > 0` ;
- paniers `expired` avec `contributed_kmf > 0` ;
- contributions `failed` avec `requires_manual_refund=true`.

Ajouter un test e2e admin refund queue.

---

## A-BE-10 — Logs Pino parfois appelés avec arguments non structurés

**Sévérité : 🟢 Faible**  
**Fichiers observés :**

- `routes/shared-cart.js`
- `routes/purchasing.js`
- `services/refund-service.js`

### Constat

Plusieurs logs utilisent encore le style :

```js
log.error('[shared-cart webhook] signature invalide :', err.message);
log.warn('[purchasing] triggerScan3 non disponible:', e.message);
```

Pino préfère :

```js
log.error({ err }, 'shared-cart webhook signature invalide');
log.warn({ err }, 'triggerScan3 non disponible');
```

### Risque

Perte d'informations structurées dans les logs, surtout sur Railway.

### Correction recommandée

Lot de nettoyage faible risque : remplacer les appels non structurés par `{ err }` ou payload objet.

---

# 3. Liste des non-findings importants

Ce qui a été cherché et n'a pas révélé de bug direct :

- pas de mutation directe évidente `UPDATE orders SET status` hors machine ;
- pas de `store_credits` actif dans routes/services ;
- pas de `localStorage.setItem` JWT actif trouvé côté backend ;
- le webhook panier partagé actif utilise bien le guard financier ;
- les webhooks Stripe raw sont montés avant `express.json` ;
- le hotfix `Payer en groupe` ne modifie pas le backend.

---

# 4. Plan de correction proposé

## Lot P0 — Contrats et surfaces financières

### P0-1 — Supprimer l'ancien export financier shared-cart

- retirer `confirmContributionFromStripe` de `module.exports` ;
- éventuellement renommer la fonction en `_legacyConfirmContributionFromStripe_DO_NOT_USE` ou la supprimer ;
- ajouter un test contractuel ;
- mettre à jour `CONTRACTS.md`.

### P0-2 — Corriger le contrat `transitionOrderStatus`

- aligner `CONTRACTS.md` sur `newStatus` ;
- ou accepter `targetStatus` comme alias dans le code ;
- ajouter un test pour `targetStatus` si alias accepté.

### P0-3 — Finaliser le tombstone runtime collectif

- ne plus démarrer le cron no-op ;
- clarifier montage webhook collectif : soit supprimé, soit gardé explicitement comme `410/ignored` ;
- déplacer le legacy dans une section bootstrap isolée.

## Lot P1 — Robustesse API

### P1-1 — Normalisation téléphone backend unifiée

- créer `utils/phone.js` ;
- utiliser dans `auth-guest.js` ;
- garder E.164 comme sortie unique ;
- tester `+33`, `0033`, `06`, `+269`, `3211234`.

### P1-2 — Refund fallback robuste

- aligner `processRefundWithFallback()` sur le modèle pending → completed/failed ;
- conserver idempotency key stable.

### P1-3 — Refund queue panier partagé

- ajouter tests refund queue sur `cancelled`, `expired`, `paid_not_counted`.

## Lot P2 — Architecture / maintenabilité

### P2-1 — Extraire `routes/purchasing.js`

- sortir `triggerPurchasing` en service ;
- sortir notifications ;
- sortir réception hub ;
- route = façade HTTP.

### P2-2 — Logs structurés

- convertir les derniers `log.xxx('msg', err.message)` vers `log.xxx({ err }, 'msg')`.

---

# 5. Verdict go-live

## Bloquant strict go-live

Aucun bug runtime prouvé comme bloquant absolu dans le chemin principal paiement/commande, à condition que :

- les webhooks Stripe restent raw ;
- le panier partagé continue d'utiliser `confirmContributionFromStripeSafely()` ;
- la refund queue admin soit testée manuellement ;
- le flux `Payer en groupe` soit retesté après le hotfix.

## À corriger avant ouverture large

- A-BE-01 : ancien export financier shared-cart ;
- A-BE-02 : contrat `targetStatus` vs `newStatus` ;
- A-BE-03 : runtime collectif encore monté partiellement ;
- A-BE-04 : normalisation téléphone backend.

## À surveiller opérationnellement

- contributions payées non comptées / expirées ;
- paniers annulés avec contributions ;
- fallback refund ;
- état sourcing/réception dans `purchasing.js`.

---

# 6. Conclusion

Le backend est assez proche d'un état go-live, mais pas encore parfaitement verrouillé sur les contrats. La priorité n'est pas d'ajouter des fonctionnalités : c'est de retirer les doubles chemins financiers, aligner les contrats, finir le tombstone collectif, et rendre la normalisation téléphone backend aussi robuste que le front.

La correction la plus urgente n'est pas longue : elle tient en 2 ou 3 PR courtes, à faible risque, avant de reprendre les gros refactos.
