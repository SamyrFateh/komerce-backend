# CHECKOUT UNIFIED — plan d'attaque rapide

> Statut : chantier actif — août 2026
> Portée : boutique checkout / panier personnel / liste partagée
> Doctrine : le paiement est le seul acte engageant.

## 1. Problème actuel

Le parcours transactionnel boutique est éclaté en trois surfaces :

```text
Panier / Ma liste
      ↓
Récapitulatif de sélection
      ↓
Checkout / paiement
```

Le récapitulatif n'est pourtant pas un acte métier autonome : il répète une sélection déjà faite avant d'ouvrir le vrai checkout.

## 2. Cible

Passer à deux surfaces :

```text
Panier / Ma liste
      ↓
Checkout canonique
  ├─ sélection / récapitulatif
  ├─ identité
  ├─ retrait / livraison
  ├─ paiement
  └─ CTA final engageant
```

Le récapitulatif devient une région du checkout, jamais une étape.

## 3. Abstraction canonique cible

Toute entrée dans le checkout doit produire une `CheckoutSelection` indépendante de sa source :

```js
{
  source: 'personal-cart' | 'shared-list',
  sourceId: null | string,
  items: [...],
  total: number
}
```

Le checkout ne doit pas avoir deux moteurs selon la provenance des articles.

## 4. Verdict Feature First

### Pas de nouvelle feature `checkout`

La Feature Doctrine interdit les micro-features sans table propriétaire ni lifecycle métier propre. Le checkout boutique n'est donc **pas** une nouvelle `features/checkout.feature.js`.

`checkout` reste un **domaine UI / une projection-orchestration**. Son owner Feature First est **`orders`** : son service principal est de transformer une sélection en commande ; `payments`, identité et logistique sont des capacités traversées.

### orders

Devient owner explicite de la projection checkout boutique :
- orchestration du parcours de finalisation ;
- construction / validation future de `CheckoutSelection` ;
- récapitulatif intégré ;
- collecte des informations nécessaires à la commande ;
- déclenchement de la création de commande ;
- coordination avec `payments` pour l'encaissement ;
- succès / erreur / sortie du parcours.

`orders` reste naturellement propriétaire de :
- création de la commande ;
- référence et snapshot commande ;
- cycle de vie de la commande.

### payments

Reste propriétaire de :
- Stripe / PayPal / cash ;
- intents et événements ;
- confirmation / idempotence de l'encaissement.

`payments` ne possède plus les renderers / orchestrateurs généraux du checkout boutique. Il conserve ses composants payment-specific (`b-paypal.js`, `paypal.css`, etc.).

### shared-cart

Reste propriétaire de :
- liste partagée ;
- publication / fermeture / annulation ;
- disponibilité des lignes ;
- adaptateur de sélection de liste vers le checkout canonique.

Il fournit une sélection à la projection checkout d'`orders`, mais ne possède jamais la commande ni le paiement.

## 5. Graphe cible

```text
personal-cart ───┐
                 ├──▶ orders / projection checkout ───▶ payments
shared-cart  ────┘                 │
                                   ├────▶ auth-identity
                                   └────▶ logistics / relais
```

À supprimer conceptuellement :

```text
cart/shared-cart → recap-gate → checkout
payments owns checkout
```

## 6. Invariants

- **I-CHECKOUT-1** — toute source produit à terme une `CheckoutSelection` canonique.
- **I-CHECKOUT-2** — panier personnel et liste partagée utilisent le même checkout.
- **I-CHECKOUT-3** — le récapitulatif appartient au checkout ; il n'est pas une étape.
- **I-CHECKOUT-4** — ouvrir, modifier ou quitter le checkout ne crée ni commande ni paiement.
- **I-CHECKOUT-5** — le CTA final est le seul acte engageant du parcours.
- **I-CHECKOUT-6** — `orders` reste lifecycle owner de la commande et owner Feature First de la projection checkout.
- **I-CHECKOUT-7** — `payments` reste owner de l'encaissement.
- **I-CHECKOUT-8** — `shared-cart` reste owner de la liste, jamais de la commande ni du checkout.
- **I-CHECKOUT-9** — aucun renderer / checkout parallèle selon la source.
- **I-CHECKOUT-10** — desktop et mobile partagent le même state et les mêmes renderers métier ; seule la projection responsive diffère.

## 7. Headers cibles

Le champ `@domain checkout` reste valide : un domaine technique/UI n'est pas nécessairement une feature métier.

### `public/boutique/js/b-checkout.js`

Lot 1 conserve les inputs/outputs qui décrivent le code réel. Lot 2 les fait évoluer vers `checkout_selection` lorsque l'abstraction existe effectivement.

Cible finale :

```text
@role          boutique-checkout-orchestrator
@domain        checkout
@inputs        checkout_selection, identity, fulfillment, payment_mode
@outputs       checkout_state, order_creation_request, payment_initialization, order_success
@doctrine      paiement_seul_acte_engageant, recap_integre_checkout, surface_transactionnelle_unique, checkout_sans_friction
@impact-areas  checkout, orders, payments, identity, logistics, shared-cart
```

### `public/boutique/js/b-checkout-render.js`

Cible finale :

```text
@role          checkout-dom-renderer
@domain        checkout
@inputs        checkout_selection, identity, relay_options, payment_state
@outputs       order_summary_dom, checkout_form_dom, success_dom, confirm_button_state
@doctrine      rendu_sans_logique_metier, recap_integre_checkout, surface_transactionnelle_unique
```

### `public/boutique/css/checkout-vertical-rail.css`

Cible : projeter sélection, informations de commande et paiement dans une surface transactionnelle unique. Le CTA final porte seul l'acte engageant.

## 8. Séquence de livraison

### Lot 1 — Feature First / ownership / headers / graphes

Zéro changement UX.

- **ne pas** créer `features/checkout.feature.js` ;
- déplacer l'ownership de `b-checkout.js` / `b-checkout-render.js` de `payments.feature.js` vers `orders.feature.js` ;
- rattacher le CSS checkout spécifique à `orders` ;
- conserver `b-paypal.js` / `paypal.css` dans `payments` ;
- mettre à jour les headers sans prétendre que `CheckoutSelection` existe déjà ;
- mettre à jour `shared-cart` : l'achat passe par le checkout canonique d'`orders`, sans faire du récapitulatif une frontière métier ;
- régénérer graphes / docs ;
- `map:check` et gates verts.

### Lot 2 — fusion fonctionnelle

- introduire `CheckoutSelection` ;
- faire entrer panier personnel et liste partagée par cette abstraction ;
- shared-list transmet directement une `CheckoutSelection` sans détourner le panier personnel ;
- intégrer le récapitulatif à la surface checkout et supprimer l'ancien écran intermédiaire ;
- supprimer le bouton / événement `Confirmer et continuer` ;
- ouvrir directement le checkout avec la sélection canonique ;
- conserver création de commande et paiement métier inchangés.

### Lot 3 — projection responsive + dette morte

Desktop : résumé et formulaire cohabitent, CTA final stable même avec une longue liste.

Mobile : même surface en flux vertical, résumé compact/repliable si nécessaire.

Puis supprimer :
- styles `recap gate` devenus morts ;
- tests d'étape intermédiaire ;
- branches personnelles / shared-list parallèles ;
- tout code de transition recap → checkout devenu inutile.

## 9. Non-objectifs

Ce chantier ne change pas :
- règles de prix ;
- API orders ;
- API payments ;
- logique Stripe / PayPal / cash ;
- OTP ;
- lifecycle shared-cart ;
- logique de retrait.

La première attaque est architecturale : corriger l'ownership Feature First avant de modifier le flow.
