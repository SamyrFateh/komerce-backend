# 📱 Komerce Mobile — Audit complet & corrections

> Audit ciblé sur la boutique mobile, basé sur le code v10.6.1 lu fichier par fichier.
> **Statut** : prêt à confier à Claude Code (terminal) ou Sonnet 4.6.
> **Effort total estimé** : ~1.5 jour pour TOUT (bugs + améliorations Temu-like)
> **À insérer dans la roadmap pilote en chantier 7-bis** (avant le soft launch — votre trafic diaspora arrive surtout par WhatsApp → mobile).

---

## 🗂️ Sommaire

| Partie | Sujet | Effort |
|---|---|:-:|
| **A** | Bug ghost gauche (le diagnostic complet + diff) | 4h |
| **B** | 4 autres bugs/améliorations probables (à vérifier) | 2h |
| **C** | 8 améliorations Temu-like (œil pro) | 4-6h |
| **D** | Le prompt unique à coller dans Claude Code | — |

---

# PARTIE A — Le bug du ghost gauche

## A.1 — Diagnostic

Le pager mobile (`b-pager.js`) a un **ghost à droite** qui fonctionne très bien :

- Une page clone de "Tout" est ajoutée à la fin (`appendChild`, ligne 138)
- Quand l'utilisateur swipe et arrive dessus, le code détecte `page.dataset.ghost` (ligne 182), reshuffle les cartes, et téléporte vers `scrollLeft = 0` instantanément
- L'opacité est masquée pendant la téléportation pour éviter le flash

Résultat : on peut scroller à droite à l'infini, ça reboucle proprement.

## A.2 — Pourquoi le ghost gauche ne marche pas

Le ghost gauche est nettement plus fragile à mettre en place. Quatre pièges classiques :

**1. La position de départ.** Au boot, `scrollLeft = 0` par défaut. Si vous `prepend` un ghost (la "vraie" dernière catégorie clonée à gauche de la première vraie chip), alors `scrollLeft = 0` affiche **le ghost** au lieu de la première chip. L'utilisateur ouvre la boutique sur "Sport" cloné (par exemple) au lieu de "Tout". Bug visible immédiatement.

**2. Le décalage initial.** Pour corriger 1, il faut faire `grid.scrollLeft = pageWidth` au boot, pour cacher le ghost et placer l'utilisateur sur la première vraie page. Mais ce décalage doit attendre que **les images soient mesurables**, sinon `pageWidth` vaut 0 et le décalage rate. C'est le bug le plus courant.

**3. La détection asymétrique.** Le listener actuel (`_setupScrollSync` ligne 164) ne détecte que l'arrivée sur un `data-ghost` à droite. Pour un ghost gauche, il faut aussi détecter l'arrivée à `scrollLeft < 1` et téléporter vers le ghost gauche, qui correspond à la dernière vraie page.

**4. iOS Safari et `scroll-snap`.** iOS Safari a un comportement particulier : un `scrollTo({ left: x, behavior: 'instant' })` pendant que `scroll-snap-type: x mandatory` est actif peut être ignoré ou produire un retour visible. Il faut désactiver temporairement le snap pendant la téléportation.

## A.3 — Le fix exact

### Modification 1 : `_setupInfiniteLoop` (ligne 124)

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

### Modification 2 : `_setupScrollSync` (ligne 164)

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

      if (ghostType === 'right') {
        _ghostTeleport(grid, 'right');
        lastIdx = -1;
        return;
      }

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

### Modification 3 : `_ghostTeleport` (ligne 141)

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
    // Arrivé sur le ghost gauche → téléporter vers la dernière VRAIE page
    const realPages = _getRealPages(grid);
    const lastIdx = realPages.length - 1;
    // Avec ghost gauche présent, la vraie dernière page est à index = realPages.length
    // (le ghost gauche occupe index 0, les vraies pages 1..N, le ghost droite N+1)
    _scrollToIndex(grid, lastIdx + 1, 'instant');
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

### Tests à valider après le fix

