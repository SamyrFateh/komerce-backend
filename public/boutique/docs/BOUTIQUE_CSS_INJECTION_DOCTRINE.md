# Komerce Boutique — Doctrine CSS/JS : injection, ownership, !important

> **Établi à l'issue du refacto CSS Lots 1–4 (juin 2026).**
> Ce document formalise les règles architecturales issues de l'audit et du nettoyage
> complet de l'injection CSS par JS. Il complète `BOUTIQUE_SOURCE_OF_TRUTH.md` et
> `BOUTIQUE_DESKTOP_OWNERSHIP_MAP.md` sur le périmètre "qui injecte quoi, comment".
>
> Statut : **v1.0 — 03 juin 2026**
> Auteur du refacto : Lots 1–4 complets (L1-S0 → L4-S11).

---

## §1. Règle fondamentale : le JS pose des classes d'état, pas du CSS

**Le CSS vit dans les fichiers `.css`. Jamais dans le JS.**

```
// ✅ CONFORME — le JS pose un état
documentElement.classList.add('k-mobile-premium-v1');
element.classList.add('is-funded');
element.classList.toggle('kpill--visible', hasItems);

// ❌ VIOLATION — le JS injecte un <style>
const s = document.createElement('style');
s.textContent = `.k-chip { width: 64px; }`;
document.head.appendChild(s);
```

**Pourquoi :** les `<style>` injectés au runtime sont invisibles pour le bundler,
les garde-fous (`check:all`), l'audit d'architecture, et `gen-ownership.js`.
Ils créent une cascade fantôme que rien ne peut auditer statiquement.

---

## §2. Table ownership CSS — composant → owner unique

Un composant = un seul fichier CSS owner. Les autres fichiers ne touchent pas
ses sélecteurs sauf pour des états scoped (préfixe `html.k-*` ou `body.*`).

| Composant | Owner CSS | Sélecteurs racine | JS associé (état seul) |
|---|---|---|---|
| **Layout / header** | `layout.css` | `.k-header*`, `.k-search`, `#k-desktop-catalog-wrap` | `b-nav.js` |
| **Hero** | `hero.css` | `.k-hero*` | `b-home-premium-v1.js` (pose `html.k-home-premium-v1`) |
| **Chips catégories** | `categories.css` | `.k-chip*`, `.k-cats*`, `.k-cats-shell` | `b-mobile-premium-v1.js` (pose `html.k-mobile-premium-v1`) |
| **Grille / cartes produit** | `products.css` | `.k-card*`, `.k-grid*`, `.k-cat-section*` | `b-catalog.js` |
| **Panier drawer + checkout** | `cart.css` | `.k-cart*`, `.ck-*`, `.kpill*`, `.kpill-pop*` | `b-cart.js`, `b-cart-pill.js` |
| **Modale produit** | `modal-product.css` | `.k-modal*`, `.k-sug*`, `.k-pdp-curation*` | `b-modal-*.js` |
| **Modale shell** | `modal-shell.css` | `.k-modal-overlay`, `.k-modal-inner` | `b-modal-core.js` |
| **Flow groupe** | `group-cart-flow.css` | `.k-group*`, `.k-gbanner*`, `.k-share*` | `b-group-banner.js`, `b-share-cart.js` |
| **Side-cart desktop** | `boutique-desktop.css` | `.k-side-cart*` | `b-cart.js` |
| **Interactions / transitions** | `interactions.css` | états hover/focus cross-composant | — |
| **Tokens** | `tokens.css` | variables CSS globales | — |

---

## §3. États premium scopés — convention de sélecteur

Les variantes d'affichage premium ne cassent pas l'ownership. Elles s'ajoutent
**dans l'owner du composant ciblé**, sous un préfixe `html.k-*-premium-v1` :

```css
/* Dans categories.css — owner des chips */
html.k-mobile-premium-v1 .k-chip {
  width: 64px;
  height: 84px;
  /* … */
}
```

Le JS ne fait qu'activer l'état :

```js
// Dans b-mobile-premium-v1.js
documentElement.classList.add('k-mobile-premium-v1');
```

