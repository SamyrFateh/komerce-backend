# Analyse refacto routes backend — 2026-06-14

> Scope : routes backend Express.  
> Objectif : identifier les refactos utiles sans refacto-mania.  
> Principe : une route doit valider, autoriser, appeler un service, répondre. Elle ne doit pas porter la décision métier profonde.

---

## 1. Verdict court

Le chantier routes est **moins mauvais que l'ancien audit ne le laisse penser**.

Depuis l'audit initial, plusieurs gros fichiers ont déjà été transformés en façades :

- `routes/orders.js` est un agrégateur mince vers `routes/orders/*` ;
- `routes/dashboard.js` est devenu un point de montage de sous-routers ;
- `routes/admin.js` est devenu une façade rétrocompatible vers `routes/admin/index.js` ;
- `server.js` a déjà délégué le montage API principal à `bootstrap/api-routes.js`.

Donc la priorité n'est plus de découper aveuglément `dashboard.js` ou `admin.js`. La priorité est de traiter les routes qui portent encore de vraies règles métier :

```txt
P0 — pricing.js
P0 — sourcing-engine.js
P1 — pickup-secret.js
P1 — payments-paypal.js
P1 — shared-cart.js
P2 — scans.js / hub-dashboard.js / parcel-api-v2.js
```

---

## 2. Ce qui est déjà propre

### 2.1 `routes/orders.js`

Bon modèle cible : agrégateur mince.

Il ne contient presque pas de logique métier. Il monte simplement les sous-routes dans un ordre maîtrisé : list, QR, parcels, cancel, status, create, detail.

Cible à répliquer ailleurs :

```txt
routes/domain.js              ← agrégateur mince
routes/domain/*.js            ← handlers spécialisés
services/domain/*.js          ← logique métier testable
```

---

### 2.2 `routes/dashboard.js`

L'ancien audit disait que `routes/dashboard.js` faisait 2 614 lignes. Ce n'est plus vrai dans le repo courant : il est maintenant une façade qui monte :

- `dashboard-ops` ;
- `dashboard-finance` ;
- `dashboard-clients` ;
- `dashboard-hub`.

Conclusion : **ne pas ouvrir un lot B3 sur `dashboard.js` tel quel**. Le bon audit est désormais sur les sous-routers et `services/dashboard-metrics.js`.

---

### 2.3 `routes/admin.js`

`routes/admin.js` est maintenant une façade rétrocompatible vers `routes/admin/index.js`.

`routes/admin/index.js` monte des sous-domaines : customs, partners, users, dashboard, system, orders.

Conclusion : **B4 ancien est déjà largement fait**. Le prochain travail n'est pas split admin.js ; c'est audit des sous-routers admin sensibles, surtout `system`, `orders`, `users`.

---

### 2.4 `bootstrap/api-routes.js`

Le montage des routes est centralisé. C'est sain.

Point positif : les routes Stripe-owned restent dans `server.js` pour préserver l'ordre raw body avant `express.json`.

Point à surveiller : le manifest grossit et mélange domaines client, admin, legacy, v2, alias. À terme, on peut le découper en manifests thématiques, mais ce n'est pas urgent.

---

## 3. Routes encore à refactorer

## P0 — `routes/pricing.js`

### Pourquoi c'est prioritaire

Le pricing touche directement :

- prix client ;
- marge ;
- taux ;
- benchmark ;
- application de prix en masse ;
- survie économique du modèle.

Le fichier utilise déjà des services (`pricing-engine`, `pricing-recommend`, `pricing-dashboard`), mais plusieurs décisions et écritures restent dans la route :

- lecture directe DB produits/fabrics/models ;
- calcul couture inline ;
- mise à jour des taux `finance_config` ;
- insertion `exchange_rates` ;
- application prix produit ;
- historique `price_history` ;
- batch `apply-all` transactionnel.

### Refacto cible

Créer :

```txt
services/pricing/
  index.js
  rates-service.js           # get/update rates + exchange history + cache invalidation
  quote-service.js           # calculate product/couture quote
  price-application-service.js # apply one/all prices + price_history
  guards.js                  # survival price, input normalization
```

Puis découper les routes :

```txt
routes/pricing.js            # façade rétrocompat
routes/pricing/quotes.js     # /calculate, /couture
routes/pricing/rates.js      # /rates
routes/pricing/recommend.js  # /recommend, /recommend-batch
routes/pricing/apply.js      # /apply-price, /apply-all
routes/pricing/dashboard.js  # /benchmarks, /dashboard
```

### Règle de sécurité

