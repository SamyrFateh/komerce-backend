# Frontend Boutique Komerce

> Point d'entrée pour le frontend Boutique.
> Pour le backend, voir le `README.md` à la racine du repo.

---

## 🤖 PROTOCOLE AGENT — Lecture obligatoire avant toute action sur la Boutique

| # | Fichier | Pourquoi |
|---|---|---|
| 1 | [`docs/BOUTIQUE_DOCS_INDEX.md`](./docs/BOUTIQUE_DOCS_INDEX.md) | Point d'entrée — guide vers les bonnes docs |
| 2 | [`docs/BOUTIQUE_ARCHITECTURE.md`](./docs/BOUTIQUE_ARCHITECTURE.md) | Normatif — 6 invariants I-1 à I-6, ownership CSS, process PR |
| 3 | [`docs/BOUTIQUE_ARCHITECTURE_LIVE.md`](./docs/BOUTIQUE_ARCHITECTURE_LIVE.md) | Descriptif — état réel du code (régénéré par `npm run boutique:arch`) |

**Si tu modifies du CSS Boutique**, lis aussi :
- [`docs/BOUTIQUE_CSS_PIPELINE.md`](./docs/BOUTIQUE_CSS_PIPELINE.md) — pipeline source → bundle → dist
- [`docs/BOUTIQUE_MODAL_ARCHITECTURE.md`](./docs/BOUTIQUE_MODAL_ARCHITECTURE.md) si tu touches `modal.css` (1736 lignes, 7 sections)

---

## 🚨 Les 6 invariants Boutique (le build casse si violés)

Détail dans `docs/BOUTIQUE_ARCHITECTURE.md` §1. Validés automatiquement par `npm run boutique:audit`.

| ID | Invariant |
|---|---|
| I-1 | Aucun CSS orphelin (tout fichier source est bundlé ou supprimé) |
| I-2 | Un sélecteur, un owner (sauf multi-owners légitimes documentés §3) |
| I-3 | Aucun hex en dur hors `tokens.css` (sauf allowlist explicite) |
| I-4 | Aucun pattern `var(--token)xxx` (résidu de migration cassée) |
| I-5 | Toute modif desktop sous `@media (min-width: 900px)` |
| I-6 | Variables CSS owned par JS jamais posées par CSS (`--pager-top`, `--bnav-h`, etc.) |

---

## 🛠️ Les 3 scripts du pipeline

| Script | Commande | Quand l'utiliser |
|---|---|---|
| `bundle-css.js` | `npm run bundle:css` | Après toute modif d'un CSS source — sinon rien n'est en prod |
| `gen-boutique-arch-live.js` | `npm run boutique:arch` | En début de session + après chaque PR — photo de l'état réel |
| `audit-boutique-arch.js` | `npm run boutique:audit` | Avant tout commit — plante (exit 1) si violations |

---

## ⚙️ Workflow type d'une PR CSS Boutique

```bash
cd public/boutique

# 1. Modifier les sources
vim css/modal.css

# 2. Rebundler (obligatoire)
npm run bundle:css

# 3. Régénérer la photo descriptive
npm run boutique:arch

# 4. Valider les invariants
npm run boutique:audit
# Si exit 1 : corriger avant de continuer

# 5. Commit unique sources + dist + docs LIVE
cd ../..
git add public/boutique/css/ public/boutique/docs/
git commit -m "..."
```

**Règle d'or** : sources, dist et `BOUTIQUE_ARCHITECTURE_LIVE.md` doivent être dans **le même commit**. Sinon le repo diverge silencieusement (cas résolu en lot CSS-3 le 18/05/2026).

---

## 📂 Structure du frontend Boutique

