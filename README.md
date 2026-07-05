# CI dashboards — 3 fichiers à copier-coller (écraser tel quel)

Chemins exacts du monorepo, racine = backend :

```
.github/workflows/ci.yml                        (MODIFIÉ)
public/dashboards/features/admin-dashboard.feature.js   (MODIFIÉ)
public/dashboards/package-lock.json              (NOUVEAU)
```

## 1. `.github/workflows/ci.yml`

Ajout du job `dashboards-quality`, symétrique du job `boutique-quality`
déjà en place. Reprend l'ordre exact de `check:all` du package.json
dashboards :

```
npm ci
npm run audit:gate      (npm audit — informatif, non bloquant par design)
npm run check:all       (quality:gate → arch:check → feature:guard →
                          audit:registry → testkit:check → test:unit)
```

Aujourd'hui, aucun gate dashboards ne tournait en automatique (comme
c'était le cas pour boutique avant ce chantier). Ce job comble le trou.

## 2. `public/dashboards/features/admin-dashboard.feature.js`

**Bug préexistant trouvé en testant `audit:registry` sur un checkout
propre, avant de le mettre en CI** (même démarche que pour boutique :
je ne voulais rien committer qui casse dès le premier run).

`admin/js/ClientsView.js` (copie legacy à la racine `js/`, remplacée
par `admin/js/views/ClientsView.js` — c'est écrit noir sur blanc dans
son propre header) porte `@domain admin-dashboard` mais n'était
déclaré dans aucun manifest. Le gate `audit:registry` le détecte et
bloque (`DOMAIN-MISMATCH`), donc `check:all` échouait avant même
d'arriver aux tests.

Fix appliqué : ajout de `'../admin/js/ClientsView.js'` à la liste
`files.js` du manifest. Changement de données uniquement (aucun code
applicatif touché), il fait juste passer le registre de 78 → 79
fichiers déclarés. Registre propre confirmé après coup.

Si ce fichier legacy est en réalité mort et sans usage, le nettoyer
carrément (suppression) serait plus propre à terme — mais ça sort du
périmètre "CI" et j'ai préféré ne pas toucher au code applicatif sans
te le signaler d'abord.

## 3. `public/dashboards/package-lock.json`

N'existait pas dans le repo (contrairement à boutique). Nécessaire
pour que `npm ci` fonctionne dans le job CI — `npm ci` exige une
lockfile committée, `npm install` seul ne suffit pas. Généré avec
`npm install --package-lock-only` à partir du `package.json` actuel,
zéro changement de dépendances.

---

## Vérifié avant envoi (checkout propre, hors git donc testkit:check
en mode "aucun fichier touché" — comportement normal, il se base sur
le diff git en CI réelle) :

- `npm run audit:registry` → ✅ registre propre, 79 fichiers déclarés
- `npm run arch:check` → ✅ 79 fichiers, 0 header manquant
- `npm run feature:guard` → ✅ 2 slices cohérents
- `npm run test:unit` → ✅ 21/21 suites, 177/177 tests
- `npm run check:all` (bout en bout) → ✅
- YAML du `ci.yml` final → syntaxe validée

Les deux jobs `unit` / `integration` déjà en place et `boutique-quality`
ne sont pas touchés.
