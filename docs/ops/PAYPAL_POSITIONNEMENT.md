# Positionnement et intégration PayPal — diaspora Komores

> Statut : note de design — pas un lot exécutable, prêt à devenir le lot `PAYPAL-1`
> Date : 17 mai 2026
> But : cadrer comment et quand intégrer PayPal, avec un focus sur Pay-in-4 diaspora.

---

## 1. Pourquoi PayPal compte pour Komerce

### 1.1 La diaspora paie autrement que le client local

Tes clients diaspora (France, Belgique, US, autres) :

- **Préfèrent PayPal à la carte bancaire** quand il s'agit d'envoyer de l'argent vers un service "exotique" (Komerce vue depuis la France n'est pas Amazon — la confiance carte directe est faible).
- **Sont la cible de Pay-in-4** (paiement en 4 fois sans frais pour le client, frais payés par le marchand). C'est l'argument d'achat pour les paniers à 150-400 EUR (typique cérémonie, événement collectif).
- **Ont déjà un compte PayPal** alors qu'ils n'ont pas forcément renseigné leur carte sur ton site.

### 1.2 Le différentiel business est clair

| Critère | Stripe seul | Stripe + PayPal |
|---|---|---|
| Conversion diaspora | ~40-60 % (estimation) | ~70-85 % (estimation) |
| Panier moyen Pay-in-4 | non disponible | accessible |
| Friction carte bancaire | élevée pour nouveaux clients | contournée par compte PP existant |
| Coût marchand | 1.5 % + 0.25 € | 2.99 % + 0.35 € (PayPal Pay in 4 inclus sans surcoût) |

**Pay-in-4 est inclus sans surcoût backend** : PayPal le propose automatiquement au check-out si le montant est dans la fenêtre éligible (30-1500 EUR généralement). Pas de code spécifique côté Komerce.

### 1.3 Position dans la stack actuelle

Aujourd'hui, l'ENUM DB `payment_mode` = `stripe_eur`, `cash_relais`, `mixed_shared_cart_cash`.

PayPal s'insère **exactement comme Stripe** :
- une route dédiée pour create-order / capture / webhook ;
- un service wrapper SDK ;
- une nouvelle valeur d'ENUM `paypal_eur` ;
- une nouvelle source de transition `paypal_capture` dans la machine à états ;
- un secret webhook supplémentaire.

**Aucune refacto de la machine à états nécessaire.** L'invariant I-02 inclut déjà "tout paiement → `pending → confirmed`", il faut juste autoriser la nouvelle source.

---

## 2. Ce qui existe déjà dans le repo

Bonne nouvelle : **PayPal a déjà été pensé** comme lot post-go-live. Référence : `docs/BACKEND_AUDIT_CORRECTIONS.md` §7.

Ce qui est déjà acté :
- Compatibilité architecture confirmée.
- Liste de fichiers à créer/modifier listée.
- Priorité "post go-live, souhaitable, non bloquant".

Ce qui manque (et que cette note complète) :
- Le **séquencement** (avant ou après quels lots ?).
- Le **modèle de données** (colonnes à ajouter dans `orders` et nouvelles tables éventuelles).
- La **stratégie test** sandbox vs prod.
- Le **wiring frontend** (où placer le bouton, sur quelles surfaces).
- Le **fallback** si PayPal échoue ou est indisponible.
- La **gestion des disputes / refunds** spécifique PayPal.

---

## 3. Modèle de données — ce qu'il faut ajouter

### 3.1 ENUM `payment_mode` — étendre

```sql
ALTER TYPE payment_mode ADD VALUE 'paypal_eur';
```

Migration à ajouter dans `migrations/0XX_add_paypal_payment_mode.sql`.

