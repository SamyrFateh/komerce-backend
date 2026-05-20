# Frontend Boutique Komerce

> Point d'entrée pour le frontend Boutique.
> Pour le backend, voir le `README.md` à la racine du repo (si disponible).

---

## 0. 📦 Mode autonome ou repo complet ?

**Lis ce paragraphe en premier — il détermine ton point de départ.**

| Situation | Ce que tu as | Point d'entrée |
|---|---|---|
| Repo complet | Un `AGENTS.md` existe **au-dessus** de ce dossier | Lis `AGENTS.md` racine en premier, puis reviens ici |
| Boutique seule | Tu n'as que ce dossier `boutique/` | **Ce fichier est ton `AGENTS.md`.** Lis la suite dans l'ordre. |

> **Règle simple** : si tu vois un `AGENTS.md` un niveau au-dessus (`../AGENTS.md`) → lis-le avant tout. Sinon → ce README fait foi.

**En mode boutique seule, tout est disponible ici :**

```
boutique/
├── README.md              ← tu es ici — point d'entrée et règles
├── package.json           ← toutes les commandes npm
├── index.html             ← page principale
├── css/                   ← sources CSS (à éditer)
├── css/dist/              ← bundles générés (ne pas toucher)
├── js/                    ← scripts frontend
├── scripts/               ← 7 garde-fous automatisés
└── docs/                  ← toute la documentation boutique
    ├── BOUTIQUE_DOCS_INDEX.md          ← 👈 lire après ce README
    ├── BOUTIQUE_ARCHITECTURE.md        ← normatif — les 6 invariants
    ├── BOUTIQUE_ARCHITECTURE_LIVE.md   ← photo de l'état réel (généré)
    ├── BOUTIQUE_CSS_PIPELINE.md        ← pipeline source → dist
    ├── BOUTIQUE_MODAL_ARCHITECTURE.md  ← détail modal.css (7 sections)
    ├── BOUTIQUE_COMPONENT_OWNERSHIP.md ← qui possède quoi en JS
    ├── BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md
    └── CARTOGRAPHY_360_BOUTIQUE.md     ← cartographie complète
```

**Ordre de lecture obligatoire (mode autonome) :**

| # | Fichier | Pourquoi |
|---|---|---|
| 1 | `docs/BOUTIQUE_DOCS_INDEX.md` | Guide vers la bonne doc selon ta tâche |
| 2 | `docs/BOUTIQUE_ARCHITECTURE.md` | Les 6 invariants — plante si violés |
| 3 | `docs/BOUTIQUE_ARCHITECTURE_LIVE.md` | État réel du code aujourd'hui |

---

## 🤖 PROTOCOLE AGENT — Lecture obligatoire avant toute action

| # | Fichier | Pourquoi |
|---|---|---|
| 1 | [`docs/BOUTIQUE_DOCS_INDEX.md`](docs/BOUTIQUE_DOCS_INDEX.md) | Point d'entrée — guide vers les bonnes docs |
| 2 | [`docs/BOUTIQUE_ARCHITECTURE.md`](docs/BOUTIQUE_ARCHITECTURE.md) | Normatif — 6 invariants I-1 à I-6, ownership CSS, process PR |
| 3 | [`docs/BOUTIQUE_ARCHITECTURE_LIVE.md`](docs/BOUTIQUE_ARCHITECTURE_LIVE.md) | Descriptif — état réel du code (régénéré par `npm run boutique:arch`) |

**Si tu modifies du CSS Boutique**, lis aussi :
- [`docs/BOUTIQUE_CSS_PIPELINE.md`](docs/BOUTIQUE_CSS_PIPELINE.md) — pipeline source → bundle → dist
- [`docs/BOUTIQUE_MODAL_ARCHITECTURE.md`](docs/BOUTIQUE_MODAL_ARCHITECTURE.md) si tu touches `modal.css` (1736 lignes, 7 sections)

---

## 🚨 Les 6 invariants Boutique (le build casse si violés)

Détail dans `docs/BOUTIQUE_ARCHITECTURE.md` §1. Validés automatiquement par `npm run audit:arch`.

