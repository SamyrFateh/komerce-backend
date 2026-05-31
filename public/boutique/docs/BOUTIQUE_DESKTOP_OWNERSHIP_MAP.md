# Desktop — Qui fait EXACTEMENT quoi
## `BOUTIQUE_DESKTOP_OWNERSHIP_MAP.md` (31/05/2026)

> Source de vérité **haut niveau** du rendu desktop ≥900px : pour chaque zone,
> UN owner, et ce qu'il fait précisément. Établi à partir du code vérifié, pas des docs.
> Si un fichier fait quelque chose qui n'est pas listé ici pour sa zone → c'est une dérive.

---

## 1. CSS — qui style quoi (≥900px)

| Zone desktop | Owner unique | Ce qu'il fait, exactement |
|---|---|---|
| **Layout 3 zones** (wrap flex, chaîne overflow, réserve side-cart) | `layout.css` | `#k-desktop-catalog-wrap` (flex, box-sizing, `overflow-x:visible`) · `#k-catalog-section` (`flex:1 1 0`, `min-width:0`, **`overflow-x:clip`** — contient le painting) · token **`--sc-reserve-w`** (240/254px) · VIS-1 FIX (max-width conditionnel header+catalog quand side-cart actif) |
| **Side-cart** (panneau, header, boutons, items, largeur) | `boutique-desktop.css` | `.k-side-cart { position:fixed }` largeur 240→254px · header (fond sable, sous-total Fraunces) · boutons (Commander corail, etc.) · items · `body { padding-right:--sc-reserve-w }` |
| **Largeur "wide" des conteneurs** (≥1200px) | `boutique-desktop.css` | `max-width:1540px` sur `.k-header-inner`, `.k-hero-inner`, `.k-cats-shell` *(rapatrié du skeleton supprimé le 31/05)* |
| **Cartes produit** (`.k-card` skin) | `products.css` | apparence carte, prix, hover, badges · transitions d'état inter-composant → `interactions.css` (scope `all`) |
| **Sections de grille** (`.k-cat-section`, `.k-sec-header`, `.k-sec-grid`, rails sous-cat) | `products.css` | mise en page des sections par univers @900px · rails sous-cat `.k-sec-subcats` → `boutique-desktop.css` |
| **Chips catégories** (`.k-chip`, `.k-cats-shell` base) | `categories.css` | chips + shell (base) · override desktop (état actif, tailles) → `boutique-desktop.css` (scope `desktop-override`) · contexte hero mobile → `hero.css` |
| **Hero** | `hero.css` | bloc hero, `.k-hero-inner` (max-width base = `--container` 1400px) |

**Règle d'or de cascade** (la source des bugs passés) : `base.css` (tokens·reset·**layout·hero**) charge **avant** `desktop.css` (boutique-desktop). Donc une règle desktop spécifique va dans `boutique-desktop.css` (dernier mot), **jamais** dans `layout.css` si `hero.css` peut la réécrire.

---

## 2. JS — qui rend quoi

| Zone | Owner JS | Ce qu'il fait |
|---|---|---|
| **Boot** | `main.js` → `boutique.js init()` | `setupHomePremiumV1()` puis `loadProducts()` → `renderGrid()` |
| **Contenu de la grille** (sections par univers) | `render-home-sections.js` | écrit `dom.grid.innerHTML` : sections Mode/Maison/Tech… (desktop exclut Soldes) |
| **Clic chips catégories** | `home-controller.js` | bind `.k-chip[data-cat]`, scroll/sélection catégorie |
| **Contenu du side-cart** | `b-cart.js` (`renderSideCart`) | items, total, compteur |
| **Bloc "curation" + titres premium** | `b-home-premium-v1.js` | injecte `.k-home-curation`, la classe `html.k-home-premium-v1`, un `<style>` runtime, et des titres `::before/::after` |

---

## 3. Tensions connues — à arbitrer en PHASE RENDU (pas maintenant)

Ces points sont **identifiés, pas résolus**. Ils ne bloquent pas la consolidation, mais doivent être tranchés avant de "polir" le rendu :

1. **Titre incohérent** — `b-home-premium-v1.js` pose `::before "Bons plans du moment"` sur `#k-catalog-section`, mais `render-home-sections.js` y met des sections par univers. Décision : qui possède le titre ? (cf. I-8/I-10 du DIAGNOSIS). Recommandé : le JS qui possède le DOM possède le titre.
2. **header-inner : deux max-width** — `boutique-desktop.css` pose `1540px` (≥1200px) et `layout.css` VIS-1 pose `min(1400px, 100vw − réserve − 16px)` quand le side-cart est actif. Lequel gagne quand ? À clarifier visuellement.
3. **CSS injecté au runtime** — `b-home-premium-v1.js` crée un `<style>` à l'exécution : invisible pour `bundle:css`, `audit:arch`, `gen-ownership`. À sortir vers un vrai fichier source pour le ramener sous les garde-fous.

---

## 4. Ce qui a été consolidé le 31/05 (ce qcap-là est FAIT)

- ❌ `desktop-commerce-skeleton.css` **supprimé** (37 lignes, `background:` cassé, 0 règle utile).
- ➡️ sa seule règle vivante (`max-width:1540px`) **rapatriée** dans `boutique-desktop.css` @1200px.
- 🧹 retiré du bundle map (`bundle-css.js`) et du registre du garde-fou (`audit-boutique-arch.js` déclarait 3 owners fantômes : `.k-card`, `#k-desktop-catalog-wrap`, `.k-cats-shell` — les vrais owners étaient déjà déclarés).
- ✅ Validé : `bundle:css`, `check:breakpoints --strict`, `audit:arch` conforme, `check:html`, `check:imports`. `desktop.css?v=17`.

Bundle desktop : **1 source** (`boutique-desktop`) au lieu de 2.
