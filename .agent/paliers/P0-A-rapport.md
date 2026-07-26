# P0-A — Verrouiller les 5 correctifs de l'audit par des tests du dépôt

**Statut : clos.** 5/5 correctifs couverts, chaque test échoue si l'on annule le correctif (preuve d'injection dans les deux sens, exécutée en réel).

**Environnement d'exécution.** Sandbox avec Chromium préinstallé (`/opt/pw-browsers`, révision 1194) — `@playwright/test` pinné à `1.56.0` pour matcher cette révision (`^1.44.0` déclaré résolvait par défaut en `1.61.1`, qui exige la révision 1228, absente ici et non téléchargeable — réseau restreint). **À vérifier côté CI/poste habituel** : soit la révision installée y correspond déjà, soit repasser `@playwright/test` à une version dont `browsers.json` déclare la révision réellement présente.

---

## 1. Mesure avant

### Découverte préalable — le harnais lui-même était partiellement cassé

`node harnais/geometry/measure-hero.js` et `node harnais/geometry/verify-backtop-zindex.js` :
```
Error: ENOENT: no such file or directory, open
  '/…/public/boutique/harnais/public/boutique/index.html'
    at Object.readFileSync (node:fs:440:20)
    at between (harnais/geometry/extract.js:5:16)
```
Cause : `extract.js` (et `ROOT` dans `measure-hero.js`, `triage-conflicts.js`, `verify-sticky.js`) résolvait les chemins comme si `harnais/` vivait à la racine du dépôt, alors qu'il est niché sous `public/boutique/harnais/geometry/` (3 niveaux sous `public/`, 2 sous `public/boutique/`).

