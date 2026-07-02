# Corrections appliquées — Header & Greeting mobile — 2026-07-01

> Basé sur retour visuel mobile (screenshot production).

---

## ✅ FIX-GREET-1 — Greeting chip positionné sur la barre de recherche

**Fichier** : `css/interactions.css` (section `#k-greeting-chip`)

**Problème** : le chip "Karibu {prénom} 😊" était en `position: fixed; top: calc(env(safe-area-inset-top) + 10px)`. Sur mobile, cela le plaçait directement sur le header, chevauchant la barre de recherche et le rendant visuellement parasite.

**Correction** :
- `top` recalculé : `calc(env(safe-area-inset-top, 0px) + var(--header-h, 44px) + 8px)` — le chip se place juste sous le header.
- Animation d'entrée changée : slide vertical (`translateY(-6px)`) → **slide horizontal depuis la droite** (`translateX(40px)`) avec easing spring `cubic-bezier(.22,1,.36,1)`.
- Animation de sortie harmonisée : glisse vers la droite au lieu de remonter.
- Durée d'affichage inchangée (4 s).

**Gouvernance** : `interactions.css` est le propriétaire déclaré des micro-interactions (bundle `components`). Contrat ajouté dans `BOUTIQUE_COMPONENT_OWNERSHIP.md`.

---

## ✅ FIX-HEADER-1 — Logo coupé par la barre de statut du téléphone

**Fichiers** : `css/layout.css` (`.k-header`) + `index.html` (`#k-header-spacer`)

**Problème** : le `.k-header` était en `position: fixed; top: 0` avec `height: var(--header-h)` et `padding: 0 var(--pad-x)`. Sur les téléphones avec encoche ou barre de statut, le contenu du header (logo K + "KOMERCE") passait derrière la zone système, le rendant invisible ou tronqué.

**Correction** :
- Header : ajout de `padding-top: env(safe-area-inset-top, 0px)` et hauteur étendue à `calc(var(--header-h) + env(safe-area-inset-top, 0px))`.
- Spacer `#k-header-spacer` : hauteur mise à jour identiquement pour compenser le flow.
- `viewport-fit=cover` déjà présent dans la meta viewport (pas de changement nécessaire).

**Gouvernance** : `layout.css` est le propriétaire déclaré de la structure header mobile. Entrée ajoutée dans `BOUTIQUE_COMPONENT_OWNERSHIP.md`.

---

## Impact

| Fichier modifié | Bundle | Risque |
|---|---|---|
| `css/interactions.css` | `components` | Faible — changement isolé au `#k-greeting-chip`, aucun autre sélecteur touché |
| `css/layout.css` | `base` | Moyen — `.k-header` height/padding impacte tout ce qui dépend de `--header-h`. Les refs JS (`b-store.js`, `b-catalog-desktop-enhancers.js`) utilisent `getBoundingClientRect()` ou `--header-h` (valeur CSS inchangée). Sur desktop, `env(safe-area-inset-top)` vaut `0px`, donc neutre. |
| `index.html` | — | Faible — seul le spacer inline est modifié |

## Tests recommandés

- [ ] Mobile avec encoche (iOS Safari, Android Chrome) : vérifier que le logo K est entièrement visible sous la barre de statut
- [ ] Mobile sans encoche : vérifier qu'aucun espace supplémentaire n'apparaît (env() retourne 0px)
- [ ] Greeting chip : vérifier qu'il apparaît sous le header, slide depuis la droite, disparaît après 4 s
- [ ] Desktop : vérifier que le header n'a pas changé visuellement (env(safe-area-inset-top) = 0px)

---

## ✅ GOV-1 — Contrats cross-feature tous vides (11/11 features)

**Fichiers** : tous les `features/*.feature.js`

**Problème** : les 11 manifestes feature avaient `exposes: []` et `consumes: []`, alors que le scan d'imports révèle un graphe de dépendances dense (boutique consomme 7 features, checkout consomme 4, etc.). Aucune dépendance inter-feature n'était déclarée — violation du niveau 0 de la pyramide qualité.

**Correction** : remplissage exhaustif basé sur le scan statique des imports cross-domain et des appels API.

| Feature | exposes | consumes |
|---|---|---|
| auth | 2 | 1 (boutique) |
| boutique | 7 | 7 (auth, catalog, checkout, modal-product, shared-cart, tracking, wallet) |
| catalog | 7 | 1 (boutique) |
| checkout | 1 | 4 (auth, boutique, payment, wallet) |
| collective-workspace | 3 | 3 (API endpoints) |
| modal-product | 2 | 2 (boutique) |
| payment | 1 | 2 (boutique, API) |
| recommendations | 2 | 1 (boutique) |
| shared-cart | 4 | 3 (auth, boutique, checkout) |
| tracking | 1 | 2 (auth, boutique) |
| wallet | 1 | 2 (auth, boutique) |

**Gouvernance** : `b-greeting.js` et header structure ajoutés dans `BOUTIQUE_COMPONENT_OWNERSHIP.md` (table + contrat).
