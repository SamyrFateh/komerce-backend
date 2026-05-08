# 📱 Komerce Mobile — Bugs identifiés & corrections

> Audit ciblé sur la boutique mobile, basé sur le code v10.6.1.
> À traiter en chantier 7-bis (avant ou en parallèle du chantier 7 desktop).
> Effort total : ~1 jour.

---

## 🎯 Le ghost gauche qui ne marche pas — diagnostic

### Ce que vous avez aujourd'hui

Le pager mobile (`b-pager.js`) a un système de **ghost à droite** qui fonctionne très bien :

- Une page clone de "Tout" est ajoutée à la fin (`appendChild`, ligne 138)
- Quand l'utilisateur swipe et arrive dessus, le code détecte `page.dataset.ghost` (ligne 182), reshuffle les cartes, et téléporte vers `scrollLeft = 0` instantanément
- L'opacité est masquée pendant la téléportation pour éviter le flash

Résultat : on peut scroller à droite à l'infini, ça reboucle proprement.

### Pourquoi le ghost gauche ne marche pas chez vous

Le ghost gauche est nettement plus fragile à mettre en place. Trois pièges classiques :

**1. La position de départ.**
Au boot de la page, `scrollLeft = 0` par défaut. Si vous `prepend` un ghost (la "vraie" dernière catégorie clonée à gauche de la première vraie chip), alors `scrollLeft = 0` affiche **le ghost** au lieu de la première chip. L'utilisateur ouvre la boutique sur "Beauté" cloné (par exemple) au lieu de "Tout". Bug visible immédiatement.

**2. Le décalage initial.**
Pour corriger 1, il faut faire `grid.scrollLeft = pageWidth` au boot, pour cacher le ghost et placer l'utilisateur sur la première vraie page. Mais ce décalage doit attendre que **les images soient mesurables**, sinon `pageWidth` vaut 0 et le décalage rate. C'est le bug le plus courant.

**3. La détection du swipe gauche.**
Le listener actuel (`_setupScrollSync` ligne 164) est asymétrique : il détecte uniquement quand l'utilisateur arrive sur un `data-ghost`, ce qui suppose un ghost à droite. Pour un ghost gauche, il faut aussi détecter `scrollLeft < 1` (en arrivant à gauche absolue) et téléporter vers le ghost gauche, qui correspond à la dernière vraie page.

**4. iOS Safari et le `scroll-snap`.**
iOS Safari a un comportement particulier : un `scrollTo({ left: x, behavior: 'instant' })` pendant que `scroll-snap-type: x mandatory` est actif peut être ignoré ou produire un retour visible. Il faut désactiver temporairement le snap pendant la téléportation.

### Solution proposée

Voici le diff exact à appliquer dans `b-pager.js`.

---

## 🛠️ Fix 1 : Implémenter le ghost gauche (vrai infinite scroll bidirectionnel)

### Ce qu'on ajoute

Dans `_setupInfiniteLoop` (ligne 124), on ajoute la création d'un ghost à gauche en plus du ghost droite, ET on positionne le scroll initial sur la première vraie page.

```javascript
function _setupInfiniteLoop() {
  const grid = _getGrid();
  if (!grid || window.innerWidth >= 900) return;

  // Supprimer les anciens ghosts (gauche ET droite)
  grid.querySelectorAll('[data-ghost]').forEach(g => g.remove());

  const realPages = _getRealPages(grid);
  if (realPages.length === 0) return;

  const toutPage     = grid.querySelector('.k-cat-section[data-cat="all"]:not([data-ghost])');
  const lastRealPage = realPages[realPages.length - 1];

  // ── Ghost DROITE : clone de "Tout" à la fin (existant) ──
  if (toutPage) {
    const ghostRight = toutPage.cloneNode(true);
    ghostRight.setAttribute('data-ghost', 'right');
    ghostRight.dataset.cat = 'all';
    grid.appendChild(ghostRight);
  }

  // ── Ghost GAUCHE : clone de la dernière catégorie au début ──
  if (lastRealPage) {
    const ghostLeft = lastRealPage.cloneNode(true);
    ghostLeft.setAttribute('data-ghost', 'left');
    ghostLeft.dataset.cat = lastRealPage.dataset.cat;
    grid.insertBefore(ghostLeft, grid.firstChild);

    // Décaler le scroll d'une page vers la droite pour cacher le ghost gauche
    // Doit attendre que pageWidth soit mesurable (images chargées)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const pageWidth = grid.clientWidth || window.innerWidth;
        if (pageWidth > 0) {
          // Désactiver le snap temporairement pour iOS Safari
          const prevSnap = grid.style.scrollSnapType;
          grid.style.scrollSnapType = 'none';
          grid.scrollLeft = pageWidth;
          // Réactiver après le repaint
          requestAnimationFrame(() => {
            grid.style.scrollSnapType = prevSnap;
          });
        }
      });
    });
  }
}
```