Effet de bord plus grave, sur `verify-sticky.js` : le mauvais `ROOT` faisait 404 sur toutes les feuilles de style (`/boutique/css/dist/*.css`), donc la page de repro tournait **sans CSS chargée**. Résultat mesuré avant correction :
```
align-self=auto  margin-top=0px  margin-left=0px  largeur=1424px
amplitude de scroll disponible : 0px
tops @[0,100,200,300,400] = [0, 0, 0, 0, 0]
✅ OK  (5 seuils épinglés à 0)
```
Un vert **trivial** (rien n'est mis en page, donc rien ne peut bouger) — même défaillance que celle déjà nommée dans la note de passation (« le vert par absence »), mais côté instrumentation plutôt que côté scan de fichiers.

### État des 5 mesures avant tout correctif de câblage

| # | Correctif | État avant |
|---|---|---|
| 1 | Hero sticky modale desktop | Spec `modal-geometry.spec.js:96` existant, mais **flaky** (voir §2) |
| 2 | Grille vide après recherche | Aucun test du dépôt ne couvrait `_resetSearchFilter()` |
| 3 | Plafond du hero de repli | Harnais cassé (ENOENT), aucun test du dépôt |
| 4 | Bouton retour en haut | Harnais cassé (ENOENT), aucun test du dépôt |
| 5 | css-guard / ligne compacte | Correctif présent dans le parser, aucun test de détection |

---

## 2. Hypothèse

- **extract.js / ROOT** : chemins relatifs faux, distinguable par un simple `ENOENT` reproductible à chaque run — pas une hypothèse à départager, une erreur de calcul de chemin.
- **Correctif #1 (hero sticky)** : le spec existant échouait par intermittence contre le vrai rendu (`distinctTops.size` passant de 2 à 4 selon les runs) alors que le harnais isolé passait toujours. Hypothèse retenue : `.k-modal-scroll { scroll-behavior: smooth }` (présent en CSS, `modal-shell.css:1048`) fait que `scrollTop = y` déclenche une animation ; le `waitForTimeout(120)` fixe du spec capture parfois une frame intermédiaire. Mesure qui distingue cette hypothèse d'un vrai bug de sticky : neutraliser `scrollBehavior` (comme le fait déjà `verify-sticky.js`) et rejouer plusieurs fois — si l'instabilité disparaît, c'est la mesure qui était en cause, pas le produit.

## 3. Modification

Fichiers touchés :

- `public/boutique/harnais/geometry/extract.js` — chemin `IDX` corrigé (`../../index.html` au lieu de `../public/boutique/index.html`).
- `public/boutique/harnais/geometry/measure-hero.js`, `triage-conflicts.js`, `verify-sticky.js` — `ROOT` corrigé (`../../../` au lieu de `../public`).
- `public/boutique/tests/e2e/modal-geometry.spec.js` — neutralisation de `scroll-behavior` avant la mesure de sticky (correctif #1).
- `public/boutique/tests/unit/b-catalog.test.js` — 3 nouveaux cas (`test.each([1,2,3])`) verrouillant `_resetSearchFilter()` (correctif #2).
- `public/boutique/tests/e2e/hero-geometry.spec.js` — **nouveau spec**, plafond du hero de repli sur 900/1280/1440/1920px (correctif #3).
- `public/boutique/tests/e2e/modal-backtop-zindex.spec.js` — **nouveau spec**, atteignabilité du bouton retour-en-haut (correctif #4).
- `public/boutique/tests/unit/css-guard-compact-line.test.js` — **nouveau test**, détection de conflit sur ligne compacte (correctif #5).
- `public/boutique/playwright.config.js` — les 2 nouveaux specs ajoutés au projet `Chromium Local-Only`, exclus des 5 projets navigateur standards (même raison que `modal-geometry`/`mdm9` : éviter la multiplication ×5, fixtures déterministes).

Aucun fichier de comportement produit n'a été modifié de façon durable — les mutations CSS/JS décrites en §5 (test de détection) ont toutes été injectées puis restaurées dans la même session.

## 4. Mesure après

```
JEST (unit)
PASS tests/unit/css-guard-compact-line.test.js
PASS tests/unit/b-catalog.test.js
Test Suites: 2 passed, 2 total
Tests:       17 passed, 17 total

PLAYWRIGHT (Chromium Local-Only)
✓ hero-geometry.spec.js × 4 (900/1280/1440/1920px)
✓ modal-backtop-zindex.spec.js × 1
✓ modal-geometry.spec.js × 6
11 passed (25.1s)
```

Harnais (mesure brute, post-correction du chemin) :
```
verify-sticky.js      → 4/4 cas ✅ (align-self=start réel, ≥4 seuils/5 épinglés à 0)
measure-hero.js       → repli : 240/240/240/240px sur 900/1280/1440/1920 (≤240 ✅)
verify-backtop-zindex → z-index=420, cliquable=true
```

## 5. Test de détection — preuve dans les deux sens, pour chacun des 5 correctifs

| # | Violation injectée | Résultat | Restauré |
|---|---|---|---|
| 1 | `align-self:start` → `center` (modal-media.css:327) | `distinctTops.size` 2→4, échec | ✅ revert, 5/5 runs verts |
| 2 | Commenté l'appel `_resetSearchFilter()` (b-catalog.js:806) | `state.filtered` reste à `hitCount` au lieu du catalogue complet, 3 tests échouent | ✅ revert, 15/15 verts |
| 3 | `max-height:240px` → `400px` (hero.css:340) | 4/4 largeurs échouent | ✅ revert, 4/4 verts |
| 4 | `z-index:420` → `1` (modal-shell.css:1061) | bouton recouvert, `cliquable=false`, échec | ✅ revert, vert |
| 5 | Ligne `addDecls(...)` du cas compact commentée (css-guard.js:181) | sélecteur de test absent du rapport, échec | ✅ revert, 2/2 verts |

Chaque échec pointe la violation injectée (message ou assertion), jamais une cause générique — conforme à l'exigence R2/gabarit `check-sticky-integrity.js`.

## 6. Dette consignée (R7 — vu, pas traité)

- **`repro-search-grid.js`** duplique encore `_balancedPick`/`_normalizeCat` en copie figée (commentaire du fichier l'assume). Le nouveau test unitaire (§ correctif #2) teste le vrai module, mais la repro isolée n'a pas été mise à jour ni supprimée — à trancher : la garder comme outil pédagogique de repro pure, ou la faire pointer vers le vrai module.
- **`hero-geometry.spec.js` / `modal-backtop-zindex.spec.js`** écrivent une fixture temporaire sous `harnais/geometry/` au lancement (nettoyée par `afterAll`) pour être servie par le `webServer` de Playwright. Si une exécution est interrompue avant `afterAll` (crash, kill -9), un fichier `.hero-fallback-fixture.html` ou `.modal-backtop-fixture.html` peut rester — inoffensif (préfixé `.`, non traqué) mais à mentionner si un `.gitignore` strict doit les exclure explicitement.
- **P0-B (couverture SKU), P0-C (flash hero), P0-D (fronts CSP), P0-E (trou de couverture E2E CSP)** ne sont pas traités par ce palier — hors périmètre de P0-A tel que cadré par l'échange initial.
- **`verify-sticky.js` / `measure-hero.js` / `verify-backtop-zindex.js`** utilisent maintenant un `ROOT` correct, mais aucun test du dépôt ne verrouille ce chemin lui-même (si quelqu'un redéplace `harnais/` un jour, on retombe dans le même piège silencieux). Candidat naturel pour P2 (gates aveugles) plutôt que P0.
- Bug d'instrumentation trouvé et corrigé (extract.js/ROOT) n'était **techniquement pas dans le périmètre déclaré de P0-A** (qui parle de câbler les mesures, pas de réparer le harnais) — traité ici parce qu'aucun câblage n'était possible sans lui. Signalé explicitement plutôt que corrigé en silence, conformément à R7.
