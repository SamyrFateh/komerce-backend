# Pipeline CSS Boutique

> **Statut** : doc d'architecture du système CSS Boutique
> **Date** : 18 mai 2026 — lot CSS-4
> **Périmètre** : `public/boutique/css/*.css` (sources) + `public/boutique/css/dist/*.css` (production)

---

## 1. Ce qui est chargé en production

`public/boutique/index.html` lignes 68-71 :

```html
<link rel="stylesheet" href="/boutique/css/dist/base.css?v=3">
<link rel="stylesheet" href="/boutique/css/dist/components.css?v=3">
<link rel="stylesheet" href="/boutique/css/dist/desktop.css?v=3">
<link rel="stylesheet" href="/boutique/css/dist/event.css?v=3">
```

**Aucune source individuelle n'est chargée directement.** Modifier `modal.css`, `categories.css`, `hero.css`, etc. **n'a aucun effet en prod** tant que le bundler n'a pas tourné.

---

## 2. Le bundler

Fichier : `public/boutique/scripts/bundle-css.js`
Commande : `cd public/boutique && npm run bundle:css`

**Comportement** : concat naïf des sources dans l'ordre déclaré, avec headers générés.

```js
const bundles = [
  { out: 'base.css',       files: ['tokens', 'reset', 'layout', 'hero'] },
  { out: 'components.css', files: ['categories', 'products', 'modal', 'cart', 'interactions',
                                   'hero-cart-proxy', 'group-cart-flow', 'shared-followup'] },
  { out: 'desktop.css',    files: ['boutique-desktop', 'desktop-commerce-skeleton'] },
  { out: 'event.css',      files: ['tokens', 'event'] },
];
```

**Pas de minification, pas de tree-shaking, pas de validation.** Si une source est manquante, le bundler émet un warning et continue.

---

## 3. Mapping source → bundle

### `base.css` (4 sources)