```
public/boutique/
├── index.html              # page principale (charge les 4 bundles dist)
├── package.json            # scripts : bundle:css, boutique:arch, boutique:audit
│
├── css/
│   ├── tokens.css          # variables CSS (source unique couleurs/spacing)
│   ├── reset.css           # reset minimal
│   ├── layout.css          # squelette page
│   ├── hero.css            # hero mobile (base)
│   ├── categories.css      # chips catégories mobile
│   ├── products.css        # cartes produit, grille
│   ├── modal.css           # modal produit (1736L — voir BOUTIQUE_MODAL_ARCHITECTURE.md)
│   ├── cart.css            # panier flottant, side cart base
│   ├── interactions.css    # animations, micro-interactions
│   ├── hero-cart-proxy.css # proxy hero ↔ cart mobile
│   ├── boutique-desktop.css         # tous les overrides desktop ≥ 900px
│   ├── desktop-commerce-skeleton.css # squelette commerce desktop
│   ├── event.css           # styling pages event/collectif
│   └── dist/               # généré — chargé en prod
│       ├── base.css
│       ├── components.css
│       ├── desktop.css
│       └── event.css
│
├── js/
│   ├── boutique.js         # orchestrateur principal
│   ├── b-modal.js          # modal produit
│   ├── b-modal-desktop-enhancers.js
│   ├── b-pager.js          # 🔒 FICHIER VERROUILLÉ — moteur cage mobile
│   ├── b-store.js          # 🔒 FICHIER VERROUILLÉ — refs DOM partagées
│   ├── b-scroll-owner.js   # 🔒 FICHIER VERROUILLÉ — détection mobile/desktop
│   └── ... (~30 fichiers)
│
├── scripts/
│   ├── bundle-css.js                # bundler CSS
│   ├── gen-boutique-arch-live.js    # générateur de doc descriptive
│   └── audit-boutique-arch.js       # garde-fou exécutable
│
└── docs/
    ├── BOUTIQUE_DOCS_INDEX.md         # 👈 point d'entrée
    ├── BOUTIQUE_ARCHITECTURE.md       # normatif
    ├── BOUTIQUE_ARCHITECTURE_LIVE.md  # généré
    ├── BOUTIQUE_CSS_PIPELINE.md       # détail pipeline
    ├── BOUTIQUE_MODAL_ARCHITECTURE.md # détail modal.css
    ├── BOUTIQUE_COMPONENT_OWNERSHIP.md # ownership JS
    └── BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md # contrat produit
```

---

## 🚫 Fichiers verrouillés — review obligatoire

Modifier ces fichiers sans review explicite est interdit. Ils portent la mécanique qui fait que le mobile marche. Si tu dois toucher, ouvre une PR isolée avec un seul de ces fichiers en diff.

- `js/b-pager.js` — moteur cage mobile + ghost loop
- `js/b-store.js` — refs DOM partagées, `initDom()`
- `js/b-scroll-owner.js` — détection mobile/desktop, scroll owner
- Script inline `<body>` dans `index.html` (lignes ~480-550) — proxy `window.scrollY`

Voir `docs/BOUTIQUE_ARCHITECTURE.md` §6.

---

## 🆘 En cas de doute

| Situation | Action |
|---|---|
| Tu modifies du CSS sans savoir le bon owner | Lis `docs/BOUTIQUE_ARCHITECTURE.md` §3 (table d'ownership) |
| `boutique:audit` plante | Lis le rapport, corrige avant de continuer — `npm run boutique:audit -v` pour le détail |
| Modal produit, tu ne sais pas quelle section toucher | Lis `docs/BOUTIQUE_MODAL_ARCHITECTURE.md` §9 (« Quand toucher quelle section ») |
| Tu trouves un sélecteur dans 2 fichiers et ne sais pas si c'est OK | Vérifier `docs/BOUTIQUE_ARCHITECTURE.md` §3 — certaines exceptions multi-owner sont légitimes |
| Tu veux ajouter un nouveau CSS source | 1. Ajouter dans `scripts/bundle-css.js`, 2. Mettre à jour `docs/BOUTIQUE_ARCHITECTURE.md` §2, 3. `npm run bundle:css` |

---

*Pour la doc backend, voir le `README.md` à la racine du repo.*