### Ce qu'on modifie

Dans `_setupScrollSync` (ligne 164), on étend la détection pour gérer le ghost gauche aussi. La fonction actuelle ne gère que le ghost droite via `page.dataset.ghost`. On change pour différencier `left` et `right` :

```javascript
function _setupScrollSync(grid) {
  if (grid._pagerScrollH) grid.removeEventListener('scroll', grid._pagerScrollH);

  let raf = null;
  let lastIdx = -1;

  grid._pagerScrollH = () => {
    if (_isProgrammaticScroll) return;
    if (state.modalOpen) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const allPages = _getPages(grid);
      const idx = _getCurrentIndex(grid);
      const page = allPages[idx];
      if (!page) return;

      const ghostType = page.dataset.ghost; // 'left' | 'right' | undefined

      // Ghost DROITE → téléporter vers idx 0 (vraie page "Tout")
      if (ghostType === 'right') {
        _ghostTeleport(grid, 'right');
        lastIdx = -1;
        return;
      }

      // Ghost GAUCHE → téléporter vers la dernière vraie page
      if (ghostType === 'left') {
        _ghostTeleport(grid, 'left');
        lastIdx = -1;
        return;
      }

      const cat = page.dataset.cat;
      if (cat && idx !== lastIdx) {
        lastIdx = idx;
        _syncChip(cat);
      }
    });
  };

  grid.addEventListener('scroll', grid._pagerScrollH, { passive: true });
}
```

Et on adapte `_ghostTeleport` pour qu'il accepte une direction :

```javascript
function _ghostTeleport(grid, direction) {
  // 1. Masquer le grid pendant la téléportation
  grid.style.opacity    = '0';
  grid.style.transition = 'none';

  // 2. Désactiver le snap pour iOS
  const prevSnap = grid.style.scrollSnapType;
  grid.style.scrollSnapType = 'none';

  // 3. Téléporter selon la direction
  if (direction === 'right') {
    // Arrivé sur le ghost droite (clone de "Tout") → reshuffle + retour à idx 0
    _reshuffleToutInDOM();
    _scrollToIndex(grid, 0, 'instant');
    _syncChip('all');
  } else if (direction === 'left') {
    // Arrivé sur le ghost gauche (clone de la dernière catégorie)
    // → téléporter vers la dernière VRAIE page
    const realPages = _getRealPages(grid);
    const lastIdx = realPages.length - 1;
    // Note : avec ghost gauche, l'index dans allPages est décalé de +1
    // (le ghost gauche occupe index 0). La vraie dernière page est à index = realPages.length
    _scrollToIndex(grid, lastIdx + 1, 'instant'); // +1 pour le ghost gauche
    _syncChip(realPages[lastIdx].dataset.cat);
  }

  // 4. Réactiver snap + opacité après 2 frames
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      grid.style.scrollSnapType = prevSnap;
      grid.style.opacity    = '';
      grid.style.transition = '';
    });
  });
}
```

### Mise à jour de `_getCurrentIndex`

Avec le ghost gauche, l'index "logique" d'une page n'est plus le même que son index "physique" dans le DOM. Il faut soit :

- **Option A** : laisser `_getCurrentIndex` retourner l'index physique (avec ghost gauche à 0), et adapter le code appelant
- **Option B** : créer un `_getLogicalIndex` qui soustrait 1 si ghost gauche présent

Pour minimiser les régressions, je recommande **Option A**. Le ghost gauche occupe index 0, donc :

