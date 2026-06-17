# Frontend Boutique Komerce

> ### ⛔ Un hook te bloque au `commit` / `push` ? Lis ceci AVANT tout.
> **Avant de committer**, lance la porte en local — ça évite l'écrasante majorité des blocages :
> ```bash
> npm run arch:gate && npm run arch:doctrine
> ```
> **Si un hook te bloque quand même : ne bypasse pas par réflexe.** Le runbook donne, pour chaque
> message d'erreur, le diagnostic et la résolution exacte :
> → [`doc/RUNBOOK_DEBLOCAGE_HOOKS.md`](./doc/RUNBOOK_DEBLOCAGE_HOOKS.md) (copie racine : `../../RUNBOOK_DEBLOCAGE_HOOKS.md`)
>
> `--no-verify` est une soupape d'urgence (faux positif confirmé ou urgence prod), pas une habitude —
> la CI rejoue les mêmes portes de toute façon.

> Point d'entrée local pour le frontend Boutique.  
> En repo complet, lire d'abord `../../AGENTS.md`, `../../docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`, puis revenir ici.

---

## 0. Doctrine graphe obligatoire

Toute modification fonctionnelle Boutique est soumise à :

```txt
../../docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md
```

Règle locale :

- aucun nouveau fichier `js/**`, `css/**`, renderer, controller, helper, API client ou state module ne doit être créé sans header ou owner cartographié ;
- un fichier autonome reçoit `@komerce-arch` ;
- un fichier support reçoit `@komerce-arch-lite` avec `@owner` explicite ;
- tout changement de contrat met à jour `@inputs`, `@outputs`, `@depends`, `@used-by`, `@doctrine`, `@impact-areas` ;
- tout changement d'appel API ou de flux impactant le backend doit être visible dans le graphe ;
- après changement structurel, régénérer depuis la racine : `node scripts/generate-komerce-arch-graph.js`.

Un changement Boutique sans cartographie à jour est incomplet.

---

## 1. Où vit la Boutique ?

Le frontend Boutique vit dans :

```txt
public/boutique/
```

Structure active :

```txt
public/boutique/
├── README.md              ← point d'entrée local
├── package.json           ← scripts npm Boutique
├── index.html             ← page principale, charge uniquement css/dist/*.css
├── css/                   ← sources CSS à éditer
├── css/dist/              ← bundles générés, ne jamais éditer à la main
├── js/                    ← scripts frontend
├── scripts/               ← garde-fous et bundler CSS
└── docs/                  ← docs locales / historiques / générées
```

Docs canoniques repo pour la Boutique :

```txt
docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md
docs/boutique/BOUTIQUE_CSS_PIPELINE.md
docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md
docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
```

Les docs sous `public/boutique/docs/` restent utiles en contexte local, mais elles sont subordonnées à `docs/boutique/*` si elles contredisent le code actuel.

---

## 2. Lecture obligatoire avant modification

| Situation | Lire |
|---|---|
| Repo complet | `../../AGENTS.md`, `../../docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`, puis ce README |
| Modification JS fonctionnelle | Header du fichier + `../../docs/komerce-arch-header-graph.json` |
| Nouveau fichier Boutique | `../../docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md` avant création |
| Modification CSS | `../../docs/boutique/BOUTIQUE_CSS_PIPELINE.md` |
| Modification ownership composant | `../../docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` |
| Modification modal | `../../docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md` |
| Besoin d'un contexte local historique | `docs/BOUTIQUE_DOCS_INDEX.md` |

---

## 3. Invariants Boutique actifs

- Le JS gère le comportement, les classes d'état et les appels API.
- Le CSS gère l'apparence, le layout et le responsive.
- Aucun CSS structurel durable ne doit être injecté par JS.
- Les sources CSS vivent dans `css/*.css`.
- La prod charge uniquement `css/dist/*.css`.
- Toute modification CSS source doit être suivie de `npm run deploy:css` ou `npm run bundle:css`.
- Les fichiers `css/dist/*.css` ne se modifient jamais à la main.
- Un composant = un owner documenté.
- Un fichier source Boutique = un header complet ou un owner lite dans le graphe.
- Les seules règles `!important` actives acceptées au 3 juin 2026 sont les guards desktop du drawer mobile dans `boutique-desktop.css`.