1. ✅ Ouvrir la boutique mobile : on voit la chip "Tout" active, pas un ghost
2. ✅ Swipe DROITE : on traverse Sport, Mode, Maison… arrivé sur le ghost droite → téléportation invisible vers Tout, reshuffle des cartes
3. ✅ **Swipe GAUCHE depuis "Tout"** : on arrive sur le ghost gauche (la dernière catégorie, ex: Sur-mesure) → téléportation invisible vers la vraie dernière catégorie. Le chip se met à jour.
4. ✅ Pas de flash visible pendant les téléportations
5. ✅ Sur iOS Safari (vrai device si possible) : pas de "rebound" visible
6. ✅ Sur Android Chrome : pas de "rebound" visible

⚠️ **Test critique : le faire sur un vrai iPhone si possible.** iOS Safari est notoirement chiant avec `scroll-snap` et les `scrollTo` programmatiques. Ce qui marche en DevTools peut casser sur device réel.

---

# PARTIE B — Autres bugs & améliorations probables

## B.1 — `_recalcPagerVars` se déclenche peut-être trop souvent

Dans `b-pager.js` ligne 19, `_recalcPagerVars` recalcule les variables CSS du pager via 5 `getBoundingClientRect()`. Probablement appelé sur chaque resize / orientation change.

**À mesurer** : combien de fois cette fonction est appelée par seconde quand on scroll. Si > 3, mettre un `requestIdleCallback` ou un debounce 100ms.

## B.2 — Re-création des ghosts pendant téléportation

À chaque re-render de la grille (changement de filtre, scroll vers nouvelle page de produits), le code supprime tous les ghosts et les recrée. Si l'utilisateur est déjà sur le ghost à ce moment, on perd sa position.

**Symptôme typique** : "j'ai swipé vers la gauche, et soudain je me suis retrouvé téléporté à un endroit bizarre".