Ne pas modifier `services/pricing-engine.js` dans le même lot. D'abord sortir la route. Ensuite seulement, lot séparé si le service engine doit être découpé.

### Tests minimum

- calculate produit normal ;
- couture ;
- update rates admin ;
- apply-price sous seuil de survie refusé ;
- apply-all batch ;
- price_history inséré ou fallback gracieux.

---

## P0 — `routes/sourcing-engine.js`

### Pourquoi c'est prioritaire

Le sourcing est un axe business futur. Il ne doit pas rester dans une route.

Le fichier a déjà commencé à sortir la lecture vers `services/sourcing-analysis.js`, ce qui est très bon. Mais il garde encore :

- mutations produits ;
- bulk rail ;
- validation variants ;
- transaction remplacement variants ;
- synchronisation `cost_price_kmf/cost_kmf` et `weight_g/weight_kg`.

### Refacto cible

Créer :

```txt
services/sourcing/
  index.js
  product-enrichment-service.js
  bulk-rail-service.js
  variants-service.js
  sourcing-normalizer.js
```

Route cible :

```txt
routes/sourcing-engine.js
  GET /analysis          → sourcingAnalysis.getAnalysis
  GET /analysis/:id      → sourcingAnalysis.getAnalysisById
  GET /synthesis         → sourcingAnalysis.getSynthesis
  PUT /products/:id      → sourcingProductEnrichment.update
  POST /bulk-rail        → sourcingBulkRail.assign
  GET /config            → sourcingAnalysis.getConfig
  GET /products/:id/variants → sourcingVariants.list
  PUT /products/:id/variants → sourcingVariants.replaceAll
```

### Règle de sécurité

Conserver la synchronisation des colonnes doublons tant que la DB n'est pas normalisée. Le service doit porter cette dette explicitement, pas la cacher.

### Tests minimum

- enrichissement produit avec cost/weight synchronisés ;
- bulk rail ;
- variants : liste, remplacement, tableau vide ;
- refus si variante invalide ;
- transaction rollback si un insert variant échoue.

---

## P1 — `routes/pickup-secret.js`

### État actuel

Le gros risque métier `/pay-cash` a déjà été extrait vers `services/confirm-pickup-cash-payment.js`, et la route appelle maintenant ce service. C'est un très gros progrès.

Mais le fichier reste sensible et long, car il porte encore :

- génération / hash / normalisation code ;
- reçu imprimable one-shot ;
- vérification code ;
- collecte ;
- régénération admin ;
- gestion tokens d'impression.

### Refacto cible

Créer :

```txt
services/pickup-secret/
  code-generator.js
  pickup-secret-service.js
  receipt-token-service.js
  verification-service.js
  collection-service.js
  regeneration-service.js
```

Et :

```txt
routes/pickup-secret.js      # façade mince
routes/pickup-secret/pay-cash.js
routes/pickup-secret/receipt.js
routes/pickup-secret/verify.js
routes/pickup-secret/collect.js
routes/pickup-secret/regenerate.js
```

### Règle de sécurité

Ne pas toucher à ce lot sans tests. Le secret de retrait est client-visible et argent/logistique sensible.

### Tests minimum

- pay-cash nominal ;
- replay pay-cash ;
- receipt token one-shot ;
- verify mauvais code bloque après N tentatives ;
- collect après verify ;
- regenerate admin.

---

## P1 — `routes/payments-paypal.js`

### Pourquoi le refactorer

Le fichier est correctement documenté et très conscient des invariants, mais il porte un flow complet : create-order, capture, webhook, refund.

Comme il touche l'argent, la lisibilité est bonne mais la testabilité gagnerait à extraire le métier.

### Refacto cible

Créer :

```txt
services/paypal-payment-service.js
  createOrderForKomerceOrder(...)
  capturePayPalOrder(...)
  handlePayPalWebhook(...)
  refundPayPalOrder(...)
```

Route cible : handlers très courts.

### Règle de sécurité

Ne pas refactorer avant d'avoir des tests sur capture nominale, capture replay, webhook replay, montant manipulé, order déjà paid.

---

## P1 — `routes/shared-cart.js`

### État actuel

Le fichier a beaucoup évolué vers Boutique First. Il porte encore :

- estimations ;
- contributions ;
- Stripe checkout shared-cart ;
- webhook ;
- admin actions ;
- mapping d'erreurs ;
- vocabulaire métier visible.

Le paiement est correctement gardé côté route : paiement public seulement si status `closed`, plafonnement au `remaining_kmf`, retour Stripe vers la boutique.

### Refacto cible

Créer :