---

## 4. Scripts disponibles

Tous les scripts se lancent depuis `public/boutique`.

| Commande | Rôle |
|---|---|
| `npm run deploy:css` | Bundler officiel : sources CSS → dist + cache-buster |
| `npm run bundle:css` | Alias de compatibilité vers `deploy-css.js` |
| `npm run check:cache` | Dry-run du bundler/cache-buster |
| `npm run check:html` | Vérifie l'équilibre HTML et les IDs critiques |
| `npm run check:imports` | Vérifie imports JS, existence, cycles, dead exports |
| `npm run check:body-classes` | Vérifie les classes body ajoutées/retirées |
| `npm run check:breakpoints` | Garde-fou breakpoints |
| `npm run audit:arch` | Audit architecture Boutique |
| `npm run audit:arch:live` | Génère la photo d'architecture réelle |
| `npm run audit:ownership` | Génère la carte d'ownership live |
| `npm run check:all` | Chaîne complète de garde-fous + e2e |

---

## 5. Pipeline CSS actuel

Source de vérité :

```txt
scripts/deploy-css.js
```

Bundles chargés par `index.html` :

```txt
css/dist/base.css
css/dist/components.css
css/dist/desktop.css
css/dist/event.css
```

Composition actuelle résumée :

```txt
base.css       ← tokens + reset + layout + hero
components.css ← categories + products + modal-shell + modal-media + modal-product + modal-product-lot4-hybrid + cart + interactions + hero-cart-proxy + group-cart-flow + shared-followup + identity
desktop.css    ← boutique-desktop
event.css      ← tokens + event
```

`modal-product-lot4-hybrid.css` est une extension officielle de `modal-product.css`, chargée immédiatement après lui. Elle contient la PDP hybride desktop rapatriée depuis `b-modal-approche-c-hybrid.js`.

---

## 6. Workflow PR CSS Boutique

```bash
cd public/boutique

# 1. Modifier uniquement les sources CSS
# exemple : css/cart.css, css/modal-product.css, css/boutique-desktop.css

# 2. Rebuilder les bundles et bumper les ?v= nécessaires
npm run deploy:css

# 3. Vérifier
npm run check:cache
npm run audit:arch

# 4. Commit depuis la racine repo
cd ../..
git add public/boutique/css/ public/boutique/index.html public/boutique/.cache-buster-state.json
git commit -m "style(boutique): ..."
```

Pour une PR Boutique non-CSS, lancer au minimum les garde-fous applicables (`check:html`, `check:imports`, `check:body-classes`, `audit:arch`) et vérifier la doctrine graphe si le comportement change.

---

## 7. Fichiers verrouillés — review obligatoire

Modifier ces fichiers sans review explicite est interdit. Ils portent la mécanique mobile/scroll :

- `js/b-pager.js` — moteur cage mobile + ghost loop
- `js/b-store.js` — refs DOM partagées, `initDom()`
- `js/b-scroll-owner.js` — détection mobile/desktop, scroll owner
- script inline `<body>` dans `index.html` — proxy `window.scrollY`

---

## 8. En cas de doute

| Situation | Action |
|---|---|
| Tu modifies du CSS sans savoir le bon owner | Lire `../../docs/boutique/BOUTIQUE_CSS_PIPELINE.md` |
| Tu touches le DOM / rendu composant | Lire `../../docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` |
| Tu touches la modal | Lire `../../docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md` |
| Tu crées un fichier JS/CSS | Lire `../../docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md` et ajouter header/owner |
| `audit:arch` plante | Lire le rapport, corriger avant commit |
| Tu veux ajouter un nouveau CSS source | Ajouter dans `scripts/deploy-css.js`, documenter dans `docs/boutique/BOUTIQUE_CSS_PIPELINE.md`, puis `npm run deploy:css` |
| Conflit entre docs | `docs/boutique/*` gagne sur `public/boutique/docs/*` sauf décision contraire explicite |

---

*Ce README est aligné sur l'état du repo au 16 juin 2026 après mise en place de la doctrine graphe obligatoire.*