**Fix** :

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
    setTimeout(() => _setupInfiniteLoop(), 50);
    return;
  }
  // ... suite normale
}
```

## B.3 — Bounce vertical → page suivante (à VALIDER avec utilisateur)

Comportement "bounce" qui scroll vers la page suivante quand l'utilisateur arrive en bas verticalement (ligne 199 du pager). Sympa mais piège classique : si l'utilisateur scroll juste pour relire, il peut se retrouver expulsé vers la page suivante alors qu'il ne le voulait pas.

**Action** : à valider avec vous AVANT de toucher. 3 options possibles :
- Augmenter le délai (350ms → 600-800ms)
- Exiger un "pull" plus marqué (overscroll de 80px au lieu de 50px)
- Désactiver complètement (option utilisateur dans paramètres)

## B.4 — Le SW reset "nuclear" en haut de l'index.html

Ligne 6-21 de `boutique/index.html` : un script qui désinstalle TOUS les service workers et vide TOUS les caches au premier chargement avec une clé `sw_reset_v326` en localStorage.

**À vérifier** : ce script est-il toujours nécessaire ? Si c'est un héritage d'un incident résolu :
- Il rallonge le first paint sur les nouveaux visiteurs
- Il peut vider le cache d'un utilisateur qui revient, perdant offline + perfs PWA
- Il pollue le code (22 lignes en haut du HTML qui n'ont rien à y faire)

Si vous ne savez pas pourquoi il est là, **demandez à Claude Code de tracer son origine via git blame** avant de le supprimer.

> **Note** : j'avais initialement listé un Fix 5 sur `b-mini-cart.js` mais après vérification le guard desktop existe déjà (ligne 359 : `if (_isDesktop()) return;`). Pas un bug.

---

# PARTIE C — 8 améliorations Temu-like (œil pro)

> **Préambule honnête** : votre boutique mobile est de bonne facture. Typographie cohérente (Fraunces + Plus Jakarta), tokens propres, identité comorienne assumée (logo drapeau + 4 étoiles, palette ocean/sand, proverbes en sticky bar). C'est mieux que beaucoup de boutiques que j'ai vues passer.
>
> Les améliorations ci-dessous ne disent pas que c'est mauvais. Elles disent ce qui peut **transformer une bonne boutique en boutique qui convertit**.

## C.1 — Ce qui marche vraiment bien (à NE PAS casser)

- **L'identité comorienne assumée** : logo (croissant + 4 étoiles), palette ocean/sand qui évoque la mer + le sable, proverbes en sticky bar. Différenciant. Vous n'êtes pas un Temu de plus.
- **Hiérarchie hero** : "Découvrir le catalogue" (primary) + "Suivre ma commande" (ghost). Le 2e CTA est intelligent — pour la diaspora qui revient juste vérifier sa commande, c'est respectueux.
- **Trust line** : "450+ produits · Paiement cash · Retrait relais" sous le hero. Les 3 angoisses du client diaspora résolues en 6 mots.
- **Sticky bar avec proverbe** : surprenant, mémorable.

## C.2 — Le hero mobile est probablement trop haut (P0 conversion)

Hero plein écran (`k-hero-img` 1600×896 ratio 16:9) + slogan superposé + CTAs + trust line + sticky bar + chips catégories + sous-cats… L'utilisateur mobile fait probablement 2 à 3 swipes verticaux avant de **voir un seul produit**. Sur Temu/Shein, on voit des produits dans le 1er écran.

**Test à faire** : ouvrir la boutique sur un iPhone SE (375×667), compter combien de produits sont visibles sans scroller. Si la réponse est zéro ou un demi-produit → urgent.

**Fix possible** : sur mobile uniquement, le hero passe de plein écran à hauteur fixée (ex: 240px), avec slogan centré et CTAs sous l'image. Vous gardez l'identité, vous récupérez 200-300px précieux.

## C.3 — La chip "Pour vous…" n'est pas claire (P1, fix 30 secondes)

Vous avez renommé "Sur-mesure" en "Pour vous…" dans le label visible (`index.html` ligne 215). C'est sympa mais ambigu : "Pour vous" en e-commerce veut dire "recommandations personnalisées" (pattern Amazon/Temu). Or chez vous c'est de la confection.

**Fix** : "Sur-mesure" tout court, ou "✂️ Sur-mesure", ou "Confection" si vous voulez plus chaleureux. Pas "Pour vous…" qui crée une fausse promesse.

## C.4 — Le bouton panier en haut à droite a perdu son texte (P2)

`<button class="k-cart-btn"><img src="/images/avatar_seule.png">` — c'est juste une image avatar avec un badge nombre. Pas de "🛒" reconnaissable, pas de label. Sur mobile, l'utilisateur peut hésiter une seconde sur ce que c'est.

**Fix** : ajouter un label visuel "Panier" en hover desktop, ou remplacer l'image avatar par une icône standard de panier — l'avatar est mignon mais c'est un anti-pattern UX.

## C.5 — Indicateur de stock en temps réel sur les cartes (P1, gros impact)

Temu et Shein affichent souvent "Plus que 3 en stock !" sur les cartes — pression scarcity. Pour la diaspora qui hésite à commander, c'est un déclencheur. Vous avez `stock` dans la DB, vous pouvez l'afficher quand stock ≤ 5.

**Fix** : afficher en orange "Plus que N disponibles" si stock ∈ [1, 5]. Pas en dessous (ça fait vide), pas au-dessus (perd son sens).

## C.6 — Pas de "Récemment vus" / historique (P1, énorme impact rétention)

Quand un client revient sur Komerce 2 jours plus tard pour finir son achat, il doit re-trouver le produit à la main. Sur Temu, il y a un rail "Vu récemment" qui ramène les 6-8 derniers produits consultés. Ça vit dans `localStorage`, c'est gratuit côté backend.

**Fix** : ajouter un rail horizontal "Récemment consultés" entre le hero et la grille, alimenté par `localStorage` (les 8 derniers `product_id` ouverts en modal). 0 backend, 50 lignes de JS, gros impact rétention.

## C.7 — Le checkout cash relais n'est pas explicité (P0 conversion diaspora)

Le client diaspora ne sait pas comment fonctionne "paiement cash" tant qu'il n'a pas commandé. C'est un frein énorme : il met le produit au panier, arrive au checkout, découvre qu'il y a un système de code à 6 chiffres + relais Mutsamudu… il peut abandonner s'il ne comprend pas.

**Fix** : un mini-bloc explicatif **avant le checkout**, soit en page dédiée `/comment-ca-marche`, soit en modale qu'on ouvre depuis le footer. 4 étapes visuelles : *« Vous payez en EUR depuis Paris → Le proche aux Comores reçoit un code → Il retire en cash chez le relais → Confirmation WhatsApp »*. Cinq minutes de design, beaucoup de conversions sauvées.

## C.8 — Recherche : pas de filtres rapides (P2)

Aujourd'hui : champ texte simple. Pour 450+ produits, c'est peu. Temu a des chips de filtres rapides sous la barre quand on tape (ex : "moins de 5000 KMF", "livraison express", "nouveautés"). C'est ce qui transforme une recherche en exploration.

**Fix V2** : sous la dropdown de recherche, afficher 3-4 chips contextuelles selon ce qu'on tape ("Toutes tailles" / "S, M, L" / "<5000 KMF" / "En stock"). Pas urgent mais ça change l'engagement.

## C.9 — Top 3 priorités si vous devez choisir

Si vous ne devez retenir que 3 améliorations Temu-like, dans l'ordre :

1. **C.7 — Bloc "Comment ça marche" avant checkout** — taux de conversion diaspora
2. **C.6 — Rail "Récemment consultés"** — rétention bête et méchante, 50 lignes de code
3. **C.3 — Renommer "Pour vous…" en "Sur-mesure"** — 30 secondes de boulot, gros gain en clarté

Le reste est nice-to-have. C.2 (hero trop haut) demande à être vérifié en testant avant de modifier.

---

# PARTIE D — Le prompt unique à coller dans Claude Code

```
Tu es un dev frontend expérimenté. Tu vas appliquer des corrections et améliorations sur la boutique mobile Komerce. 
Le doc MOBILE_BOUTIQUE_AUDIT.md (ce fichier) décrit chaque correction précisément avec les diffs exacts.