```txt
routes/shared-cart.js               # façade export router/adminRouter/webhookHandler
routes/shared-cart/public-read.js
routes/shared-cart/estimations.js
routes/shared-cart/contributions.js
routes/shared-cart/stripe-webhook.js
routes/shared-cart/admin.js
```

Services :

```txt
services/shared-cart-payment-service.js
services/shared-cart-wording-service.js
services/shared-cart-return-service.js
```

### Règle de sécurité

Ne pas changer le comportement de paiement dans le refacto. Le premier lot doit être déplacement pur.

### Bonus immédiat

Remplacer les messages API encore trop anciens :

```txt
entièrement financé → déjà réglé
contribution → règlement
En attente de décision du créateur → fermé
```

---

## P2 — `routes/scans.js`

### Pourquoi P2

Le scan est métier critique logistique, mais il est moins urgent que prix/sourcing/paiement.

Il mérite un découpage par étapes : scan create, transitions, collect, sync parcels, SMS.

### Refacto cible

```txt
services/scans/scan-transition-service.js
services/scans/parcel-sync-service.js
services/scans/scan-notification-service.js
routes/scans.js ou routes/scans/*.js
```

---

## P2 — `routes/hub-dashboard.js`, `routes/admin-radar.js`, `routes/parcel-api-v2.js`

Ces fichiers semblent surtout lourds par accumulation d'écrans/queries, pas forcément par invariants argent. À traiter après pricing/sourcing/pickup/shared-cart.

---

## 4. Ordre recommandé des lots

### Lot R0 — Mettre à jour le garde-fou architecture

Le script `scripts/audit-backend-arch.js` contient encore une allowlist partiellement datée : par exemple `routes/dashboard.js` et `routes/admin.js` y sont encore listés comme gros fichiers, alors qu'ils sont maintenant minces.

Action : mettre à jour l'allowlist et générer une photo live.

Risque : nul.

---

### Lot R1 — Pricing route split

Refacto de `routes/pricing.js` en façade + sous-routers + services de mutation.

Risque : moyen, impact business fort.

Pourquoi d'abord : la route contient des écritures prix/taux/historique, donc forte valeur de propreté.

---

### Lot R2 — Sourcing mutations extraction

Extraire mutations, bulk rail, variants depuis `routes/sourcing-engine.js`.

Risque : moyen.

Pourquoi : sourcing est futur cœur business.

---

### Lot R3 — Shared-cart route split sans changement métier

Découper la route en modules publics / estimations / contributions / webhook / admin.

Risque : moyen.

Pourquoi : Boutique First devient central ; il faut éviter qu'une seule route concentre paiement + wording + admin + webhook.

---

### Lot R4 — Pickup-secret route split

Après tests. Extraire reçus, verify, collect, regenerate.

Risque : moyen-élevé.

---

### Lot R5 — PayPal route service extraction

Après tests de capture/webhook/replay.

Risque : élevé si non testé, raisonnable avec tests.

---

### Lot R6 — Scans/logistique

Découpage par étape + services.

Risque : moyen.

---

## 5. Forme cible d'une route propre

```js
router.post('/thing', authenticate, validate(schema), async (req, res, next) => {
  try {
    const result = await thingService.doThing({
      user: req.user,
      params: req.params,
      body: req.body,
    });
    res.status(result.status || 200).json(result.body || result);
  } catch (err) {
    next(err);
  }
});
```

La route ne doit pas contenir :

```txt
BEGIN / COMMIT complexes
boucles métier
calcul de prix
UPDATE financier
transition de statut
idempotence métier
fallback business silencieux
```

Ces éléments vont dans un service.

---

## 6. Règles anti-refacto dangereux

1. Une PR = un domaine.
2. Ne pas changer route path + logique métier en même temps.
3. Commencer par extraction pure, mêmes signatures, mêmes réponses.
4. Ajouter tests avant ou pendant le refacto si le domaine touche argent, pickup, stock ou statut.
5. Garder une façade rétrocompatible pendant au moins une itération.
6. Ne pas découper un service déjà cohérent juste parce qu'il est long.
7. Si une route est déjà façade mince, ne pas la toucher.

---

## 7. Conclusion

Le refacto utile n'est pas massif. Il est chirurgical.

Les anciens gros problèmes `orders`, `dashboard`, `admin` ont déjà été largement traités. Les vrais sujets restants sont les routes qui contiennent encore des transactions, mutations DB et décisions métier.

Priorité :

```txt
1. pricing.js
2. sourcing-engine.js
3. shared-cart.js
4. pickup-secret.js
5. payments-paypal.js
6. scans.js / logistique
```

La meilleure stratégie : faire peu de lots, très nets, avec tests sur les flows sensibles.
