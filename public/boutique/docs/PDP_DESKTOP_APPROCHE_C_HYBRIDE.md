# PDP Desktop — Approche C hybride

> Statut : proposition intégrée en branche `feature/boutique-approche-c-hybride-pdp`.
> Périmètre : desktop uniquement, fiche produit / modal produit.

---

## Décision UX

Ne pas intégrer de side-cart permanent dans la PDP Desktop.

La fiche produit doit rester centrée sur :

1. le produit ;
2. le prix ;
3. la réassurance ;
4. le CTA principal ;
5. l'accès volontaire au panier.

Le panier complet reste accessible, mais il ne doit pas être imposé comme deuxième colonne concurrente à la fiche produit.

---

## Approche retenue

Approche C hybride :

- base e-commerce moderne, claire et mesurable ;
- touches éditoriales premium ;
- image produit plus statutaire ;
- titre en `--font-display` ;
- prix plus fort ;
- livraison en bandeau compact ;
- paiement en pills/tabs ;
- détail du paiement actif uniquement ;
- CTA sticky conservé ;
- mobile préservé.

---

## Pourquoi pas de side-cart permanent ?

Un side-cart permanent sur PDP crée :

- une concurrence visuelle avec le produit ;
- une double zone d'action ;
- une impression de checkout trop tôt ;
- une perte d'espace pour la fiche produit ;
- une surcharge cognitive.

La PDP Komerce doit d'abord convaincre. Le panier intervient après l'intention.

---

## Implémentation de cette branche

Cette branche ajoute une couche additive :

- `js/b-modal-approche-c-hybrid.js` : enhancer desktop-only branché sur `modal:opened` ;
- `js/main.js` : branchement de `setupApprocheCHybridPdp()` après `setupDesktopUpgrade()`.

Le module attend que les enhancers desktop historiques aient injecté les zones Livraison/Paiement, puis remplace leur rendu par :

- `k-buybox-relay-card` ;
- `k-buybox-payment-tabs` ;
- `k-buybox-payment-detail`.

Le CSS est injecté par le module et entièrement encapsulé sous :

```css
@media (min-width: 900px) { ... }
```

Aucun fichier mobile verrouillé n'est modifié.

---

## Fichiers volontairement non touchés

- `js/b-pager.js` ;
- `js/b-store.js` ;
- `js/b-scroll-owner.js` ;
- `css/modal.css` ;
- `css/dist/*`.

Cette branche est donc facile à retirer ou à transformer plus tard en CSS source propre.

---

## À faire localement avant merge

Depuis `public/boutique` :

```bash
npm run check:imports
npm run check:body-classes
npm run check:html
npm run audit:arch
npm run check:all
```

Si l'équipe décide de rendre l'approche C définitive, migrer ensuite le CSS injecté vers `css/modal.css`, rebundler avec `npm run bundle:css`, puis régénérer `docs/BOUTIQUE_ARCHITECTURE_LIVE.md`.
