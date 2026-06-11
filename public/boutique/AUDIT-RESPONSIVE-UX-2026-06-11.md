# AUDIT BOUTIQUE + RESPONSIVE + UX COCKPIT GROUPE — KOMERCE

Date : 11/06/2026 · Méthode : audit statique (garde-fous du repo) + audit dynamique Playwright/Chromium sur 8 viewports (320 → 1440 px), API mockée, pager Temu horizontal/vertical traité comme architecture voulue (hors périmètre des défauts).

## 1. Bugs réels trouvés et corrigés

### 1.1 — `css/tokens.css` : ~120 lignes de variables hors de tout bloc (CRITIQUE)
Le second bloc `:root` fermait ligne 357 mais le fichier continuait jusqu'à 479 : toutes les variables « PR-G6 : tokens rgba manquants » (overlays noirs, red-pulse, sand-gradient…) flottaient hors de tout sélecteur. Double dégât en production :
1. ces variables n'existaient pas (fallbacks silencieux ou valeurs invalides partout où elles sont utilisées) ;
2. dans le bundle `base.css`, le parseur avalait les déclarations orphelines **avec la règle universelle du reset** qui les suit (`*, *::before, *::after { box-sizing; margin:0; padding:0 }`).

Conséquence mesurée : marge UA de 8 px sur `body` et `box-sizing: content-box` par défaut sur toute la boutique — c'était la cause racine des débordements horizontaux desktop (+8 à +20 px de scroll) observés sur la home. Fix : variables ré-englobées dans un `:root { }`, balance d'accolades validée, bundle régénéré, règle universelle de nouveau parsée (vérifié via CDP).

### 1.2 — Cockpit groupe empilé en une colonne même sur desktop
`.k-group-cockpit { display: block }` posé hors media query APRÈS le bloc `@media ≥900px { display: grid }` l'écrasait à spécificité égale. Les blocs « SAFE V2-C » suivants redéfinissaient `grid-template-columns` mais jamais `display: grid` → la grille deux colonnes (pilotage + panneau articles sticky) ne s'appliquait jamais. Doublon supprimé (la base mobile-first existe en tête de fichier) ; grille desktop vérifiée fonctionnelle au harnais (colonne principale ~620 px, aside ~330 px).

### 1.3 — Chips catégories : débordement entre 900 et ~1240 px
`html.k-home-premium-v1 .k-chip { min-width: 164px }` dans des tracks `repeat(auto-fit, minmax(120px, 1fr))` : à 900 px les colonnes font ~131 px, les chips débordaient du conteneur (+12 px de scroll horizontal). La contrainte 164 px vit désormais sur les tracks de la grille — `auto-fit` réduit le nombre de colonnes nativement, plus aucun débordement.

