# Side cart desktop fixed viewport

Objectif : transformer le `.k-side-cart` desktop existant de `position: sticky` vers `position: fixed`, sans créer de nouveau panier et sans toucher au mobile.

Fichier source : `public/boutique/css/boutique-desktop.css`.

Ajouter en fin de fichier :

```css
@media (min-width: 900px) {
  :root {
    --side-cart-w: 290px;
    --side-cart-gap: 20px;
  }

  .k-side-cart {
    position: fixed;
    top: var(--header-h, 72px);
    right: 0;
    bottom: 0;
    height: calc(100dvh - var(--header-h, 72px));
    max-height: calc(100dvh - var(--header-h, 72px));
    width: var(--side-cart-w);
    min-width: var(--side-cart-w);
    flex: none;
    transform: translateX(8px);
  }

  .k-side-cart.has-items {
    transform: translateX(0);
  }

  body:not(.modal-open):not(.cart-open) #k-desktop-catalog-wrap {
    padding-right: calc(var(--side-cart-w) + var(--side-cart-gap));
  }

  #k-side-cart.is-expanded .k-sc-items {
    max-height: calc(100dvh - var(--header-h, 72px) - 220px);
  }
}

@media (min-width: 1200px) {
  :root {
    --side-cart-w: 306px;
    --side-cart-gap: 24px;
  }
}
```

Commandes à lancer depuis `public/boutique` :

```bash
npm run bundle:css
npm run audit:arch:live
npm run audit:arch
npm run check:all
```

Fichiers attendus après application :

- `css/boutique-desktop.css`
- `css/dist/desktop.css`
- `docs/BOUTIQUE_ARCHITECTURE_LIVE.md`

Validation : desktop 900, 1180, 1200, 1440 px ; mobile sous 900 px inchangé.