CONTEXTE TECHNIQUE :
- Frontend : ES modules natifs (pas de framework), pas de bundler
- Pattern b-*.js dans boutique/js/
- Bus d'événements : boutique/js/b-bus.js
- State : boutique/js/b-store.js
- Le pager mobile est boutique/js/b-pager.js (550 lignes)
- Tokens CSS : boutique/css/tokens.css

CONTRAINTES STRICTES :
- Tu n'introduis AUCUN framework (pas de React/Vue/Svelte)
- Tu n'introduis AUCUN bundler (pas de Vite/Webpack)
- Tu n'introduis AUCUNE dépendance npm
- Tu utilises UNIQUEMENT les tokens de tokens.css pour les couleurs
- Tu testes APRÈS CHAQUE fix sur (a) Chrome DevTools mobile (b) au moins 1 vrai device si possible
- Tu commits après chaque fix (1 fix = 1 commit)

ORDRE D'EXÉCUTION :

═══ PARTIE A — Bug ghost gauche (PRIORITÉ ABSOLUE) ═══

1. Lis intégralement boutique/js/b-pager.js
2. Applique les 3 modifications exactes du §A.3 :
   - Modification 1 : _setupInfiniteLoop (ajout ghost gauche + décalage scroll initial)
   - Modification 2 : _setupScrollSync (détection ghostType 'left' / 'right')
   - Modification 3 : _ghostTeleport (paramètre direction)
3. Test sur Chrome DevTools mobile (375x667) : valider les 6 points du §A.3 fin
4. Test sur vrai iPhone si possible (critique pour Safari iOS + scroll-snap)
5. Test sur vrai Android Chrome ou émulateur
6. Commit : "fix(mobile): bidirectional infinite scroll on category pager"

═══ PARTIE B — Autres bugs ═══

7. Fix B.2 (re-création ghosts pendant téléportation) — applique le diff
   Test : trigger une re-création (filtre, recherche) pendant qu'on est sur un ghost → vérifier qu'on ne perd pas la position
   Commit : "fix(mobile): preserve scroll position when ghosts are recreated"

