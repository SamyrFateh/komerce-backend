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
- [x] Régénération puis commit du document LIVE fiable : **39 sources**, **0 orphelin**, **0 source bundle manquante** ; le LIVE expose désormais les cliquets exécutables **cascade 0 / spécificité 0 / dette `!important` ouverte 0**, séparément des **3 occurrences physiques revues**.
- [x] Alignement de `BOUTIQUE_ARCHITECTURE.md` sur l'état réel 2026-08 : `css-bundles.js` est la source canonique, trois bundles livrés, owners/adaptations actuels documentés et doctrine premium de sur-spécificité retirée.
- [x] B0 clos : test `gen-boutique-arch-live-debt-metrics.test.js` vert et `npm run boutique:audit` vert sur la photographie régénérée.

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
- [x] B2-2 checkout ownership : supprimer de `cart.css` 63 déclarations globales perdantes déjà redéfinies plus tard par `checkout-vertical-rail.css` avec le même sélecteur/propriété ; **43 conflits supprimés**, cascade **167 → 124**, 0 nouvelle clé ; checkout **92 → 49 conflits** ;
- [x] B2-2b checkout interne : pour les doublons exacts sélecteur + contexte media + propriété dans `cart.css`, supprimer uniquement les déclarations antérieures à la dernière gagnante ; **38 conflits supprimés**, cascade **124 → 86**, 0 nouvelle clé ; checkout **49 → 11 conflits** ;
- [x] B2-2c checkout final : supprimer les 11 dernières déclarations perdantes avec valeurs gagnantes explicitement prouvées (`cart.css` 8, `modal-shell.css` 2, split couleur relais 1) ; cascade **86 → 75**, checkout **11 → 0 conflit**, 0 nouvelle clé ;
- [x] B2-3 catégories desktop internes : supprimer 23 déclarations supersédées avec groupe de sélecteurs + contexte media + propriété strictement identiques (`category-cutout-navigation-desktop.css` 21, `boutique-desktop.css` 2) ; cascade **75 → 52**, famille catégories **32 → 9 conflits**, 0 nouvelle clé ;
- [x] B2-3b catégories final : supprimer les 9 dernières déclarations perdantes (`categories.css` internes + winners `products.css`) et le fragment d'ombre orphelin invalide déjà ignoré par les navigateurs ; cascade **52 → 43**, famille catégories **9 → 0 conflit**, `categories.css` redevient parseable par PostCSS, 0 nouvelle clé ;
- [x] B2-4 modale/PDP/suggestions : consolider 27 clés cross-owner sur l'ordre canonique du bundle `components.css`, avec 28 suppressions/splits physiques et vérification explicite des winners ; cascade **43 → 16**, famille modale/suggestions **27 → 0 conflit**, 0 nouvelle clé ;
- [x] B2-final cascade : rembourser les 16 dernières clés (wallet 6, hero 4, bottom-nav 4, cart 1, skeleton 1), avec 17 suppressions/splits physiques, suppression du fragment d'ombre hero invalide déjà ignoré par les navigateurs, et vérification de chaque winner ; cascade **16 → 0**, baseline cascade vide, 0 nouvelle clé ;
- [x] B3-1 spécificité same-media : classifier les 86 clés et consolider les **43** dont toutes les occurrences physiques sont dans le même contexte media ; transférer la valeur premium gagnante vers le dernier owner de base du même media, supprimer la propriété premium et les perdantes redondantes ; spécificité **86 → 43**, cascade **0 → 0**, 0 nouvelle clé ;
- [x] B3-2 spécificité cross-media sûre : consolider **35** clés premium restantes (23 mixed-media + 12 all-different-media) en retirant le préfixe premium au media gagnant et toutes les déclarations base du même sélecteur/propriété/media, y compris celles masquées par le rapport de spécificité ; spécificité **43 → 8**, cascade **0 → 0**, 0 nouvelle clé ;
- [x] B3-3 final : re-home explicite des **7** clés premium restantes vers leurs owners canoniques (`layout.css` / `categories.css`), puis neutraliser la sur-spécificité du dernier état transitoire avec `body:where(.modal-open)` ; spécificité **8 → 0**, cascade **0 → 0** ;
- [x] figer chaque baisse par le cliquet existant, y compris la baseline vide **0** ;
- [x] zéro atteint après preuve d’ownership et test de non-régression du `--save` vide, sans acceptation en masse.

## B4 — Ownership applicatif exécutable

- [x] B4-0 couverture globale : mesurer le gate existant sur le dépôt réel — **145** fichiers initialement comptés, **131** rattachés, **14** faux orphelins tous situés dans `public/boutique/harnais/geometry/` ;
- [x] classifier le harnais géométrique comme outillage navigateur non applicatif, conformément à son README et à son rôle de repro/mesure ;
- [x] fermer le périmètre runtime à **131 / 131 = 100%**, **0 fichier applicatif orphelin** ;
- [x] passer `gate:boutique-ownership:full` en `--strict` et l'ajouter aux Boutique source gates de `pr-enforcement.yml` ;
- [x] B4-1 sélecteurs critiques : remplacer l’ancienne allowlist I-2 historique par un registre machine-readable unique partagé par le LIVE, le guard dédié et l’audit architecture ; **15 sélecteurs contractés**, owner principal obligatoire, nouveaux owners/contextes base-desktop interdits, réduction d’adaptation autorisée ;
- [ ] B4-2 : verrouiller de la même façon les producteurs des variables CSS runtime posées par JS.

Ce fichier est un ledger de chantier, pas une nouvelle baseline. Les cliquets existants restent les guards exécutables jusqu'à leur remboursement explicite.