| Source | Rôle | Lignes typiques |
|---|---|---:|
| `tokens.css` | Variables CSS (couleurs, spacing, ombres, courbes) | ~280 |
| `reset.css` | Normalize + reset minimal | ~85 |
| `layout.css` | Squelette page (#k-page-scroll, footer, safe-area) | ~740 |
| `hero.css` | Hero mobile (base + max-w 899) | ~145 |

### `components.css` (8 sources)

| Source | Rôle | Lignes |
|---|---|---:|
| `categories.css` | Chips de catégories mobile, sec headers | ~470 |
| `products.css` | Cartes produit, grille | ~720 |
| `modal.css` | **Modal produit** (1736L, voir BOUTIQUE_MODAL_ARCHITECTURE.md) | 1736 |
| `cart.css` | Panier flottant, side cart (mobile + base) | ~900 |
| `interactions.css` | Animations, transitions, micro-interactions | ~530 |
| `hero-cart-proxy.css` | Proxy hero ↔ cart | ~110 |
| `group-cart-flow.css` | Placeholder (2 lignes) | 2 |
| `shared-followup.css` | Placeholder (2 lignes) | 2 |

### `desktop.css` (2 sources)

| Source | Rôle | Lignes |
|---|---|---:|
| `boutique-desktop.css` | Tous les enrichissements desktop : mega-nav, side cart, k-subchip, hero refonte, **et certaines règles .k-modal-* desktop-only** (recent grid, keyboard hint) | ~1480 |
| `desktop-commerce-skeleton.css` | Squelette commerce desktop : hero, layout général, .k-modal-img-wrap hover | ~325 |

### `event.css` (2 sources)

| Source | Rôle | Lignes |
|---|---|---:|
| `tokens.css` | Re-importé (variables nécessaires aux pages event) | ~280 |
| `event.css` | Tout le styling des pages collective workspace | ~860 |

---

## 4. Carte des owners par famille de sélecteurs

| Famille `.k-*` | Source propriétaire | Bundle dist |
|---|---|---|
| `.k-hero-*` (mobile + base) | `hero.css` | `base.css` |
| `.k-hero-*` (desktop overrides) | `desktop-commerce-skeleton.css` | `desktop.css` |
| `.k-cats-*`, `.k-chip` mobile | `categories.css` | `components.css` |
| `.k-cats-*`, `.k-chip` desktop overrides | `boutique-desktop.css` | `desktop.css` |
| `.k-subchip*`, `#k-subcats-wrap` | `boutique-desktop.css` | `desktop.css` |
| `.k-grid`, `.k-card` | `products.css` | `components.css` |
| `.k-modal-*` base + mobile + desktop core | `modal.css` | `components.css` |
| `.k-modal-recent-*`, `.k-modal-keyboard-hint` | `boutique-desktop.css` | `desktop.css` |
| `.k-modal-img-wrap` hover | `desktop-commerce-skeleton.css` | `desktop.css` |
| `.k-cart-*`, `.k-side-cart`, `.k-sc-*` base | `cart.css` | `components.css` |
| `#k-side-cart .k-sc-btn-*` overrides desktop | `boutique-desktop.css` | `desktop.css` |
| `.k-vg*`, `.k-sku`, `.k-vp` (variants) | `modal.css` | `components.css` |
| `.k-section-*`, `.k-sec-grid` | `categories.css` + `interactions.css` | `components.css` |
| `.k-cw-*` (collective workspaces) | `event.css` | `event.css` |

**Remarques importantes** :

1. **Le modal a TROIS sources qui contribuent** (`modal.css`, `boutique-desktop.css`, `desktop-commerce-skeleton.css`). Ce n'est pas un bug, c'est intentionnel — chaque source a son périmètre. Mais c'était caché jusqu'à maintenant.

2. **`#k-side-cart .k-sc-btn-*` est dans `boutique-desktop.css`** (avec spécificité préfixée, plus haute que les versions non préfixées de `cart.css`).

3. **Les chips de catégories ont 2 owners** : mobile dans `categories.css`, desktop dans `boutique-desktop.css`. Avant la migration, c'était dispersé dans 3 fichiers (triplon `k-subchip` corrigé par ChatGPT le 17/05).

---

## 5. Règles d'or

### R1 — Toute modif source = `npm run bundle:css`

Aucune modification de `modal.css`, `categories.css`, etc. **n'a d'effet en prod** tant que le bundle n'a pas été régénéré. À faire **dans la même PR** que la modification.

### R2 — Ne jamais éditer un fichier `dist/*.css` directement

Toute modification serait écrasée au prochain bundle. Si une règle existe dans le dist mais pas dans la source, c'est une **dette à signaler dans STATUS.md**, pas une feature.

### R3 — Un sélecteur a UN owner principal

Sauf cas documenté ci-dessus (modal `.k-modal-*` réparti sur 3 sources, hero idem, chips mobile vs desktop), un sélecteur `.k-*` doit avoir un et un seul fichier propriétaire. **Triplons interdits** (cf. cas du `.k-subchip` qui a été nettoyé).

### R4 — Pas de hex en dur

Toutes les couleurs, ombres, rayons doivent être des variables CSS de `tokens.css`. Audit possible :

```bash
grep -nE "#[0-9a-fA-F]{3,6}" public/boutique/css/*.css | \
  grep -vE "(/\*|font-family|url\()"
```

Doit retourner 0 résultat.

### R5 — Les media queries doivent avoir une borne supérieure ou être ≥ 900px

Une règle `@media (min-width: 600px)` sans borne supérieure va déborder sur desktop et casser le layout. Toujours utiliser :
- mobile : base ou `@media (max-width: 899px)`
- desktop : `@media (min-width: 900px)`
- intermédiaire : `@media (min-width: 900px) and (max-width: 1120px)`

---

## 6. Checklist avant PR qui touche un CSS Boutique

Cocher avant tout commit qui modifie un fichier dans `public/boutique/css/` :

- [ ] J'ai modifié les **sources**, pas le `dist/`
- [ ] J'ai identifié le **bon owner** (cf. §4 ci-dessus) pour mes sélecteurs
- [ ] Je n'ai pas créé de doublon (un sélecteur dans 2 sources différentes)
- [ ] J'ai relancé `npm run bundle:css` après mes modifs
- [ ] J'ai vérifié que les 4 dist se sont bien régénérés (date récente)
- [ ] J'ai testé visuellement sur 3 viewports : mobile (< 600px), tablette (600-900px), desktop (1200px+)
- [ ] Aucune valeur hex en dur — uniquement des `var(--...)`
- [ ] Aucune media query sans borne haute (sauf ≥ 900px)
- [ ] Si je touche `modal.css`, j'ai aussi lu `BOUTIQUE_MODAL_ARCHITECTURE.md`
- [ ] Si je touche `boutique-desktop.css`, j'ai vérifié l'impact sur le mega-nav et les chips

---

## 7. Détection des dérives source ↔ dist

Pour vérifier si le dist est synchro avec les sources, lancer :

```bash
cd public/boutique
node scripts/bundle-css.js
git status css/dist/
# Si la commande affiche des modifs : le dist était désynchro AVANT votre PR
# Si elle n'affiche rien : le dist est à jour
```

**À automatiser dans un hook pre-commit** : refuser le commit si `css/dist/` est out of date par rapport aux sources.

---

## 8. Dette connue (au 18 mai 2026)

| Élément | Statut |
|---|:-:|
| Cadavre `.k-mega-dropdown` dans dist/desktop.css | ✅ Nettoyé par ChatGPT le 17/05 |
| Triplon `.k-subchip` (categories + dist/components + dist/desktop) | ✅ Nettoyé par ChatGPT le 17/05, owner = boutique-desktop.css |
| 45 nouveautés `modal.css` (enrichissements Temu) non bundlées | ✅ Bundle régénéré le 18/05 (CSS-3) |
| 30 nouveautés `boutique-desktop.css` (subchip + side cart moderne) non bundlées | ✅ Bundle régénéré le 18/05 (CSS-3) |
| 12 règles `.k-hero-*` orphelines dans dist/base.css (ancien design) | ✅ Disparues au rebundle, remplacées par desktop-commerce-skeleton.css |
| 7 règles `#k-side-cart .k-sc-btn-*` orphelines dans dist/desktop.css | ✅ Rapatriées dans boutique-desktop.css source le 18/05 (CSS-2) |
| Pas de hook pre-commit qui vérifie la synchro | ⏳ À ajouter (lot futur) |

---

## 9. Liens vers les docs co-référence

- `docs/BOUTIQUE_ARCHITECTURE.md` — règles générales Boutique (à enrichir avec tableau d'ownership CSS)
- `docs/BOUTIQUE_MODAL_ARCHITECTURE.md` — détail du modal.css (à corriger sur la règle d'exclusivité)
- `docs/BOUTIQUE_COMPONENT_OWNERSHIP.md` — composants JS Boutique
- `AGENTS.md` § 4 — règles Boutique obligatoires

---

## 11. Outillage — les 3 scripts du pipeline

Le pipeline CSS Boutique est accompagné de **3 scripts Node.js** dans `public/boutique/scripts/`. Chacun a un rôle précis et complémentaire.

### 11.1 `bundle-css.js` — Construire le dist

**Rôle** : concaténer les sources dans les 4 bundles dist.

**Commande** :
```bash
cd public/boutique
npm run bundle:css
```

**Quand l'utiliser** :
- Après toute modification d'un fichier source CSS
- Avant tout commit qui touche `public/boutique/css/*.css`
- Avant déploiement prod (vérification finale)

**Sortie** : régénère les 4 fichiers `public/boutique/css/dist/*.css` avec un header daté.

---

### 11.2 `gen-boutique-arch-live.js` — Photographier l'état réel

**Rôle** : produire automatiquement `docs/BOUTIQUE_ARCHITECTURE_LIVE.md`, une photo de l'état RÉEL du code à un instant T.

**Commande** :
```bash
cd public/boutique
npm run boutique:arch
```

**Quand l'utiliser** :
- En début de session de travail (savoir où on en est)
- Après chaque PR mergée (acter l'état)
- Quand on doute de la cohérence sources ↔ dist
- Pour comparer avec `BOUTIQUE_ARCHITECTURE.md` (normatif) et détecter les écarts

**Ce qu'il mesure** :
- Inventaire CSS disque vs bundle (orphelins)
- Ordre de chargement réel dans index.html
- Cartographie des sélecteurs critiques (où ils vivent vraiment)
- Tokens cassés (`var(--x)nnn`)
- Hex hardcodés par fichier
- `!important` par fichier
- Variables CSS posées par JS et leurs owners
- Score architecture global

**Sortie** : `docs/BOUTIQUE_ARCHITECTURE_LIVE.md` (Markdown structuré, jamais édité à la main).

---

### 11.3 `audit-boutique-arch.js` — Garde-fou des invariants

**Rôle** : faire planter le build si un invariant de `BOUTIQUE_ARCHITECTURE.md` § 1 est violé.

**Commande** :
```bash
cd public/boutique
npm run boutique:audit
```

**Quand l'utiliser** :
- Dans le pipeline CI/CD (bloquant)
- Avant tout merge (vérification systématique)
- Pour valider qu'une refacto n'a rien cassé

**Ce qu'il vérifie** :
- **I-1** : aucun CSS orphelin (tout fichier source est bundlé ou supprimé)
- **I-2** : ownership CSS (un sélecteur, un owner — voir tableau ARCHITECTURE.md §3)
- **I-3** : aucun hex en dur hors `tokens.css` (sauf allowlist)
- **I-4** : aucun `var(--token)xxx` (résidu de migration cassée)
- **I-5** : modif desktop sous `@media (min-width: 900px)` uniquement
- **I-6** : variables CSS owned par JS jamais posées par CSS

**Comportement** :
- `exit 0` si tout passe
- `exit 1` si une violation est détectée + rapport détaillé

---

### 11.4 Workflow type d'une PR CSS

L'ordre **strict** d'une PR qui modifie un CSS Boutique :

```bash
# 1. Modifier les fichiers sources
vim public/boutique/css/modal.css

# 2. Régénérer le bundle
cd public/boutique
npm run bundle:css

# 3. Régénérer la photo de l'archi (descriptif)
npm run boutique:arch

# 4. Vérifier les invariants (garde-fou)
npm run boutique:audit
# Si exit 1 : corriger les violations avant de continuer

# 5. Vérifier les diffs
cd ../../
git status public/boutique/css/dist/ public/boutique/docs/

# 6. Commiter sources + dist + docs ensemble
git add public/boutique/css/ public/boutique/docs/
git commit -m "..."
```

**Règle d'or** : sources, dist et `BOUTIQUE_ARCHITECTURE_LIVE.md` doivent être dans **le même commit**. Sinon le repo diverge silencieusement.

---

### 11.5 Hook pre-commit recommandé

Pour automatiser cette discipline, ajouter dans `.husky/pre-commit` (à créer) :

```bash
#!/bin/sh
# Vérifier que le dist CSS est cohérent avec les sources
cd public/boutique
npm run boutique:audit || {
  echo "❌ Audit archi Boutique a échoué — corrigez avant de commiter"
  exit 1
}
```

À programmer en lot CSS-5 (cf. RAPPORT_LOTS_CSS_1-4.md §7).

---

## 12. Évolution de la doc

Si tu ajoutes une source dans `public/boutique/css/`, mets à jour `bundle-css.js` ET cette doc dans la même PR. Sinon les agents suivants ne sauront pas qu'elle existe.