| ID | Invariant |
|---|---|
| I-1 | Aucun CSS orphelin (tout fichier source est bundlé ou supprimé) |
| I-2 | Un sélecteur, un owner (sauf multi-owners légitimes documentés §3) |
| I-3 | Aucun hex en dur hors `tokens.css` (sauf allowlist explicite) |
| I-4 | Aucun pattern `var(--token)xxx` (résidu de migration cassée) |
| I-5 | Toute modif desktop sous `@media (min-width: 900px)` |
| I-6 | Variables CSS owned par JS jamais posées par CSS (`--pager-top`, `--bnav-h`, etc.) |

---

## 🛠️ Les 7 scripts disponibles

Tous lancés depuis `boutique/` (`cd boutique && npm run ...`). Aucune config externe requise.

| Commande | Rôle |
|---|---|
| `npm run bundle:css` | Compile les 13 sources CSS → 4 bundles dans `css/dist/` |
| `npm run audit:arch` | Vérifie les 6 invariants — exit 1 si violation |
| `npm run audit:arch:live` | Génère `docs/BOUTIQUE_ARCHITECTURE_LIVE.md` (photo état réel) |
| `npm run check:html` | Équilibrage balises + IDs critiques dans `index.html` |
| `npm run check:imports` | Imports JS : existence, cycles, dead exports |
| `npm run check:body-classes` | Chaque `classList.add` body a son `remove` |
| `npm run check:cache` | `?v=N` dans `index.html` synchro avec les bundles CSS |
| `npm run check:all` | Enchaîne les 4 garde-fous — à lancer avant tout commit |

---

## ⚙️ Workflow type d'une PR CSS Boutique

```bash
cd boutique

# 1. Modifier les sources
vim css/modal.css

# 2. Rebundler (obligatoire — sinon dist ≠ sources)
npm run bundle:css

# 3. Régénérer la photo descriptive
npm run audit:arch:live

# 4. Valider les invariants
npm run audit:arch
# Si exit 1 : corriger avant de continuer

# 5. Commit unique sources + dist + docs LIVE
# Mode repo complet :
git add boutique/css/ boutique/docs/
# Mode autonome :
git add css/ docs/
git commit -m "..."
```

**Règle d'or** : sources, dist et `BOUTIQUE_ARCHITECTURE_LIVE.md` doivent être dans **le même commit**. Sinon le repo diverge silencieusement (cas résolu en lot CSS-3 le 18/05/2026).

---

## 📂 Structure complète

```
boutique/
├── index.html              # page principale (charge les 4 bundles dist)
├── package.json            # tous les scripts npm
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
│   └── dist/               # généré — chargé en prod, ne pas éditer
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
│   ├── audit-boutique-arch.js       # garde-fou invariants
│   ├── check-html-balance.js        # garde-fou HTML
│   ├── check-js-imports.js          # garde-fou imports JS
│   ├── check-body-classes.js        # garde-fou classes body
│   └── check-cache-buster.js        # garde-fou cache CSS
│
└── docs/
    ├── BOUTIQUE_DOCS_INDEX.md              # 👈 guide d'orientation
    ├── BOUTIQUE_ARCHITECTURE.md            # normatif — règles et invariants
    ├── BOUTIQUE_ARCHITECTURE_LIVE.md       # descriptif — état réel (généré)
    ├── BOUTIQUE_CSS_PIPELINE.md            # pipeline source → bundle → dist
    ├── BOUTIQUE_MODAL_ARCHITECTURE.md      # détail modal.css (7 sections)
    ├── BOUTIQUE_COMPONENT_OWNERSHIP.md     # ownership JS par composant
    ├── BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md # contrat produit
    └── CARTOGRAPHY_360_BOUTIQUE.md         # cartographie complète boutique
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
| `audit:arch` plante | Lis le rapport, corrige avant de continuer |
| Modal produit, tu ne sais pas quelle section toucher | Lis `docs/BOUTIQUE_MODAL_ARCHITECTURE.md` §9 |
| Tu trouves un sélecteur dans 2 fichiers | Vérifier `docs/BOUTIQUE_ARCHITECTURE.md` §3 — exceptions multi-owner documentées |
| Tu veux ajouter un nouveau CSS source | 1. Ajouter dans `scripts/bundle-css.js`, 2. Mettre à jour `docs/BOUTIQUE_ARCHITECTURE.md` §2, 3. `npm run bundle:css` |
| Conflit entre deux docs | `docs/BOUTIQUE_ARCHITECTURE.md` gagne toujours sur les autres |

---

*Pour la doc backend, voir le `README.md` à la racine du repo (mode repo complet uniquement).*
