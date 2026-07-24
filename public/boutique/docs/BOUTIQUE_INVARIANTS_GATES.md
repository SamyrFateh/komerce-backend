# Boutique — invariants & garde-fous (point zéro)

> État de référence « propre » figé le 20 juin 2026. Chaque invariant ci-dessous
> est désormais **exécutoire** (un script le bloque), plus seulement documentaire.
> La règle d'or : on ne dérive plus en silence. Tout assouplissement passe par un
> `--save` conscient (cliquet) ou une annotation `// css-injection-allow:` datée.

## Portes câblées

Tout tourne dans `check:fast` (statique, pre-commit) et `check:all` (= `check:fast` + e2e, CI).

| Invariant | Porte | Type | Référence |
|---|---|---|---|
| Pas de CSS injecté par JS (`createElement('style')`, règles CSS dans `innerHTML`/`textContent`/`cssText`) | `check:no-injection` | bloquant | doctrine §1 |
| Layout imposé inline par JS (`.style.top/transform`, `setProperty('--pager/--hero')`) | `check:no-injection` | **averti** (annotation `// css-injection-allow:` pour tolérer) | doctrine §1 |
| `!important` ne prolifère pas hors guards desktop | `check:important` | cliquet | `.important-baseline.json` |
| La prod ne charge que `css/dist/*` | `check:css-dist-only` | bloquant | — |
| dist reflète les sources / jamais édité à la main | `check:cache` (`deploy-css --dry`) | bloquant | `.cache-buster-state.json` |
| Pas de breakpoint hors baseline | `check:breakpoints` | cliquet | `.breakpoints-baseline.json` |
| Hex hors `tokens.css` interdit | `audit:arch` (I-3) | bloquant + allowlist | `HEX_ALLOWLIST` |
| Ownership CSS (qui possède quel sélecteur) | `audit:arch` (I-2) | bloquant | `OWNERSHIP` |
| Pas de CSS orphelin / cohérence bundle | `audit:arch` (I-1 + BUNDLE) | bloquant | `EXPECTED_BUNDLES` ↔ `deploy-css.js` |
| Un composant = un owner | `audit:ownership` | génère la carte live | `BOUTIQUE_OWNERSHIP_LIVE.md` |
| Fichier JS source = header `@komerce-arch` cartographié | `arch:check` (graphe backend, `SCAN_ROOTS` ⊃ `public/boutique/js`) | bloquant (hook backend) | graphe header |
| HTML équilibré + IDs critiques | `check:html` | bloquant | — |
| Imports JS valides / pas de cycles | `check:imports` | bloquant | — |
| Classes body cohérentes | `check:body-classes` | bloquant | — |
| Wording groupe | `check:group-wording` | bloquant | — |
| `var(--x)` orpheline (jamais définie en CSS, jamais posée en JS) | `check:css-vars` | bloquant (`--strict`) + allowlist | `governance/css-vars-manifest.json` |
| z-index réel des couches overlay/modal/panier/toast dans les bornes attendues + ordre pairwise | `check:zindex` | bloquant (`--strict`) | `governance/zindex-contract.json` |
| `animation:` sans `@keyframes` correspondante | `check:keyframes` | bloquant | — |

## Câblage git

`scripts/setup-hooks.sh` (racine repo) installe le `pre-commit` qui :
1. régénère le graphe d'archi + réconcilie le budget (backend) ;
2. **régénère automatiquement les bundles CSS** (`deploy-css.js`) puis re-stage `css/dist`, `index.html`, `.cache-buster-state.json` — plus de `npm run deploy:css` manuel ;
3. lance les portes backend (headers/DB/drift/sanitize) ;
4. lance `check:fast` côté boutique.

Le `pre-push` lance `impact-check.js` (risque sécurité du diff). La CI rejoue `check:all`.

## Faire bouger un cliquet (acte conscient)

```bash
# guard desktop !important légitimement ajouté/retiré :
npm run check:important:save
# breakpoint légitimement ajouté/retiré :
npm run check:breakpoints:save
```

Un `--save` doit être un choix daté et justifié en message de commit, jamais un réflexe pour « passer au vert ».

## Dette résiduelle connue (sous cliquet, donc non croissante)

- `!important` hors `boutique-desktop.css` : **6** (4 `hero.css`, 2 `share-cart.css`). Réductibles à la pièce ; le cliquet empêche toute hausse.
- 7 `var(--x, fallback)` jamais branchées (`--cta`, `--cta-green-dark`, `--green-bg-10`, `--green-border-22`, `--leaf-border`, `--surface`, `--coral-rgb`) : sans impact visuel (le fallback s'applique toujours), documentées dans `governance/css-vars-manifest.json` pour ne pas refaire le triage à froid. `--cta-green-dark` en particulier suggère un état hover jamais différencié — candidat produit, pas gate.

## Porte pas encore câblée (à dessein)

`check-dom-contract.js` (`getElementById`/classes JS ↔ existence réelle HTML/CSS, `governance/dom-contract.json`) existe et est exécutable (`npm run check:dom-contract`), mais n'est **pas** dans `check:fast`/`check:all` : `#k-modal-fav-btn` (bouton favori dans la modale produit, `js/b-modal-core.js:256,585`) n'a jamais de markup HTML correspondant — feature incomplète, pas du code mort documenté comme les autres cas. À trancher (construire le bouton ou assumer/retirer le JS) avant de câbler ce gate en bloquant.