### 1.4 — Zoom automatique iOS sur la recherche
`.k-search input` à 14 px : sous 16 px, iOS Safari zoome la page au focus (dézoom manuel ensuite). Passé à 16 px en base (l'override desktop 16 px existait déjà — le bug ne frappait que mobile, là où ça compte).

## 2. Résultat après corrections

Zéro débordement horizontal sur les 8 viewports testés : 320 (iPhone SE), 360, 390, 428, 768, 900 (breakpoint), 1280, 1440 px. Zéro input < 16 px sur mobile. Le seul signal console restant est un 404 d'images absentes du zip (assets non versionnés, attendu).

## 3. UX cockpit créateur — direction mockup implémentée

Conformément au mockup validé et à la consigne « condenser avec des toggles comme le checkout » :

- **Carte identité** (`renderOwnerIdentityCard`) : eyebrow « 👥 Panier groupe », titre, « Organisé pour X », ligne méta total · statut · n articles. Remplace l'ancien header générique.
- **Bande financière unique** : Total / Engagé / Payé / Reste + barre double lecture (payé/engagé) + légende. La barre de progression vivait en double (bande + renderProgress) : déduplication, et la bande porte un id rafraîchi par le polling.
- **Badge de phase** en tête de la carte d'actions : « 🟢 Phase ouverte — concertation » → « 🔐 Paiement ouvert » / « ✅ Tout est payé » → « 📦 Commande créée ».
- **Accordéons style checkout** (pattern `.ck-track-details` : summary flex, marqueur +/−, cibles tactiles 44-46 px mesurées) : Articles (« 🛒 3 articles · 33 800 KMF »), Participants (« Participants (3) · 24 300 KMF engagés »), Options. Repliés par défaut sur mobile pour condenser, ouverts sur desktop (≥900 px).
- **Participants façon mockup** : avatar initiales (5 teintes déterministes), prénom, téléphone masqué (••••2100), montant, statut « indicatif » / « ⏳ En attente » / « ✅ Payé ».
- **Options** (LOT 5 respecté) : « Modifier les articles » uniquement en phase ouverte (articles figés au règlement), « Annuler ce panier » en danger, séparé par un filet, jamais à côté de l'action principale.

Validé au harnais sur fixtures du mockup (Marie, 33 800 KMF, 3 articles, 3 participants dont 1 payé) en 360/390/1280 px : 0 débordement, 1 seule barre de progression, 3 avatars, accordéons conformes, bouton principal 51 px pleine largeur mobile.

## 4. Restes à arbitrer (non corrigés volontairement)

1. **Tap targets 29-34 px** : chips « Tout/Soldes » (29 px), fav (34), ajout panier (32), croix modale (34). Pattern e-commerce dense courant ; WCAG 2.5.8 minimum (24 px) respecté, recommandation 44 px non atteinte. À trancher produit avant retouche.
2. **`audit:arch` : 30 hex hardcodés** (surtout `cart.css`) à tokeniser ou allowlister — dette préexistante, hors périmètre de cette passe.
3. **`check:breakpoints`** signale 3 breakpoints hors doctrine 900/1200 : `cart.css` min:600, `modal-shell.css` max:1120 (préexistants), `group-cart-flow.css` max:380 — celui-ci est exigé par le brief V4 (LOT 6 « sur mobile < 380px ») : à ajouter à l'allowlist du garde-fou avec justification.
4. Boutons densifiés desktop (31 px) par les blocs SAFE V2-C : conforme LOT 6 (44 px exigés sur mobile seulement), conservé.

## 5. Outillage livré

- `npm run audit:responsive` — audit 8 viewports : overflow + éléments fautifs, tap targets, inputs < 16 px, erreurs console, captures dans `audit-shots/`.
- `npm run audit:cockpit` — harnais visuel du cockpit créateur sur fixtures mockup (3 viewports, captures).
- `npm run check:group-wording` — garde-fou LOT 7/10 (déjà branché dans `check:all`).

## 6. Fichiers modifiés (cette passe)

`css/tokens.css` (fix :root), `css/categories.css` (fix chips), `css/layout.css` (input 16px), `css/group-cart-flow.css` (fix grille cockpit + accordéons/badges/avatars/identité), `js/group/group-render-creator.js` (identité, articles accordéon, participants mockup, badges, options), `js/b-group-view.js` (assemblage mockup + polling double), `package.json` (scripts d'audit), `scripts/audit-responsive.js` + `scripts/harness-creator-cockpit.js` (nouveaux), `css/dist/*` + `index.html` (bundles + bumps via deploy-css).

## 7. Addendum — scroll erratique onglets Groupe / Suivi (mobile)

Symptôme rapporté : scroll « n'importe comment, y compris dans le vide », rien de fixe, sur les onglets Suivi et Groupe.

Cause : `js/b-scroll-owner.js` considérait `#k-page-scroll` comme LE scroller mobile en toutes circonstances. C'est vrai uniquement quand le pager Temu est actif (vue Boutique, `.k-pager-active`). Sur Groupe/Suivi/Favoris le pager est détruit et c'est window qui scrolle : `scrollPageToTop()` scrollait donc un conteneur inerte (le scroll window hérité n'était jamais remis à zéro → atterrissage « dans le vide » en bascule d'onglet) et `getScrollY()` renvoyait 0 en permanence aux 10 modules consommateurs (sauvegarde/restauration de scroll des modales, header, etc.).

Fix : `getMobileScrollContainer()` retourne `#k-page-scroll` seulement si `.k-pager-active`, sinon window ; `getScrollY` / `scrollToPosition` / `scrollPageToTop` / `scrollPageToElement` adaptés, avec remise à zéro window systématique en bascule. Validé au harnais (`npm run audit:tabs-scroll`) : header/bnav fixes pendant le scroll des onglets, `window.scrollY=0` après re-bascule avec scroll résiduel de 400px.

Note : le ressenti prod était amplifié par le bug §1.1 (reset CSS avalé) encore en ligne au moment du test — les deux fixes se cumulent.
