# O7.2 — Cycle Analysis

> Rédigé au fil de l'eau, un cycle à la fois, avant/après chaque remédiation (§12 du prompt). Baseline O7.1 vérifiée à l'entrée : 4 cycles runtime, `ownership-review = 0`.

---

## Cycle A — notifications ↔ orders

### Direction notifications -> orders
- **Preuve** : `services/authkey-client.js -> services/invoice-public-token.js`
- **Service demandé** : signer une URL de facture brute en URL publique non-devinable, pour l'insérer dans un message WhatsApp texte libre détecté par regex (`looksLikeInvoiceMessage`).
- **Decision owner réel** : personne — ce chemin ne s'exécutait jamais. `services/notifications/order.js` faisait `require('./invoice-service')` avec un chemin relatif cassé (résolvait vers `services/notifications/invoice-service.js`, inexistant ; le vrai fichier est `services/invoice-service.js`, plat). L'exception était avalée silencieusement (`catch` non-fatal). Masqué en tests par un `jest.mock(..., { virtual: true })`.

### Direction orders -> notifications
- **Preuve** : 9 fichiers (`routes/orders/*.js`, `services/order-*.js`, etc.) → `services/notification-service.js`
- **Service demandé** : envoyer des notifications WhatsApp (commande créée, paiement confirmé, changement de statut, annulation).
- **Decision owner réel** : `orders` — légitime, établi, dominant (9 preuves vs 1).

### Workflow réel
```
ORDER CREATED / PAYMENT CONFIRMED / STATUS CHANGED
    ↓ (orders commande notifications — direction saine, majoritaire)
notifications envoie le message
    ↓ (sous-cas : message "facture prête")
notifications devait signer un lien — mais le code qui le faisait était mort
```

### Décision
- **orders -> notifications** : conservée telle quelle (`KEEP_AS_COMMAND_DEPENDENCY`).
- **notifications -> orders** : **REPLACE_WITH_INTERNAL_API**, supprimée. `orders` (`services/invoice-service.js`) construit et envoie désormais lui-même le message "facture prête" (nouvelle méthode `sendInvoiceReadyNotification`, corrige le bug dormant au passage), en appelant `notifyText` de `notification-service.js` — utilisant la direction déjà saine `orders -> notifications`, pas une nouvelle.
- **Boundary choisie** : pas d'event bus créé (aucun mécanisme événementiel autoritaire existant à réutiliser) — appel direct fire-and-forget, cohérent avec le reste du fichier.
- **Rationale** : `orders` possède la représentation publique de la facture ; `notifications` ne doit que transporter un message déjà prêt. Corrigeait aussi un vrai bug de production (fonctionnalité jamais exécutée).

---

## Cycle C — logistics ↔ purchasing

