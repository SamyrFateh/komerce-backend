# Patch — BOUTIQUE_ARCHITECTURE.md

> Date : 18 mai 2026
> But : ajouter à la doc normative les références aux docs satellites (CSS_PIPELINE, MODAL_ARCHITECTURE) et à l'INDEX

---

## Constat avant patch

La doc actuelle `BOUTIQUE_ARCHITECTURE.md` est **excellente** et **déjà mature** :
- Elle déclare I-1 à I-6 (mêmes invariants que `audit-boutique-arch.js`)
- Elle référence `BOUTIQUE_ARCHITECTURE_LIVE.md` (le doc généré) et `npm run boutique:audit`
- Elle a un tableau d'ownership précis (§3)
- Elle gère la séquence de chargement (§7)
- Elle décrit le process PR (§8)

**Ce qui manque** : les références aux **autres docs Boutique satellites** :
- `BOUTIQUE_CSS_PIPELINE.md` (mon livrable du 18/05 — pipeline source/dist détaillé)
- `BOUTIQUE_MODAL_ARCHITECTURE.md` (mon livrable du 17/05 — détail interne du modal.css)
- `BOUTIQUE_DOCS_INDEX.md` (à créer en lot CSS-4)

---

## Patch 1 — Compléter l'en-tête

Dans `public/boutique/docs/BOUTIQUE_ARCHITECTURE.md`, lignes 1-12, **remplacer** :

```markdown
# Komerce Boutique — Architecture

> **Document normatif.** Décrit ce qui doit être vrai. Court par discipline.
> Si tu trouves une contradiction entre ce document et le code, **le code a tort** —
> ouvre une PR pour le corriger. Si la règle elle-même est mauvaise, **change-la ici**
> dans la même PR.
>
> L'état réel du code à un instant T est dans `BOUTIQUE_ARCHITECTURE_LIVE.md`,
> régénéré par `npm run boutique:arch`. Ce fichier-ci, jamais.
>
> Le garde-fou : `npm run boutique:audit` plante le build si le code diverge.
```

**Par** :

```markdown
# Komerce Boutique — Architecture

> **Document normatif.** Décrit ce qui doit être vrai. Court par discipline.
> Si tu trouves une contradiction entre ce document et le code, **le code a tort** —
> ouvre une PR pour le corriger. Si la règle elle-même est mauvaise, **change-la ici**
> dans la même PR.
>
> **Documents satellites Boutique** (cf. `BOUTIQUE_DOCS_INDEX.md`) :
> - `BOUTIQUE_ARCHITECTURE_LIVE.md` — état réel du code (généré par script)
> - `BOUTIQUE_CSS_PIPELINE.md` — détail du pipeline source → dist
> - `BOUTIQUE_MODAL_ARCHITECTURE.md` — détail interne du fichier `modal.css`
> - `BOUTIQUE_COMPONENT_OWNERSHIP.md` — ownership des composants JS
>
> **Scripts associés** (dans `public/boutique/scripts/`) :
> - `npm run bundle:css` — concat sources → 4 bundles dist
> - `npm run boutique:arch` — régénère `BOUTIQUE_ARCHITECTURE_LIVE.md`
> - `npm run boutique:audit` — plante le build si les invariants §1 sont violés
```

---

## Patch 2 — Compléter §2 tableau d'inventaire

Dans le tableau `## 2. Inventaire CSS — statut attendu`, **ajouter une note** juste après la phrase :

```markdown
**Aucun autre `.css` ne doit exister dans `css/`.** Si présent, l'audit échoue.
```

**Ajouter** :

```markdown
**Détail du pipeline source → bundle → dist** : voir `BOUTIQUE_CSS_PIPELINE.md`.

**Détail interne de `modal.css` (1736L, 7 sections)** : voir `BOUTIQUE_MODAL_ARCHITECTURE.md`.
```

---

## Patch 3 — Enrichir §3 ownership avec note multi-owner

Dans la §3 actuelle, après le tableau d'ownership, ajouter cette note :

```markdown
### Note sur les sélecteurs multi-owner légitimes

Certains sélecteurs `.k-*` apparaissent dans **plusieurs fichiers owner** intentionnellement. Ce ne sont PAS des violations I-2 si chacun a un scope distinct :

| Sélecteur | Owners | Scopes |
|---|---|---|
| `.k-chip` | `categories.css` + `boutique-desktop.css` + `interactions.css` | base mobile / override desktop / animations transitions |
| `.k-cats-shell` | `categories.css` + `boutique-desktop.css` + `hero.css` + `desktop-commerce-skeleton.css` | base / desktop / contexte hero / max-width skeleton |
| `.k-modal-*` | `modal.css` + `boutique-desktop.css` + `desktop-commerce-skeleton.css` | base/mobile/desktop core / enrichissements desktop (recent grid, keyboard hint) / hover image desktop |
| `.k-side-cart` | `cart.css` + `boutique-desktop.css` | base + override desktop préfixé `#k-side-cart` |

Le script `audit-boutique-arch.js` connaît ces exceptions via sa table `OWNERSHIP` (avec champ `scope`).
```

---

## Patch 4 — §8 Process — référence aux 3 scripts ensemble

La §8 actuelle mentionne `boutique:audit` et `boutique:arch` mais pas `bundle:css`. C'est un trou — sans rebundle, les modifs ne sont pas en prod.

**Remplacer** la §8 par :

```markdown
## 8. Process — toute PR doit passer

```bash
# Étape 1 : modifier les sources
vim public/boutique/css/modal.css   # ou autre source

# Étape 2 : rebundler (sinon rien n'est en prod)
cd public/boutique
npm run bundle:css

# Étape 3 : régénérer la photo de l'archi
npm run boutique:arch

# Étape 4 : valider les invariants §1
npm run boutique:audit               # exit 0 ou exit 1

# Étape 5 : vérifier le diff
git status public/boutique/css/dist/ public/boutique/docs/

# Étape 6 : commit unique sources + dist + docs
git add public/boutique/css/ public/boutique/docs/
git commit -m "..."
```

Si `boutique:audit` passe et que le diff de `BOUTIQUE_ARCHITECTURE_LIVE.md` est cohérent avec l'intention de la PR, la PR est mergeable côté archi. Le visuel et le fonctionnel restent à valider à part.

**Sources, dist et docs LIVE doivent être dans le même commit.** Sinon le repo diverge silencieusement (cf. dette CSS résolue le 18/05 — où le dist datait de 17/05 et les sources de 18/05).
```

---

## Justification de chaque patch

| Patch | Pourquoi |
|---|---|
| 1 (en-tête) | Aujourd'hui la doc renvoie seulement vers LIVE, pas vers PIPELINE/MODAL/INDEX/OWNERSHIP. Trou de visibilité. |
| 2 (§2 inventaire) | Le détail du pipeline et du modal vit ailleurs — ARCHITECTURE doit pointer vers ces docs. |
| 3 (§3 multi-owner) | Le concept de multi-owner légitime n'est pas formalisé alors que `audit-boutique-arch.js` le connaît via son champ `scope`. Risque d'incompréhension. |
| 4 (§8 process) | Le `bundle:css` est manquant dans le process. Sans lui, les modifs ne sont pas en prod. C'est précisément la dette qu'on vient de résoudre le 18/05 et qui ne doit pas se reproduire. |

---

## Validation

Après application des 4 patches :

```bash
cd public/boutique
npm run boutique:audit   # doit toujours passer
npm run boutique:arch    # doit toujours produire un LIVE valide
```

Aucun de ces patches ne touche le code, seulement la doc. Aucun impact runtime.