8. B.1 (debounce _recalcPagerVars) — D'ABORD MESURER :
   - Ajoute un compteur temporaire (console.count) dans la fonction
   - Lance la boutique mobile, scrolle naturellement 30 secondes
   - Si la fonction est appelée plus de 3 fois/seconde sous scroll normal → applique le debounce 100ms
   - Sinon documente "B.1 vérifié OK, fréquence acceptable" et passe au suivant
   Commit (si fix) : "perf(mobile): debounce pager vars recalculation"

9. B.4 (SW reset nuclear) — DEMANDE D'ABORD au user :
   - "Est-ce que le SW reset nuclear v326 dans index.html est toujours nécessaire ?"
   - Si réponse "non / je sais pas" : trace l'origine via `git log --all -- boutique/index.html | head -50` et `git blame` sur les lignes
   - Si l'incident d'origine est clairement résolu (commit > 30 jours et pas de mention dans changelogs récents) → propose la suppression
   - SINON laisse en place
   Commit (si fix) : "chore: remove obsolete SW nuclear reset"

10. B.3 (bounce vertical) — DEMANDE D'ABORD au user :
    - "Tu trouves le bounce vertical (scroll auto vers page suivante en bas) trop sensible / OK / à désactiver ?"
    - Selon réponse, ajuste les seuils ou ajoute un toggle dans les paramètres
    Commit : "feat(mobile): tune vertical bounce sensitivity" (selon décision)

═══ PARTIE C — Améliorations Temu-like ═══

11. C.3 (Renommer "Pour vous…" → "Sur-mesure") — 30 secondes
    Édition simple de boutique/index.html ligne 215
    Commit : "ux(mobile): rename ambiguous 'Pour vous' chip to 'Sur-mesure'"

12. C.6 (Rail "Récemment consultés") — 1-2h
    - Crée boutique/js/b-recently-viewed.js
    - Hook : à chaque ouverture de modal produit, ajoute le product_id en tête d'un array localStorage 'kmrc_recently_viewed' (max 8 items, dédup par id)
    - Render : insère un rail horizontal entre le hero et la grille produits, masqué si liste vide
    - Style : réutilise les classes existantes des cartes produit (cohérence visuelle)
    - Cas mobile uniquement OU mobile+desktop, demande au user
    - Tests : ouvrir 3 produits, recharger la page, vérifier que le rail affiche les 3 produits
    Commit : "feat(mobile): add recently-viewed products rail"

13. C.7 (Bloc "Comment ça marche" avant checkout) — 2-3h
    - Crée une modale ou page /comment-ca-marche
    - 4 étapes visuelles : Paiement EUR Paris → Code reçu Comores → Retrait cash relais → Confirmation WhatsApp
    - Style aligné tokens.css (palette Komerce, pas Temu)
    - Bouton "J'ai compris, je continue" qui ferme la modale
    - Trigger : afficher AVANT le formulaire checkout (la première fois pour chaque utilisateur, via localStorage 'kmrc_seen_howto')
    - Lien aussi accessible depuis footer "Comment ça marche ?"
    Commit : "feat(checkout): explain cash-relais flow before purchase"

14. C.5 (Indicateur stock ≤5) — 1h
    - Modifie render-product-card.js
    - Si product.stock entre 1 et 5 inclus : afficher badge "Plus que N disponibles" en orange (--coral)
    - Cas stock = 0 → "Rupture de stock" en gris (déjà existant ?)
    Commit : "feat(catalog): show low-stock urgency badge"

15. C.4 (Bouton panier — label desktop) — 30 min
    - Sur desktop ≥ 900px, ajouter un label "Panier" à côté de l'avatar
    - Mobile inchangé
    Commit : "ux(header): add 'Panier' label on desktop cart button"

═══ ÉVALUATION POST-CHANTIER ═══