*(traité en 2e, conformément à l'ordre recommandé §12)*

### Direction logistics -> purchasing
- **Preuve** : `routes/pickup-secret.js -> routes/purchasing.js` (`require('./purchasing').triggerPurchasing`)
- **Service demandé** : après collecte cash relais, vérifier/déclencher un réapprovisionnement.
- **Decision owner réel** : `purchasing`, via `services/purchasing-trigger-service.js` — la route `routes/purchasing.js` ne faisait que ré-exporter ce service "pour compatibilité" (commentaire du fichier lui-même).

### Direction purchasing -> logistics
- **Preuve** : `services/purchasing-receive-service.js -> routes/scans.js` (`require('../routes/scans').triggerScan3`)
- **Service demandé** : après réception hub complète d'une purchase order, enregistrer un scan "préparation" + notifier le client.
- **Decision owner réel** : `logistics`, via `services/scan-operations.js` — même anti-pattern en miroir : `routes/scans.js` ré-exportait `triggerScan3` "pour compatibilité".

### Workflow réel
Deux workflows **indépendants**, pas un cycle causal unique :
```
Workflow 1 : collecte cash relais → logistics commande purchasing (réappro)
Workflow 2 : réception hub complète → purchasing commande logistics (scan + notif client)
```

### Décision
- **Anomalie prioritaire (§8 du prompt)** : les deux directions passaient par des fichiers ROUTE utilisés comme fausses APIs internes. Corrigé en premier : redirection vers les vrais services (`services/purchasing-trigger-service.js`, `services/scan-operations.js`), déjà utilisés directement ailleurs (`routes/cash.js`). Même correctif appliqué à `routes/payments.js` (`payments -> purchasing`, même anti-pattern, hors cycle mais découvert au passage).
- **Les deux directions : `KEEP_AS_COMMAND_DEPENDENCY`**, déclarées via `contract.consumes` (5 conditions §14 réunies : ownership confirmé, dépendance réelle, workflow tranché, boundary propre déjà existante après le fix ci-dessus, O5 observe la dépendance).
- **Rationale non circulaire** : ce n'est pas "les deux features ont besoin l'une de l'autre" (phrase interdite) — ce sont deux événements métier distincts (collecte cash vs réception hub) qui déclenchent chacun une commande unidirectionnelle vers l'autre feature. Le graphe cycle est un artefact de la détection par paire de features, pas un vrai couplage circulaire.
- **Objectif minimal atteint** : 0 import cross-feature vers `routes/purchasing.js` / `routes/scans.js` à la fin du cycle (vérifié).

---

## Cycle B — logistics ↔ payments

*(traité en 3e)*

### Direction logistics -> payments
- **Preuve 1** : `services/parcel-auto-create-service.js -> services/payment-service.js` (`markPaid`, appelé dans la transaction active du parcel).
- **Preuve 2** : `routes/pickup-secret.js -> services/confirm-pickup-cash-payment.js` (déjà un vrai service, pas une route).
- **Service demandé** : marquer une commande payée / confirmer transactionnellement un paiement cash pickup.
- **Decision owner réel** : `payments` — les deux preuves sont déjà service-à-service, aucun anti-pattern de route. Légitime tel quel.

### Direction payments -> logistics
- **Preuve** : `services/payment-paypal.js`, `services/payment-stripe.js`, `routes/pickup-pay-cash.js` → `routes/pickup-secret.js` (`generateAndStoreSecret`, `cacheCodeForReveal`) ; `services/reconciliation-service.js -> utils/parcels.js` (utilitaire pur, légitime, non anti-pattern).
- **Service demandé** : générer un code retrait au moment du paiement.
- **Découverte clé** : `services/pickup-secret-service.js` (logistics) **existait déjà** — extraction complète et testée (`tests/unit/pickup-secret-service.test.js`) — mais n'était jamais câblée. `routes/pickup-secret.js` gardait sa propre copie locale dupliquée de `generatePickupCode`/`hashCode`/`generateAndStoreSecret`/`cacheCodeForReveal` au lieu de déléguer au service.

### Workflow réel
```
Workflow 1 : cash collecté au pickup / paiement en ligne confirmé → payments commande le logistics
             pour générer un code retrait (avant même la confirmation finale)
Workflow 2 : collecte cash relais confirmée / stock insuffisant → logistics commande payments
             pour marquer payé / confirmer transactionnellement
```
Deux interactions distinctes, non circulaires.

### Décision
- **Anomalie prioritaire corrigée d'abord** : les 3 callers `payments` + `routes/payments.js` (pair distinct) redirigés vers `services/pickup-secret-service.js`, le vrai service déjà existant — 0 fichier créé, juste câblage. `routes/pickup-secret.js` bascule aussi vers ce service (retire ses 4 fonctions dupliquées).
- **Les deux directions : `KEEP_AS_COMMAND_DEPENDENCY`**, déclarées via `contract.consumes`.
- **Bug incident corrigé** : `logistics.feature.js` déclarait `'payment'`/`'notification'` (singulier, jamais résolus par le parseur de noms de features) au lieu de `'payments'`/`'notifications'` — bloquait ma propre déclaration, corrigé au passage.

---

## Cycle D — payments ↔ wallet

*(traité en dernier)*

### Direction payments -> wallet
- **Preuve** : canal interface, `public/boutique/js/b-checkout.js -> /api/wallet` (`routes/wallet.js`).
- **Service demandé** : lecture du solde wallet applicable, affiché au checkout.
- **Decision owner réel** : `wallet` (source du solde) ; `payments`/checkout consomme en lecture seule via HTTP.

### Direction wallet -> payments
- **Preuve** : `services/wallet-service.js -> services/payment-service.js` (`markPaid`, appelé dans la transaction active de `applyToOrder`, uniquement si le débit wallet couvre intégralement la commande restante).
- **Service demandé** : finaliser le règlement (`payment_status`) après un débit wallet complet.
- **Decision owner réel** : déjà documenté dans le code lui-même (commentaire `D-02`, invariant `I-BACK-4`) : *"wallet écrit wallet_applied_kmf, payment-service.markPaid() owne payment_status"* — séparation des responsabilités déjà propre, aucune écriture directe de `payment_status` par wallet.

### Workflow réel
```
Workflow 1 (lecture, HTTP) : checkout affiche le solde wallet disponible
Workflow 2 (transactionnel) : débit wallet complet → wallet finalise le paiement (délégation à payment-service, jamais d'écriture directe)
```
Le cycle est asymétrique dans sa forme (HTTP vs import direct) ET dans sa nature (lecture d'affichage vs finalisation transactionnelle) — deux interactions non circulaires.

### Décision
- **Les deux directions : `KEEP_AS_COMMAND_DEPENDENCY`**, déclarées via `contract.consumes`. Aucun changement de code (les deux boundaries étaient déjà propres — HTTP légitime d'un côté, service-à-service avec séparation documentée de l'autre).
- **Rationale** : `wallet` ne pilote pas le lifecycle global de paiement — il ne fait que déléguer la finalisation à `payment-service.js` une fois sa propre décision de débit prise (son domaine propre). Ce n'est pas wallet qui orchestre payments ; c'est wallet qui, ayant fini son travail, notifie/commande la finalisation exactement comme `logistics` le fait ailleurs (Cycle B) pour le même `markPaid()`.

---

## Synthèse

| Cycle | Direction cassée / requalifiée | Direction conservée | Verdict | Mécanisme |
|---|---|---|---|---|
| A — notifications↔orders | notifications→orders | orders→notifications | REPLACE_WITH_INTERNAL_API | Responsabilité déplacée vers orders (`invoice-service.js`) |
| C — logistics↔purchasing | (anti-pattern route corrigé des 2 côtés) | les deux, déclarées | KEEP_AS_COMMAND_DEPENDENCY ×2 | contract.consumes |
| B — logistics↔payments | (anti-pattern route corrigé côté payments→logistics) | les deux, déclarées | KEEP_AS_COMMAND_DEPENDENCY ×2 | contract.consumes |
| D — payments↔wallet | aucun changement de code | les deux, déclarées | KEEP_AS_COMMAND_DEPENDENCY ×2 | contract.consumes |

**runtime cycles = 0.** Aucune phrase "les deux features ont besoin l'une de l'autre" utilisée — chaque cycle accepté (B, C, D) est justifié par la démonstration que les deux directions sont des interactions **distinctes et non circulaires**, chacune avec un decision owner clair, désormais gouvernées par `contract.consumes` plutôt que silencieusement non déclarées.