### 3.2 Table `orders` — colonnes additionnelles

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_order_id      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_capture_id    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_payer_email   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_payer_id      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_pay_in_4_used BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_orders_paypal_order_id ON orders(paypal_order_id);
```

Cohérent avec `stripe_payment_id` / `stripe_payer_email` qui existent déjà.

### 3.3 Table d'idempotence webhook PayPal

Comme `stripe_events_processed`, créer :

```sql
CREATE TABLE IF NOT EXISTS paypal_events_processed (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload      JSONB
);
```

Garantie I-07 : pas de double traitement d'un webhook PayPal.

### 3.4 Source de transition dans `order-status-machine.js`

Ajouter `'paypal_capture'` aux sources autorisées pour la transition `pending → confirmed`.

Code à modifier (ligne ~XXX de `services/order-status-machine.js`) :

```js
} else if (['stripe_webhook', 'cash_confirm', 'wallet_full_payment',
             'shared_cart_full_payment', 'paypal_capture'].includes(source)) {
  // ... même logique
}
```

Mettre à jour `CONTRACTS.md §3` (paramètre `source` de `transitionOrderStatus`).
Mettre à jour `ZONE_IMPACT.md §I-02` (PayPal ajouté à la liste des sources autorisées).

---

## 4. Fichiers à créer

### 4.1 `services/paypal-client.js` — wrapper SDK (≈ 200L)

Responsabilités :
- Initialisation du SDK PayPal (sandbox vs production via `PAYPAL_ENV`).
- `createOrder({ amount_eur, currency, reference, return_url, cancel_url })` → renvoie `paypal_order_id`.
- `captureOrder(paypal_order_id)` → renvoie `capture_id` + détails payeur.
- `verifyWebhookSignature(headers, body)` → valide la signature PayPal.
- `refundCapture(capture_id, amount_eur, reason)` → pour les refunds.
- `getDispute(dispute_id)` → pour le suivi litiges.

Convention de nommage et structure identiques à `services/stripe-client.js` (s'il existe, sinon s'aligner sur l'usage actuel de `routes/payments.js`).

### 4.2 `routes/payments-paypal.js` — endpoints HTTP (≈ 350L)

Endpoints :

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/payments/paypal/create-order` | Crée une commande PayPal, renvoie `paypal_order_id` au front. Auth required. |
| POST | `/api/payments/paypal/capture/:orderId` | Capture une commande après approval. Met à jour `orders`, déclenche `confirmPaymentCycle`. |
| POST | `/api/payments/paypal/webhook` | Webhook idempotent (cf. `paypal_events_processed`). Body brut obligatoire (I-07). |
| POST | `/api/payments/paypal/refund/:orderId` | Refund initié côté admin (utilise `refundCapture` du wrapper). |

**Garde-fous critiques** :
- Webhook PayPal monté **avant `express.json`** dans `server.js` (lignes 129-131 actuellement Stripe). I-07.
- Capture doit appeler `confirmPaymentCycle({ source: 'paypal_capture', ... })`. **Jamais d'`UPDATE orders SET status` direct** (I-01).
- Idempotence via `paypal_events_processed` avant tout traitement.
- Validation montant : `payload.amount` doit correspondre à `orders.total_eur` (anti-manipulation client).

### 4.3 Variables d'environnement à ajouter

```env
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
PAYPAL_ENV=sandbox  # ou 'production'
```

À ajouter dans :
- `server.js` `REQUIRED_ENV` (refus de boot si manquant en prod).
- `.env.example` (avec placeholders).
- Railway dashboard (config prod).

---

## 5. Frontend — où placer le bouton

### 5.1 Surfaces concernées

| Surface | Action attendue |
|---|---|
| `public/boutique/checkout.html` (ou équivalent) | Bouton "Payer avec PayPal" à côté de "Payer par carte (Stripe)". |
| `public/boutique/event/pay.html` | Idem, mais le contexte est event/cagnotte. Vérifier si PayPal est compatible (oui pour paiement simple, à valider pour collectif). |
| `public/boutique/shared-cart-*.html` | Idem panier partagé. |
| Pages admin | **Pas de bouton PayPal côté admin.** L'admin ne paie pas, il rembourse via une action dédiée. |

### 5.2 Composant à créer

`public/boutique/components/paypal-button.html` (ou JS equivalent) :

