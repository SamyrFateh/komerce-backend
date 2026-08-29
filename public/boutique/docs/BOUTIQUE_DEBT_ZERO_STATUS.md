# Boutique Debt Zero — Status

## Baseline de départ

État observé avant reprise complète :

- `boutique:audit` : 0 violation ;
- breakpoints : 0 ;
- Boutique 360 : orphan emit/listen = 0, undeclared = 0 ;
- `!important` : 9 occurrences physiques ;
- assets manquants suivis : 2 ;
- conflits de cascade suivis par baseline : 211 ;
- conflits de spécificité suivis par baseline : 87 ;
- Architecture LIVE : faux diagnostic historique de 30 CSS orphelins, dû au parsing du wrapper `bundle-css.js` au lieu de la source canonique `css-bundles.js`.

## B0 — Vérité instrumentée

- [x] `gen-boutique-arch-live.js` dépend directement de `css-bundles.js`.
- [x] Le générateur est importable sans écrire implicitement le document LIVE.
- [x] Test de non-régression : chaque source CSS sur disque doit être déclarée dans `BUNDLES` et aucune source déclarée ne doit manquer.
- [x] PR #988 : Boutique source gates verts, tests ciblés verts, arbre non muté, Required verdict vert.
- [x] PR #988 mergée sur `main` — commit `182788870b744af9dfe050d21f0021f6c492c5b9`.
- [ ] Régénération puis commit du document LIVE fiable.
- [ ] Alignement de `BOUTIQUE_ARCHITECTURE.md` sur l'état réel 2026-08.

## B1a — Mesure fiable de la dette simple

### `!important`

- état physique : 9 ;
- guards desktop exacts/revus : 3 (`.k-cart-drawer.open` / `.k-cart-overlay.open` à ≥900px) ;
- dette ouverte : 6 (`hero.css` 4 + `share-cart.css` 2) ;
- la baseline `!important` ne compte désormais que la dette ouverte ;
- si un guard revu change de sélecteur, valeur ou contexte media, il redevient automatiquement dette ouverte.

### Assets

- `hero_banner.png` : aucune référence vivante ; retiré de la baseline comme dette périmée ;
- `og-cover.jpg` : seule dette asset restante, référence vivante dans `meta[property=og:image]` mais fichier absent ;
- baseline assets : 2 → 1.

### Dépendances

- l'ancien `npm audit --omit=dev` excluait presque tout le workspace Boutique, composé majoritairement de devDependencies ;
- `audit-gate.js` lance désormais `npm audit --json` sur l'arbre complet ;
- un test verrouille l'absence de `--omit=dev` et le traitement high/critical ;
- audit réel du 2026-08-29 après `npm ci` : 4 vulnérabilités détectées (3 high : `brace-expansion`, `js-yaml`, `nanoid` ; 1 moderate : `postcss`), toutes corrigeables sans `--force` ;
- `npm audit fix` a mis à jour uniquement le lockfile ; second `npm audit --audit-level=low` : 0 vulnérabilité ; gate Komerce high/critical : vert.

### Preuves

- [x] Draft #989 : PR enforcement vert sur le SHA de mesure B1a.
- [x] PR #990 mergée — B1a est la baseline courante de départ de B1b.

## B1b — Remboursement à poursuivre

- [x] retirer les 3 `!important` hero inutiles par spécificité naturelle — B1b-1, dette ouverte 6 → 3 (`hero.css` 1 + `share-cart.css` 2) ;
- [x] sortir la hauteur inline de `#k-header-spacer` vers son owner `layout.css`, puis retirer son dernier `!important` hero — B1b-2, dette ouverte CSS 3 → 2 (`share-cart.css` uniquement) ;
- [x] supprimer le source mort `share-cart.css` et ses déclarations bundle + manifests — B1b-3, dette CSS ouverte 2 → 0 ;
- [x] retirer le sous-arbre desktop orphelin (`k-sc-shared-badge`, `k-sc-shared-*`, `k-sc-reshare-btn`, `k-sc-group-view-btn`, `kSharedPulse`) de `boutique-desktop.css` — B1b-4 ; `.k-sc-btn-group` est conservé comme garde de compatibilité car encore référencé par `b-product-open-contract.js` ;
- [x] supprimer le vestige complet `.k-hero-logo-glow` (SVG caché + CSS/animations `klg-*`) et interdire les `!important` inline dans `index.html` — B1b-5 ;
- [x] remplacer la référence morte `og-cover.jpg` par le hero canonique vivant `komerce_hero_catalog_canonical_v4.webp` et abaisser la baseline assets manquants 1 → 0 — B1b-6 ;
- [x] exécuter l'audit npm complet et fermer les vulnérabilités détectées sans `--force` — B1c, 4 → 0 vulnérabilité ;
- [x] reconstruire les trois bundles canoniques puis recalculer les cliquets sur la vérité corrigée — B2-0 : cascade **211 → 211**, spécificité **87 → 86**, **0 nouvelle clé** avant abaissement de baseline.

## B2 / B3 — Dette structurelle restante

- [x] B2-1 side-cart : supprimer 41 déclarations perdantes du layer `boutique-desktop.css` et transférer explicitement leur ownership visuel à `side-cart-desktop-polish.css` ; cascade **211 → 170**, sans nouvelle clé ;
- [x] B2-1b side-cart cross-owner : supprimer les 3 dernières collisions (`shared-list-side-cart.css` + `modal-shell.css`) tout en conservant les valeurs gagnantes du polish ; cascade **170 → 167**, side-cart **44 → 0 conflit** ;
- [x] B2-2 checkout ownership : supprimer de `cart.css` 63 déclarations globales perdantes déjà redéfinies plus tard par `checkout-vertical-rail.css` avec le même sélecteur/propriété ; **43 conflits supprimés**, cascade **167 → 124**, 0 nouvelle clé ; checkout **92 → 49 conflits** à classifier dans les sous-lots suivants ;
- [ ] poursuivre la classification des 124 conflits de cascade par famille fonctionnelle et réduire les owners concurrents sans augmenter l'allowlist ;
- [ ] traiter les 49 conflits checkout restants (collisions internes `cart.css`, identity/interactions/paypal, contextes media) avec preuve d'owner séparée ;
- [ ] classifier les 86 overrides de spécificité par classe globale / famille fonctionnelle et supprimer les couches premium ou d'état qui ne sont plus nécessaires ;
- [ ] figer chaque baisse par le cliquet existant ;
- [ ] ne viser zéro qu'après preuve d'ownership, jamais par acceptation en masse.

Ce fichier est un ledger de chantier, pas une nouvelle baseline. Les cliquets existants restent les guards exécutables jusqu'à leur remboursement explicite.
