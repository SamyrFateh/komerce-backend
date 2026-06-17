# Runbook — se débloquer quand un hook bloque

> But : quand un `git commit` ou `git push` est refusé, **ne pas deviner et ne pas bypasser par réflexe**.
> Identifier la porte, lancer le diagnostic, appliquer la résolution. Le bypass `--no-verify`
> est une soupape d'urgence, pas une habitude — la CI rejoue les portes de toute façon.

---

## 0. Réflexe immédiat

1. **Lire la dernière ligne 🚫 du hook.** Chaque porte affiche un message distinct et une commande `Détail`.
2. **Lancer la commande de diagnostic** correspondante (tableau ci-dessous).
3. **Appliquer la résolution.** Puis relancer `git commit` / `git push`.

> ⚙️ À savoir : le **pre-commit régénère le graphe + réconcilie le budget + re-stage automatiquement**.
> Si ton edit a corrigé le problème, **relancer `git commit` peut suffire** à passer au vert.
> Avant même de committer, tu peux tout vérifier en local : `npm run arch:gate` (et `npm run arch:doctrine` pour le front).

---

## 1. Table de débordage : symptôme → commande → action

| Message du hook | Diagnostic | Action |
|---|---|---|
| 🚫 Hygiène headers : violation bloquante | `npm run arch:check` | Ajouter / corriger le header `@komerce-arch` |
| 🚫 Drift SCHEMA.md ↔ DB live non résolu | `npm run arch:drift` | Voir §3 (fiction / fantôme / cliquet) |
| 🚫 Sous-déclaration headers ↔ SQL | `npm run arch:headers-sql` | `npm run arch:enrich -- --write` puis regen |
| 🚫 Doctrine sanitize_before_render | `npm run arch:doctrine` | Échapper la donnée (sanitize/escapeHtml) |
| 🔴 Score N/100 — Push bloqué (pre-push) | `node scripts/impact-check.js --diff=origin/main` | Voir §6 (corriger ou épingler le FP) |
| `! [rejected] (fetch first)` | — (ce n'est **pas** un hook) | `git pull --no-rebase` puis push (§7) |

---

## 2. Hygiène headers (`npm run arch:check`)

**Ce que ça veut dire** : un fichier scanné n'a pas de header valide, ou un mot-clef SQL apparaît dans un fichier sans déclaration d'accès DB.

**Résoudre :**
- *Sans header* → ajouter un header `@komerce-arch` (complet) en tête du fichier, ou `@komerce-arch-lite` **avec un `@owner`** pour un petit fichier. Reprendre la forme d'un fichier voisin du même dossier.
- *Lite sans owner* → ajouter la ligne `@owner`.
- *Mots-clefs SQL* → le fichier fait du SQL sans le déclarer : poser un header complet avec `@db-read` / `@db-write` corrects (ou lancer l'enrichisseur, §4).
- Revérifier : `npm run arch:check`.

---

## 3. Drift SCHEMA.md ↔ DB live (`npm run arch:drift`)

Trois sous-cas, lis lequel s'affiche :

**Fiction (hors liste)** — un header (ou SCHEMA.md) référence une table **qui n'existe pas dans la DB live**. C'est presque toujours un vrai bug. Causes possibles :
- *Faute de frappe* dans le nom de table → corriger.
- *Table renommée / supprimée* → mettre à jour la référence.
- *Table nouvelle*, créée par une migration **pas encore dans le dump** → appliquer la migration en base, puis rafraîchir le dump : `npm run db:snapshot`. Le drift se résout.

**Fantôme SCHEMA.md** — SCHEMA.md documente un objet **absent de la DB live** (table supprimée). → le retirer de `docs/SCHEMA.md`, ou corriger son nom.

**Cliquet : tables live non documentées** — une table **existe en base mais n'est pas dans SCHEMA.md**. → l'ajouter à `docs/SCHEMA.md`. Le cliquet vise 0 ; après l'avoir documentée, `npm run arch:gate` doit repasser vert.

> Si une baisse est légitime (fiction réellement résolue), figer le nouvel état :
> `npm run arch:reconcile -- --write` (élague l'allowlist résolue, abaisse les cliquets).

---

## 4. Sous-déclaration headers ↔ SQL (`npm run arch:headers-sql`)

**Ce que ça veut dire** : le code touche une table live **absente de `@db-read` / `@db-write`** du header.

**Résoudre (automatique, le plus souvent) :**
```bash
npm run arch:enrich -- --write   # remplit les @db-read/@db-write depuis le SQL réel
npm run arch:gen                 # régénère le graphe
npm run arch:headers-sql         # doit afficher 0
```
- Si tu préfères à la main : ajouter la table manquante dans `@db-read` (SELECT/JOIN) ou `@db-write` (INSERT/UPDATE/DELETE).
- Si la sous-déclaration **baisse légitimement**, figer le plafond : `npm run arch:reconcile -- --write`.

> ⚠️ L'enrichisseur est **additif et ancré sur la DB live** : il ne touche que les vraies tables, ne retire jamais une déclaration manuelle, et n'insère jamais de `@unknown` vide. Relis le `git diff` (documentation seulement).

---

## 5. Doctrine sanitize_before_render (`npm run arch:doctrine`)

**Ce que ça veut dire** : une **source externe** (`req/params/query/body`, `location`, `URLSearchParams`, `window.name`, storage…) atterrit **sans échappement** dans un sink HTML (`innerHTML` / `outerHTML` / `insertAdjacentHTML` / `document.write`), sur une ligne ajoutée.

> Cette porte ne bloque **que** sur la teinte directe et prouvable. Un blocage ici est donc **quasi toujours réel** — ce n'est pas du bruit.

**Résoudre :**
- Échapper la donnée avant le rendu : `sanitize(...)` ou `escapeHtml(...)`.
- Ou passer par un builder `render*` / `*Markup` qui échappe en interne.
- Exemple : `el.innerHTML = location.hash;` → `el.innerHTML = sanitize(location.hash);`
- Voir l'inventaire complet (non bloquant, pour revue) : `npm run arch:doctrine:all`.

---

## 6. Pre-push — score d'impact ≥ 70 (`impact-check`)

Le score n'analyse que le **diff** poussé, avec suppression des faux positifs connus et paliers de sévérité (plein poids en contexte critique, avertissement ailleurs). Un blocage signifie donc l'un des deux :

**a) Un vrai finding haut-signal** (fichier/route/table critique) → le corriger (cf. la catégorie : sqlInjection, xss, secret, dangerousOps…).

**b) Un faux positif résiduel** → l'épingler, avec sa raison, dans `scripts/impact-suppressions.json` :
```json
[
  {
    "file": "routes/admin-costing.js",
    "category": "sqlInjection",
    "contains": "UPDATE finance_config SET",
    "reason": "colonnes en dur, valeurs paramétrées $N — vérifié le AAAA-MM-JJ"
  }
]
```
L'épinglage est par **sous-chaîne** (survit aux déplacements de lignes) et reste réconciliable comme l'allowlist de drift. Relancer ensuite le push.

> Rappel des seuils : `0–29 SAFE`, `30–69 REVIEW`, `70–100 BLOCK`.

---

## 7. `! [rejected] (fetch first)` — ce n'est PAS un hook

Le remote a des commits que tu n'as pas en local. Rien à voir avec la qualité :
```bash
git pull --no-rebase   # intègre les commits distants (merge)
git push
```

---

## 8. Bypass d'urgence — quand, et seulement quand

```bash
git commit --no-verify    # saute le pre-commit
git push   --no-verify    # saute le pre-push
```

**Légitime uniquement si :**
- faux positif **déjà confirmé** (et de préférence déjà épinglé en allowlist, §6) ;
- urgence de production réelle et assumée.

**Jamais** par réflexe parce que « c'est rouge ». Filet de sécurité : **la CI rejoue les mêmes portes** (`.github/workflows/governance.yml`) — ce que tu bypasses en local est rattrapé en haut, donc un bypass ne troue pas la coque, il décale juste le contrôle.

**Après tout bypass** : ouvrir le correctif (corriger le vrai problème, ou épingler le FP avec sa raison).

---

## 9. Antisèche — commandes

| Commande | Effet |
|---|---|
| `npm run arch:gate` | Régénère + lance les 4 portes (à faire **avant** de committer) |
| `npm run arch:doctrine` / `:all` | Doctrine rendu : diff bloquant / sweep observation |
| `npm run arch:enrich -- --write` | Remplit les `@db-read`/`@db-write` depuis le SQL réel |
| `npm run arch:reconcile -- --write` | Fige l'état sain (élague allowlist, abaisse cliquets) |
| `npm run db:snapshot` | Rafraîchit le dump live depuis `DATABASE_URL` |
| `npm run db:sync` | snapshot → reconcile → gate (après une migration) |
| `node scripts/impact-check.js --diff=origin/main` | Rejoue l'analyse de risque du push |

---

### Principe directeur
La porte bloque sur un **vrai problème** ; la bonne réponse est de **le résoudre**, pas de le contourner.
Quand l'outil se trompe (FP), on l'**épingle avec une raison** — traçable et réconciliable.
Le bypass existe pour l'urgence, et la CI reste le dernier rempart.