```html
<script src="https://www.paypal.com/sdk/js?client-id=__PAYPAL_CLIENT_ID__&currency=EUR&intent=capture&enable-funding=paylater"></script>

<div id="paypal-button-container"></div>

<script>
paypal.Buttons({
  // Pay in 4 inclus via enable-funding=paylater
  createOrder: async () => {
    const res = await fetch('/api/payments/paypal/create-order', {...});
    return (await res.json()).paypal_order_id;
  },
  onApprove: async (data) => {
    const res = await fetch(`/api/payments/paypal/capture/${data.orderID}`, {...});
    if (res.ok) window.location = '/confirmation';
  },
  onError: (err) => { /* affichage UX */ }
}).render('#paypal-button-container');
</script>
```

**Important** : le paramètre `enable-funding=paylater` active Pay-in-4 automatiquement quand le montant est éligible. **Pas de code spécifique à écrire**.

### 5.3 Fallback si PayPal indisponible

Le SDK PayPal peut être bloqué (adblock, réseau d'entreprise, etc). Le bouton Stripe doit toujours rester visible comme alternative. Si seul PayPal s'affiche et qu'il échoue, le client est bloqué.

---

## 6. Stratégie test et déploiement

### 6.1 Phase 1 — sandbox (1 semaine)

- Compte PayPal sandbox dédié.
- Webhook pointant vers staging Railway.
- Toutes les routes branchées, tests E2E manuels :
  - paiement simple commande standard ;
  - paiement Pay-in-4 (montant > 30 €) ;
  - webhook reçu et traité (idempotent) ;
  - refund partiel ;
  - dispute mockée (PayPal sandbox permet de simuler).

### 6.2 Phase 2 — prod limitée (2 semaines)

- Production PayPal active **mais bouton PayPal n'apparaît que pour 1 client sur 10** (A/B via cookie ou random seed).
- Surveiller :
  - taux de conversion comparé Stripe ;
  - taux d'échec capture ;
  - latence webhook (PayPal peut être plus lent que Stripe) ;
  - réconciliation comptable.

### 6.3 Phase 3 — généralisation

Si phase 2 OK pendant 2 semaines :
- Bouton PayPal visible pour 100 % des clients.
- Communication diaspora ("Paiement en 4 fois disponible").

---

## 7. Cas particuliers

### 7.1 Panier partagé (`shared-carts`)

Le panier partagé a déjà son propre webhook Stripe. Si PayPal doit fonctionner sur panier partagé, **prévoir un webhook PayPal dédié** `routes/shared-cart-paypal.js` ou ajouter le routage dans le webhook PayPal principal.

**Recommandation** : phase 1, PayPal commandes standard uniquement. Panier partagé en phase 2 séparée.

### 7.2 Panier collectif (`collective-workspaces`)

Le collectif fonctionne avec capture différée Stripe (capture en bloc à finalisation). PayPal supporte aussi la **capture différée** (`intent=authorize` + capture manuelle), mais c'est plus complexe à orchestrer.

**Recommandation** : phase 1, **pas de PayPal sur le collectif**. Stripe reste la seule option pour ce flux. Évaluer en phase 3.

### 7.3 Wallet et avoirs

Pas d'impact. Le wallet est interne, indépendant du moyen de paiement initial. Une commande payée en PayPal peut être remboursée en wallet, et un wallet peut couvrir partiellement un solde payé en PayPal.

### 7.4 Cash relais

Aucun impact. Cash et PayPal sont mutuellement exclusifs (le client choisit l'un OU l'autre au check-out).

### 7.5 Disputes PayPal

PayPal a un système de litiges plus client-friendly que Stripe (le client a 180 jours pour ouvrir un litige, vs 120 chez Stripe). À surveiller :

- ajouter une table `paypal_disputes` (similaire à la table `disputes` existante mais spécifique) ;
- workflow admin : recevoir le webhook `CUSTOMER.DISPUTE.CREATED`, créer une ligne, alerter l'admin.

À traiter en **lot séparé `PAYPAL-2`** après que `PAYPAL-1` soit stable.

---

## 8. Coût estimé du lot `PAYPAL-1`

| Tâche | Charge |
|---|---|
| Migration DB (ENUM + colonnes + table webhook) | 0.5 j |
| `services/paypal-client.js` wrapper SDK | 1 j |
| `routes/payments-paypal.js` (4 endpoints) | 1.5 j |
| Modifs `order-status-machine.js` + `orders/create.js` | 0.5 j |
| Mise à jour `server.js` REQUIRED_ENV + webhook raw | 0.5 j |
| Mise à jour socle doc (CARTOGRAPHY, CONTRACTS, SCHEMA, ZONE_IMPACT) | 0.5 j |
| Composant frontend `paypal-button.html` | 0.5 j |
| Tests sandbox E2E manuels | 1 j |
| **Total backend + intégration** | **6 jours** |

Plus :
- Configuration compte PayPal Business (côté ops, pas dev) : 1 jour calendaire.
- Phase 2 prod limitée : 2 semaines de monitoring (passive).

---

## 9. Quand déclencher ce lot ?

### 9.1 Conditions de démarrage

- `I-SWEEP` mergé (correction des violations d'invariants) — sinon on greffe sur du code branlant ;
- `TEST-1` en place (tests d'intégration sur invariants) — sinon on ne saura pas si PayPal casse une transition ;
- Compte PayPal Business validé (KYC, IBAN diffusion).

### 9.2 Conditions de non-démarrage

- **Pendant le chantier d'audits** : on n'ajoute pas de surface attaquable.
- **Si pas de demande client claire** : ce lot est une opportunité business, pas une urgence technique.

---

## 10. Synthèse

**Position de PayPal dans la stack** : un **frère jumeau de Stripe**, isolé dans son propre service + sa propre route. Aucune refacto cœur nécessaire. Pay-in-4 inclus gratuitement.

**Vraie valeur** : conversion diaspora améliorée (estimation +30 points) sur les paniers cérémonie/événement à 150-400 €.

**Coût** : 6 jours dev backend + frontend + 2 semaines monitoring en prod limitée.

**Séquence** :

```
1. Fin chantier audits (D2-D8 + G + E + F + H)
2. I-SWEEP (corrections invariants)
3. TEST-1 (filet)
4. REFAC-pricing (optionnel)
5. PAYPAL-1 — implémentation phase 1 sandbox
6. PAYPAL-1.5 — phase 2 prod limitée
7. PAYPAL-1.6 — généralisation
8. PAYPAL-2 — disputes + panier collectif (plus tard)
```

**Pas avant `I-SWEEP` + `TEST-1`**. Le risque sinon : tu implémentes PayPal correctement, mais ChatGPT en train d'auditer G1 te modifie `order-status-machine.js` en parallèle, conflit Git assuré.

---

## Annexe — Checklist de mise en route `PAYPAL-1`

- [ ] Compte PayPal Business créé + sandbox configurée
- [ ] `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` ajoutés Railway sandbox
- [ ] Migration DB appliquée (ENUM + colonnes + table)
- [ ] `services/paypal-client.js` créé + testé en isolation
- [ ] `routes/payments-paypal.js` créé + monté dans `server.js`
- [ ] Webhook PayPal en `express.raw` **avant `express.json`** (vérif visuelle I-07)
- [ ] `order-status-machine.js` accepte `'paypal_capture'` comme source
- [ ] `CARTOGRAPHY_360.md`, `CONTRACTS.md`, `SCHEMA.md`, `ZONE_IMPACT.md` mis à jour
- [ ] `paypal-button.html` rendu sur surface de test
- [ ] Test E2E sandbox : paiement simple OK
- [ ] Test E2E sandbox : Pay-in-4 OK (montant > 30 €)
- [ ] Test E2E sandbox : webhook idempotent OK
- [ ] Test E2E sandbox : refund OK
- [ ] PR ouvre, revue, merge sur main
- [ ] `STATUS.md` met à jour, `BACKEND_GOLIVE_ROADMAP.md` ajoute `PAYPAL-1` coché
