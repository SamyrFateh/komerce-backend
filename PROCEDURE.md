# Patch — Gouvernance qualité multi-périmètre (session 2026-06-26)

## Ce qui a changé

| Fichier | Action |
|---|---|
| `.github/workflows/ci.yml` | MODIFIÉ — job `boutique-quality` ajouté (N1 audit:gate + N2 check:fast) ; step `feature:check` (N5) ajouté dans job `unit` |
| `package.json` | MODIFIÉ — `css:guard` et `build` délèguent au script boutique (plus de script racine) |
| `scripts/setup-hooks.sh` | MODIFIÉ — step 0c (css-guard racine, doublon) supprimé |
| `scripts/feature-guard.js` | MODIFIÉ — bug de résolution de chemin corrigé (prefix par catégorie boutique/dash) |
| `scripts/npm-audit-gate.js` | MODIFIÉ — ajout `--cwd=<path>` pour réutilisation multi-package.json |
| `public/boutique/package.json` | MODIFIÉ — scripts `audit:gate` et `audit:gate:observe` ajoutés |
| `routes/admin/customs.js` | MODIFIÉ — header `@domain dashboard` → `@domain douane` |
| `routes/admin-customs-categories.js` | MODIFIÉ — header `@domain dashboard` → `@domain douane` |
| `routes/admin-customs-shipments.js` | MODIFIÉ — header `@domain dashboard` → `@domain douane` |
| `AGENTS.md` | MODIFIÉ — référence css-guard mise à jour (pointe vers script boutique) |
| `docs/README.md` | MODIFIÉ — référence css-guard mise à jour |
| `docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md` | MODIFIÉ — N1 documente l'extension boutique |

## Fichiers à SUPPRIMER (ne sont plus dans le zip — à faire manuellement)

```bash
# Copier ce script à la racine du repo ou exécuter ligne par ligne :
git rm scripts/css-guard.js
git rm scripts/css-guard-baseline.json
git rm -r public/boutique/.github/
```

> `public/boutique/.github/workflows/ci.yml` était un workflow mort (GitHub Actions ne lit que `.github/workflows/` à la racine du repo). Son contenu est désormais dans le job `boutique-quality` de `.github/workflows/ci.yml`.

## Procédure d'application

```bash
# 1. Extraire à la racine du repo (écrase les fichiers existants)
unzip -o patch_gouvernance_2026-06-26.zip -x "PROCEDURE.md" -d .

# 2. Supprimer les fichiers obsolètes
git rm scripts/css-guard.js
git rm scripts/css-guard-baseline.json
git rm -r public/boutique/.github/

# 3. Régénérer le graphe d'architecture (headers @domain modifiés)
npm run arch:gen

# 4. Vérifications locales
npm run arch:check
npm run backend:audit
npm run feature:check
npm run css:guard
cd public/boutique && npm run check:fast && npm run audit:gate && cd -

# 5. Reconfigurer le hook pre-commit local (setup-hooks.sh modifié)
bash scripts/setup-hooks.sh

# 6. Commit
git add -A
git status   # vérifier que tout est bien stagé (modified + deleted)
git commit -m "fix(governance): consolidate quality gates — dual-perimeter CI, feature-guard path fix, css-guard dedup, audit:gate boutique

- boutique-quality CI job (N1 audit + N2 check:fast) replaces dead public/boutique/.github/workflows/ci.yml
- feature:check (N5) wired into CI unit job; fix path resolution bug (30 false positives → 0)
- css-guard dedup: root scripts/css-guard.js removed, root delegates to boutique canonical script
- npm-audit-gate extended to support --cwd for boutique deps coverage
- 3 route headers corrected: @domain dashboard → @domain douane (customs feature)
- step 0c removed from pre-commit hook (was running before dist rebuild, duplicate of step 6b)"
```

## Après push

La prochaine PR déclenchera le job `boutique-quality` sur GitHub Actions. Vérifier dans l'onglet Actions que les deux jobs (`unit` et `boutique-quality`) passent au vert.