La spécificité du sélecteur scopé (0-2-0) bat naturellement les règles de base
(0-1-0) **sans recourir à `!important`**.

---

## §4. `!important` — registre des exceptions légitimes

Après le refacto Lot 4, **2 blocs** de `!important` subsistent dans le projet.
Chacun est documenté et justifié ici. Tout nouveau `!important` doit
être arbitré dans ce registre avant d'être mergé.

### 4A. Garde drawer desktop — `boutique-desktop.css` L1197–1202

```css
@media (min-width: 900px) {
  .k-cart-drawer.open,
  .k-cart-overlay.open {
    display: none !important;
    transform: translateX(100%) !important;
    pointer-events: none !important;
  }
}
```

**Motif GARDER :** `b-cart.js` pose `.open` via JS sur ces éléments. Sans
`!important`, la règle desktop est écrasée par la règle mobile `.k-cart-drawer.open`
(même spécificité, ordre source défavorable). Ce guard protège le layout desktop
contre toute fuite du drawer mobile. Alternative : augmenter la spécificité avec
un ID — non retenu (fragilité, couplage DOM). Ce `!important` compense une vraie
inversion de cascade, pas un hack.

### 4B. Masquage éléments hero premium — `hero.css` L381

```css
html.k-mobile-premium-v1 .k-hero-cta-row,
html.k-mobile-premium-v1 .k-hero-trust,
/* … */
html.k-mobile-premium-v1 .k-hero-overlay {
  display: none !important;
}
```

**Motif GARDER :** le masquage doit être absolu et sans ambiguïté — d'autres règles
héritées ou contextuelles pourraient remettre `display` à autre chose. Le `!important`
sur un `display:none` de masquage intentionnel est une pratique légitime et conforme
au guide MDN. Pas de `!important` de dimensionnement ou positionnement ici.

---

## §5. Ce qui a été nettoyé (Lots 1–4)

### Injecteurs JS neutralisés

| Fichier JS | CSS extrait vers | `!important` supprimés | Lignes JS supprimées |
|---|---|---|---|
| `b-mobile-premium-v1.js` | `categories.css`, `hero.css`, `products.css`, `layout.css` | 16 | ~335 |
| `b-home-premium-v1.js` | `hero.css`, `layout.css`, `categories.css` | 3 | ~80 |
| `b-share-cart.js` | `group-cart-flow.css` | 2 | ~60 |
| `b-modal-approche-c-hybrid.js` | `modal-product.css` | 1 | ~40 |
| `b-cart-pill.js` | `cart.css` | 0 | 188 |
| `b-group-banner.js` | `group-cart-flow.css` | 0 | ~18 |
| `b-pdp-curation-suggestions.js` | `modal-product.css` | 0 | ~106 |
| `b-cart.js` | — (déjà conforme) | 0 | 0 |

### `!important` dans les owners CSS

| Avant (Lot 1 audit) | Après (Lot 4 nettoyage) | Delta |
|:---:|:---:|:---:|
| 22 (JS) + ~8 (CSS owners) | 0 (JS) + **5** (CSS owners, légitimes) | −25 |

Les 16 `!important` du bloc `html.k-mobile-premium-v1` dans `categories.css`
ont été retirés en L4-S11 — la spécificité du sélecteur scopé (0-2-0) suffit.

---

## §6. Garde-fous à maintenir

Ces outils détectent les violations avant merge :

```bash
npm run check:all        # gate canonique — lancer avant tout commit CSS/JS
npm run audit:arch       # violations ownership + injections JS
node scripts/gen-ownership.js  # régénérer BOUTIQUE_OWNERSHIP_LIVE.md après PR
```

**Règles à ne pas enfreindre :**
1. Zéro `createElement('style')` dans le JS (sauf exception enregistrée §4).
2. Toute nouvelle règle CSS va dans le fichier owner du composant.
3. Un nouvel état visuel = une nouvelle classe CSS + règle dans l'owner, pas un `style=` inline ou un `<style>` injecté.
4. Tout `!important` ajouté doit être enregistré dans §4 avec sa justification.