- Index 0 = ghost gauche (ne devrait jamais être l'index "stable")
- Index 1..N = vraies pages
- Index N+1 = ghost droite

Le code de sync chip doit alors lire `page.dataset.cat` (qui reste correct sur le ghost gauche → c'est la cat de la dernière page, bien synchronisé visuellement).

### Test à valider après le fix

1. ✅ Ouvrir la boutique mobile : on voit la chip "Tout" active, pas un ghost
2. ✅ Swipe DROITE : on traverse Sport, Mode, Maison… arrivé sur le ghost droite → téléportation invisible vers Tout, reshuffle des cartes
3. ✅ **Swipe GAUCHE depuis "Tout"** : on arrive sur le ghost gauche (la dernière catégorie, ex: Sur-mesure) → téléportation invisible vers la vraie dernière catégorie. Le chip se met à jour.
4. ✅ Pas de flash visible pendant les téléportations
5. ✅ Sur iOS Safari : pas de "rebound" visible
6. ✅ Sur Android Chrome : pas de "rebound" visible

---

## 🐛 Autres bugs / améliorations mobile probables

J'ai identifié 4 autres problèmes en parcourant le code. À traiter ensuite ou en même temps.

### Fix 2 : `_recalcPagerVars` se déclenche trop souvent

Dans `b-pager.js` ligne 19, `_recalcPagerVars` recalcule les variables CSS du pager (`--pager-top`, `--pager-h`, `--pager-w`). Cette fonction lit `getBoundingClientRect()` sur 5 éléments puis fait un `documentElement.style.setProperty`. C'est cher, et probablement appelé sur chaque resize / scroll / orientation change.

**À vérifier dans Sonnet** : combien de fois cette fonction est appelée par seconde quand on scroll. Si > 3, mettre un `requestIdleCallback` ou un debounce 100ms.

### Fix 3 : Le `_setupInfiniteLoop` est appelé chaque fois que la grille change

À chaque re-render de la grille (changement de filtre, scroll vers une nouvelle page de produits), le code supprime tous les ghosts et les recrée. Si l'utilisateur est déjà sur le ghost à ce moment, on perd sa position.

**Symptôme typique** : "j'ai swipé vers la gauche, et soudain je me suis retrouvé téléporté à un endroit bizarre".

**Fix proposé** : dans `_setupInfiniteLoop`, vérifier si l'utilisateur est actuellement sur un ghost. Si oui, finir la téléportation AVANT de reconstruire les ghosts.

```javascript
function _setupInfiniteLoop() {
  const grid = _getGrid();
  if (!grid || window.innerWidth >= 900) return;

  // Si on est sur un ghost, terminer la téléportation d'abord
  const allPages = _getPages(grid);
  const idx = _getCurrentIndex(grid);
  const currentPage = allPages[idx];
  if (currentPage?.dataset.ghost) {
    _ghostTeleport(grid, currentPage.dataset.ghost);
    // Attendre la téléportation, puis recréer les ghosts
    setTimeout(() => _setupInfiniteLoop(), 50);
    return;
  }

  // Suite : suppression et recréation comme avant
  // ...
}
```

### Fix 4 : Le `bounce vertical → page suivante` peut surprendre

Vous avez un comportement "bounce" qui scroll vers la page suivante quand l'utilisateur arrive en bas verticalement (ligne 199 du pager). C'est sympa mais piège classique : si l'utilisateur scroll juste pour relire, il peut se retrouver expulsé vers la page suivante alors qu'il ne le voulait pas.

**À vérifier en testant** : est-ce que ça arrive trop souvent ? Si oui, deux fixes possibles :
- Augmenter le délai (actuellement 350ms) à 600-800ms
- Exiger un "pull" plus marqué (overscroll de 80px au lieu de 50px)
- Désactiver complètement (option utilisateur dans paramètres)

Je n'ai pas le code complet sous les yeux mais c'est une UX qui demande à être testée à plusieurs personnes pour être validée.

### Fix 5 : Le mini-cart desktop / mobile ambigu

`b-mini-cart.js` est documenté comme "mini-cart flottant mobile" mais est instancié sans condition de viewport dans `main.js` ligne 39. Si vous avez voulu un mini-cart pour mobile uniquement, il y a peut-être un doublon avec le `b-cart-pill.js` (désactivé selon le commentaire main.js ligne 32).

**À vérifier** : sur desktop ≥ 900px, est-ce que le mini-cart mobile s'affiche en plus du drawer panier ? Si oui c'est un bug visuel.

```javascript
// Dans b-mini-cart.js, en début de setupMiniCart :
if (window.innerWidth >= 900) return; // pas sur desktop
```

---

## 📦 Prompt Sonnet pour exécuter ce chantier

```
Tu vas corriger plusieurs bugs et améliorations sur la boutique mobile Komerce. Le doc MOBILE_BOUTIQUE_FIXES.md décrit chaque fix précisément.

CONTEXTE TECHNIQUE :
- Frontend ES modules natifs, pattern b-*.js
- Le pager mobile est b-pager.js (550 lignes)
- Le ghost system actuel ne fait que la direction droite
- L'utilisateur veut un infinite scroll BIDIRECTIONNEL (gauche + droite)

TÂCHES, dans l'ordre :

1. **Fix 1 — Ghost gauche** : applique les diffs exacts décrits dans MOBILE_BOUTIQUE_FIXES.md §"Solution proposée".
   - Modification de _setupInfiniteLoop (ajout du ghost gauche + décalage initial du scroll)
   - Modification de _setupScrollSync (détection ghostType 'left' / 'right')
   - Modification de _ghostTeleport (paramètre direction)
   - Test sur Chrome desktop avec viewport mobile (DevTools)
   - Test sur iOS Safari (vrai device si possible)
   - Test sur Android Chrome (vrai device ou émulateur)

2. **Fix 2 — Debounce _recalcPagerVars** : ajoute un debounce 100ms si la fonction est appelée plus de 3 fois/seconde.
   - Mesure d'abord la fréquence d'appel actuelle
   - Si > 3/sec sous scroll normal, applique le fix
   - Sinon documente que c'est OK et passe au suivant

3. **Fix 3 — Re-création des ghosts pendant téléportation** : applique le diff §Fix 3.
   - Test : trigger une re-création (filtre, recherche) pendant qu'on est sur un ghost → vérifier qu'on ne perd pas la position

4. **Fix 4 — Bounce vertical** : à VALIDER avec l'utilisateur AVANT de modifier.
   - Demande au user : "Tu trouves le bounce vertical (scroll vers la page suivante quand on arrive en bas) trop sensible / OK / à désactiver ?"
   - Selon réponse, ajuste les seuils ou ajoute un toggle dans les paramètres

5. **Fix 5 — Mini-cart sur desktop** : vérifie si le mini-cart mobile s'affiche sur desktop ≥ 900px. Si oui, ajoute le guard en début de setupMiniCart.

RÈGLES STRICTES :
- Tu testes APRÈS CHAQUE fix sur (a) Chrome DevTools mobile (b) au moins 1 vrai device si possible
- Tu commits après chaque fix (1 fix = 1 commit)
- Tu n'introduis aucune dépendance npm
- Tu ne touches qu'aux fichiers public/boutique/js/b-pager.js, b-mini-cart.js, et public/boutique/css/* si nécessaire
- Si tu observes un autre bug en route, tu le notes mais ne le corriges PAS sans demander

Démarre par le Fix 1, étape par étape. Commence par lire b-pager.js intégralement.
```

### Fichiers à attacher

- Ce fichier (`MOBILE_BOUTIQUE_FIXES.md`)
- `public/boutique/js/b-pager.js`
- `public/boutique/js/b-catalog.js`
- `public/boutique/js/b-mini-cart.js`
- `public/boutique/js/main.js`
- `public/boutique/css/products.css` (où vit probablement le scroll-snap CSS)
- `public/boutique/css/layout.css`

### Critère de fin

- ✅ Swipe gauche depuis "Tout" → on arrive sur la dernière catégorie sans flash
- ✅ Swipe droite depuis la dernière catégorie → on revient sur "Tout" reshuffle (existant, ne pas casser)
- ✅ Pas de bug d'index après recreation de la grille
- ✅ Mini-cart non affiché sur desktop ≥ 900px
- ✅ Tests sur 3 environnements OK : Chrome DevTools mobile, vrai iOS Safari, vrai Android Chrome

---

## 🎯 À ajouter dans la roadmap pilote

Ce chantier devient le **chantier 7-bis** (ou nouveau chantier 12) dans `ROADMAP_PILOTE_KOMERCE.md`.

Position recommandée dans l'ordre Go-Live :

```
1 → 3 → 2 → 6 → 4 → 5 → [7-bis ce chantier] → soft launch → 7 desktop / 8 collectif / 9 sur-mesure / 10 docs / 11 roadmap
```

Le 7-bis (mobile) avant le soft launch parce que la majorité de votre trafic diaspora sera sur mobile (WhatsApp → boutique mobile). Le 7 desktop peut attendre.

**Effort total : ~1 jour** (Fix 1 = 4h, Fix 2-3 = 2h, Fix 4 = 1h, Fix 5 = 30 min, tests = 1h).
