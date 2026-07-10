# Stratégie E2E Playwright — Boutique Komerce

## Vue d'ensemble

**15 spec files** × **5 projets navigateurs** = couverture cross-browser complète.

### Projets Playwright (playwright.config.js)

| Projet | Moteur | Viewport | Cible |
|--------|--------|----------|-------|
| Desktop Chrome | Chromium | 1280×800 | Majoritaire desktop |
| Desktop Firefox | Firefox | 1280×800 | Compatibilité Gecko |
| Desktop Safari | WebKit | 1280×800 | macOS / compat WebKit |
| Mobile Chrome | Chromium (Pixel 7) | 412×915 | Android mobile-first |
| Mobile Safari | WebKit (iPhone 14) | 390×844 | iOS diaspora cible |

### Commandes de lancement

```bash
# Tous les navigateurs, tous les specs (CI)
npx playwright test --project="Desktop Chrome" --project="Desktop Firefox" --project="Desktop Safari" --project="Mobile Chrome" --project="Mobile Safari"

# Un navigateur, un fichier (debug rapide)
npx playwright test e2e/search.spec.js --project="Mobile Chrome" --workers=1

# Seulement desktop (layout desktop)
npx playwright test e2e/desktop.spec.js --project="Desktop Chrome" --project="Desktop Firefox" --project="Desktop Safari"

# Mode DISTANT (prod/staging)
BASE_URL=https://komerce.co/boutique/ npx playwright test

# Avec rapport HTML
npx playwright test --reporter=html
```

---

## Matrice de couverture

### Fichiers existants (✅ déjà OK)

| Spec | Feature | Tests | Dépend backend |
|------|---------|-------|----------------|
| `catalog.spec.js` | Grille, cartes, catégories, cache offline | E0, E1, E1b, E1c, E1d | Oui |
| `modal.spec.js` | Modale produit, stepper, fermetures × 3, scroll | E2, E2b, E7a-d | Oui |
| `cart.spec.js` | Ajout, badge, drawer, quantités, suppression | E3, E3b-f | Oui |
| `checkout.spec.js` | Formulaire, relais state machine, paiement, retry | E4, E4b-d, E5, E5b-d | Oui |
| `favorites.spec.js` | Ajout, onglet, retrait, état vide | E17, E17b-d | Oui |
| `group.spec.js` | Chargement, timeout, page publique, partage | E13, E13b, E14, E14b | Oui |
| `tracking.spec.js` | Suivi, timeout, mode recherche | E11, E12, E12b | Oui |
| `wallet.spec.js` | Session auth, solde | EA1, EA2 | Oui (auth) |
| `resilience.spec.js` | API down, timeout global, nav stress | E15, E15b-c, E16 | Non (mocks) |
| `render-integrity.spec.js` | CSS/JS/images 404 | 1 test | Non |

### Fichiers NOUVEAUX (🆕 ajoutés)

| Spec | Feature | Tests | Dépend backend |
|------|---------|-------|----------------|
| `search.spec.js` | Recherche catalogue, dropdown, clic résultat | E20, E20b-e | Oui |
| `navigation.spec.js` | Deep-links ?tab=, aller-retour onglets, footer | E21, E21b-c, E22, E22b, E23 | Oui |
| `desktop.spec.js` | Header desktop, grille multi-col, side-cart permanent | E30, E30b, E31, E31b, E32 | Oui |
| `home.spec.js` | Hero, chips catégories, greeting, WhatsApp FAB, logo | E25, E25b-c, E26, E26b, E27 | Oui |
| `accessibility.spec.js` | Alt images, labels boutons, Escape, ARIA, lang | E40, E40b, E41, E41b, E42, E42b | Oui |
| `cross-browser.spec.js` | dvh/safe-area, backdrop-filter, :has() fallback, scroll restore, images lazy | X1–X9 | Oui |

---

## Zones non couvertes (choix conscient)

| Zone | Raison | Mitigation |
|------|--------|------------|
| **Identité / OTP** | Requiert un vrai flux SMS/OTP, trop fragile en CI | Tests unitaires b-identity.test.js (30+ tests) |
| **PayPal** | Sandbox PayPal instable, iframe tiers | Tests unitaires b-paypal.test.js |
| **Sous-catégories (flat subcat)** | UI complexe avec swipe/pager interne | Tests unitaires b-subcat.test.js (40+ tests) |
| **Suggestions modale** | Dépend du catalogue (produits similaires) | Couvert indirectement par modal.spec.js (modale ouvre) |
| **Social proof** | Feature désactivable côté admin | Tests unitaires b-modal-social-proof.test.js |

---

## Bonnes pratiques cross-browser

### Piège mobile/desktop déjà documenté

Les sélecteurs `.k-bnav-item` (mobile) et `.k-header-nav-btn` (desktop) coexistent
dans le DOM — il faut toujours scoper selon le viewport (cf. `navigateToTab()` dans les helpers).
Même chose pour `#k-cart-drawer` (mobile) vs `#k-side-cart` (desktop).

### Timeouts recommandés

- Navigation : **8–10s** (réseau distant variable)
- API timeout (mock) : **15s** (fetchWithTimeout backend = 10s)
- Rendu DOM : **5s** (hydratation catalogue)
- Animation/transition : **300–500ms** (waitForTimeout)

### Retry CI

```js
retries: process.env.CI ? 2 : 0,  // déjà dans playwright.config.js
```

### Scripts npm rapides

```bash
npm run test:e2e:all-browsers   # 5 navigateurs, tous les specs
npm run test:e2e:mobile         # Mobile Chrome + Mobile Safari
npm run test:e2e:desktop        # Desktop Chrome + Firefox + Safari
npm run test:e2e:safari         # Mobile Safari + Desktop Safari
npm run test:e2e:xbrowser       # Uniquement cross-browser.spec.js × 5 navs
```

---

## Risques cross-browser identifiés dans le code

| Risque | Fichier source | Navigateur | Test |
|--------|---------------|------------|------|
| `100dvh` tronqué | `cart.css` (modale checkout) | Safari iOS < 15.4 | X1 |
| `env(safe-area-inset-bottom)` ignoré | `cart.css` (footer panier) | Anciens WebViews | X1b |
| `backdrop-filter` sans `-webkit-` | `cart.css`, `hero.css` | Safari < 16 | X2 |
| `:has()` CSS non supporté | `boutique-desktop.css` | Firefox < 121 | X3 |
| Scroll position perdue après modale | `b-scroll-owner.js` | Safari iOS, Firefox | X4 |
| Touch events + scroll bounce | `b-subcat.js`, `b-pager.js` | Safari iOS | X5 |
| z-index toast masqué | `cart.css` (#k-toast) | Stacking context variable | X6 |
| `input type="tel"` manquant | `b-checkout-render.js` | Mobile Safari/Firefox | X7 |
| Animation FOUC (flash blanc) | `b-modal-core.js` + CSS | Safari | X8 |
| `loading="lazy"` images | `render-product-card.js` | Safari IntersectionObserver | X9 |

### Traces et screenshots

- `screenshot: 'only-on-failure'` → capture automatique sur échec
- `trace: 'on-first-retry'` → trace complète pour debug CI
- Rapport HTML : `npx playwright show-report`
