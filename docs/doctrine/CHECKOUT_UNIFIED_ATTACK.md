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

## 3. Abstraction canonique

Toute entrée dans le checkout produit une `CheckoutSelection` indépendante de sa source :

```js
{
  source: 'personal-cart' | 'shared-list',
  sourceId: null | string,
  items: [...],
  total: number
}
```

Le checkout ne doit pas avoir deux moteurs selon la provenance des articles.

## 4. Ownership Feature First

### checkout

Propriétaire du parcours transactionnel boutique :
- construction / validation de `CheckoutSelection` ;
- orchestration UI ;
- récapitulatif intégré ;
- collecte identité / retrait / moyen de paiement ;
- déclenchement des capacités `orders` et `payments` ;
- succès / erreur / sortie du parcours.

### orders

Reste propriétaire de :
- création de la commande ;
- référence et snapshot commande ;
- cycle de vie de la commande.

### payments

Reste propriétaire de :
- Stripe / PayPal / cash ;
- intents et événements ;
- confirmation / idempotence de l'encaissement.

### shared-cart

Reste propriétaire de :
- liste partagée ;
- publication / fermeture / annulation ;
- disponibilité des lignes.

Il fournit une sélection au checkout, mais ne possède jamais le checkout.

## 5. Graphe cible

```text
personal-cart ───┐
                 ├──▶ checkout ───▶ orders
shared-cart  ────┘        │
                          ├───────▶ payments
identity ─────────────────┤
logistics / relais ───────┘
```

À supprimer conceptuellement :

```text
cart/shared-cart → recap-gate → checkout
payments owns checkout
```

## 6. Invariants

- **I-CHECKOUT-1** — toute source produit une `CheckoutSelection` canonique.
- **I-CHECKOUT-2** — panier personnel et liste partagée utilisent le même checkout.
- **I-CHECKOUT-3** — le récapitulatif appartient au checkout ; il n'est pas une étape.
- **I-CHECKOUT-4** — ouvrir, modifier ou quitter le checkout ne crée ni commande ni paiement.
- **I-CHECKOUT-5** — le CTA final est le seul acte engageant du parcours.
- **I-CHECKOUT-6** — `orders` reste lifecycle owner de la commande.
- **I-CHECKOUT-7** — `payments` reste owner de l'encaissement.
- **I-CHECKOUT-8** — `shared-cart` reste owner de la liste, jamais du checkout.
- **I-CHECKOUT-9** — aucun renderer / checkout parallèle selon la source.
- **I-CHECKOUT-10** — desktop et mobile partagent le même state et les mêmes renderers métier ; seule la projection responsive diffère.

## 7. Headers cibles

### `public/boutique/js/b-checkout.js`

```text
@role          boutique-checkout-orchestrator
@domain        checkout
@inputs        checkout_selection, identity, fulfillment, payment_mode
@outputs       checkout_state, order_creation_request, payment_initialization, order_success
@doctrine      paiement_seul_acte_engageant, recap_integre_checkout, surface_transactionnelle_unique, checkout_sans_friction
@impact-areas  checkout, orders, payments, identity, logistics, shared-cart
```

### `public/boutique/js/b-checkout-render.js`

```text
@role          checkout-dom-renderer
@domain        checkout
@inputs        checkout_selection, identity, relay_options, payment_state
@outputs       order_summary_dom, checkout_form_dom, success_dom, confirm_button_state
@doctrine      rendu_sans_logique_metier, recap_integre_checkout, surface_transactionnelle_unique
```

### `public/boutique/css/checkout-vertical-rail.css`

Le CSS projette sélection, informations de commande et paiement dans une surface transactionnelle unique. Le CTA final porte seul l'acte engageant.

## 8. Séquence de livraison

### Lot 1 — Feature First / headers / graphes

Zéro changement UX.

- créer `features/checkout.feature.js` ;
- retirer l'ownership boutique checkout de `payments.feature.js` ;
- mettre à jour les headers de `b-checkout.js`, `b-checkout-render.js`, CSS checkout ;
- mettre à jour la doctrine `shared-cart` : plus de « récap puis checkout » ;
- régénérer graphes / docs ;
- `map:check` et gates verts.

### Lot 2 — fusion fonctionnelle

- introduire `CheckoutSelection` ;
- faire entrer panier personnel et liste partagée par cette abstraction ;
- transformer `renderOrderRecapGate()` en résumé intégré au checkout ;
- supprimer le bouton / événement `Confirmer et continuer` ;
- ouvrir directement `renderCheckout()` avec la sélection canonique ;
- conserver création de commande et paiement inchangés.

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

La première attaque est architecturale : mettre les owners et headers au niveau du modèle cible avant de modifier le flow.