16. C.2 (Hero mobile trop haut) — À VALIDER AVEC USER après tests utilisateurs
    - Pour l'instant, mesure : ouvrir la boutique en Chrome DevTools mobile 375x667
    - Compter combien de produits sont visibles au 1er chargement sans scroller
    - Si zéro ou un demi-produit → propose au user le hero réduit à 240px
    - Sinon, documente la mesure et passe
    Pas de commit tant que pas validé par user

17. C.8 (Filtres rapides recherche) — À reporter en V2
    - Ne pas implémenter dans ce chantier
    - Documenter dans docs/ROADMAP_KOMERCE.md comme amélioration future P2

RÈGLES DE COMMUNICATION :
- À chaque commit, fais un résumé en 2 lignes au user
- Toutes les 30 minutes, fais "résumé de ce qui est fait jusqu'ici"
- Si tu hésites sur une décision UX → tu t'arrêtes et tu demandes
- Si un test échoue sur iOS Safari mais marche sur Chrome → tu stoppes et tu signales

Démarre par lire b-pager.js intégralement. Confirme-moi quand c'est fait, et démarre la Partie A.
```

---

# 🎯 Critères de fin globaux

Quand tout est appliqué :

- ✅ Swipe gauche depuis "Tout" → on arrive sur la dernière catégorie sans flash visible
- ✅ Swipe droite depuis la dernière catégorie → on revient sur "Tout" avec reshuffle (existant, ne pas casser)
- ✅ Pas de bug d'index après recreation de la grille
- ✅ Tests passants sur Chrome DevTools mobile + 1 iPhone réel + 1 Android réel
- ✅ Chip "Sur-mesure" affichée correctement (plus de "Pour vous…")
- ✅ Rail "Récemment consultés" fonctionnel après 3 visites de produit
- ✅ Modale "Comment ça marche" affichée à la 1ère arrivée checkout
- ✅ Badge "Plus que N disponibles" sur produits avec stock ≤ 5
- ✅ Aucune régression visuelle vs l'avant-chantier (test A/B en local : avant/après)
- ✅ Commits propres, atomiques, sur une branche `feature/mobile-audit-may-2026`

---

# 📦 Fichiers à attacher

Si vous utilisez Claude Code (terminal), il a accès direct au filesystem — pas besoin d'attacher.

Si vous utilisez Sonnet 4.6 dans Claude.ai web :

- Ce fichier (`MOBILE_BOUTIQUE_AUDIT.md`)
- `boutique/index.html`
- `boutique/js/b-pager.js`
- `boutique/js/b-catalog.js`
- `boutique/js/b-mini-cart.js`
- `boutique/js/main.js`
- `boutique/js/render/render-product-card.js`
- `boutique/css/tokens.css`
- `boutique/css/products.css`
- `boutique/css/layout.css`

---

# ⏱️ Estimation effort par bloc

| Bloc | Effort | Cumul |
|---|:-:|:-:|
| Partie A — Ghost gauche | 4h | 4h |
| Partie B — Autres bugs (selon résultats des mesures et confirmations) | 1-3h | 5-7h |
| C.3 Renommer chip | 5 min | 5h05-7h05 |
| C.6 Rail récemment consultés | 1-2h | 6h-9h |
| C.7 Modale comment ça marche | 2-3h | 8-12h |
| C.5 Badge stock | 1h | 9-13h |
| C.4 Label desktop panier | 30 min | 9.5-13.5h |
| **TOTAL** | | **~10-14h (1.5 jour)** |

C.2 (hero) et C.8 (filtres recherche) reportés selon décision user.

---

# 📝 Position dans la roadmap pilote

À insérer comme **chantier 7-bis** (entre 6 et 7) dans `ROADMAP_PILOTE_KOMERCE.md`.

Mise à jour de l'ordre Go-Live recommandé :

```
1 → 3 → 2 → 6 → 4 → 5 → [7-bis ce chantier] → soft launch → 7 desktop / 8 collectif / 9 sur-mesure / 10 docs / 11 roadmap
```

Le 7-bis avant le soft launch parce que la majorité du trafic diaspora arrive par WhatsApp → mobile. Le 7 desktop peut attendre l'après-launch.
