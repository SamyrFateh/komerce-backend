# Prompt opérationnel — Sonnet : lot L0-B « Orchestration de déploiement » (Komerce)

> Copier-coller à Sonnet (Claude Code / agent repo).
> Objectif : rendre le déploiement **reproductible** et **trancher** la couture la plus structurante du système (same-origin implicite + couplage de build). C'est la décision qui conditionne toutes les autres coutures.

---

## RÔLE

Tu es ingénieur plateforme/DevOps senior sur Komerce (3 repos : backend Express/PostgreSQL sur **Railway**, frontend Boutique, frontend Dashboards). Ce lot commence par une **décision d'architecture** que **je tranche** — tu n'implémentes l'outillage qu'après mon arbitrage. Conservateur : pas de big-bang, un chemin de migration réversible.

## CONTEXTE À LIRE D'ABORD

- `docs/CARTOGRAPHY_360.md` §4 (surfaces HTML servies sous `public/`) et §5 (`REQUIRED_ENV`, webhooks Stripe body brut).
- `docs/ZONE_IMPACT.md` §3/§3bis (`server.js` god-file, ordre des middlewares, I-07).
- `railway.json` / `railway.toml`, `package.json` (scripts), `.nvmrc`.

## CONSTATS DÉJÀ VÉRIFIÉS PAR L'ARCHITECTE (point de départ factuel)

1. **Couplage de build dur backend → boutique.** `package.json` : `start = npm run build && node server.js`, `build = node public/boutique/scripts/deploy-css.js`, + `boutique:audit` / `boutique:arch` qui pointent vers `public/boutique/scripts/`. **Dans le repo livré, `public/` est vide** ⇒ `npm start` échoue tant que la boutique n'est pas assemblée dans `public/boutique/`.
2. **Railway** : `railway.json` NIXPACKS, `startCommand: npm start`, `restartPolicyType: ON_FAILURE` (max 10). ⇒ si `public/boutique` manque, le build échoue → **boucle de redémarrage**.
3. **Same-origin implicite.** Les deux frontends appellent `/api` en relatif **avec cookies** ; `komerce-api.js` défaut sur `window.location.origin` ; `auth-guard.js` (dashboards) utilise `credentials: 'include'`. ⇒ tout suppose un service depuis la **même origine** que l'API. Un déplacement front cross-domaine casserait silencieusement la session.
4. **3 repos séparés** (`SamyrFateh/komerce-backend` + boutique + dashboards), chacun avec son build (la boutique : esbuild → `js/dist`, `css/dist`, `.cache-buster-state.json` ; dashboards : manifest + `sw.js`).

## GARDE-FOUS ABSOLUS

1. **Préserver l'auth tant que la couture n'est pas explicitement migrée.** Option monorepo → on **garde** le same-origin/cookies. Option split → on migre l'auth vers token + CORS **en entier**, jamais à moitié (cookies cross-site cassés = panne d'auth totale).
2. **Webhooks Stripe en body brut avant `express.json` (I-07)** — aucune réorganisation du boot ne doit les déplacer.
3. **`REQUIRED_ENV` reste fail-fast** — pas de fallback silencieux introduit par l'outillage de déploiement.
4. **Reproductibilité** : objectif = `git clone` → une commande → app qui démarre, **sans étape manuelle implicite**.
5. **Réversibilité** : tout changement de pipeline doit pouvoir être rollback sans toucher au code métier.

## MISSION — sous-lots, dans l'ordre

### B1 — Cartographie des dépendances de build (lecture seule, je valide)
- Liste **toutes** les dépendances de build entre les 3 repos : scripts `package.json` qui lisent `public/`, bundles front (esbuild boutique, CSS dist), `sw.js`/manifest, cache-busting (`.cache-buster-state.json`), et ce que Railway exécute réellement.
- Produis un schéma « qui a besoin de quoi, et à quel moment (build/boot/runtime) ».
- **Stop. Montre la cartographie avant toute proposition.**

### B2 — Décision : monorepo vs split (présente, je tranche)
Présente les **deux options**, avec conséquences concrètes :
- **Monorepo (workspaces)** : `backend/`, `boutique/`, `dashboards/` ; un script d'assemblage build chaque front et **copie les artefacts dans `public/`** avant le boot ; same-origin/cookies **conservés**. Conséquences : un seul déploiement, fin du couplage implicite, mais repo unifié à organiser.
- **Split front/back** : fronts buildés et servis sur **CDN/static host**, backend **API-only** ; bascule de l'auth en **token + CORS** ; cache-busting natif CDN. Conséquences : déploiements indépendants, mais **migration d'auth complète** obligatoire (la couture #1) et CORS à durcir.
Pour chaque option : impact sur Railway, sur `server.js` (le fallback HTML), sur le cache-busting, sur le rollback. **Recommande-en une.** N'implémente rien avant mon OK.

### B3 — Outillage de la décision retenue
- **Si monorepo** : structure workspaces + script `npm run assemble` (build fronts → copie dans `public/`) + `start` qui ne casse plus jamais sur un clone vierge + doc « comment déployer ».
- **Si split** : pipeline de build/publish front (CDN), backend en mode API-only, migration auth token+CORS **complète et testée**, et plan de bascule.
- Dans les deux cas : **documenter la contrainte same-origin actuelle** (ou sa levée) dans `CARTOGRAPHY_360.md`, et garantir un `npm start` reproductible depuis zéro.

## MÉTHODE

1. **Cartographie/plan d'abord**, code ensuite. Attends mes arbitrages (B1 puis B2).
2. **Une chose à la fois** : pas de refactor `server.js` ici (c'est le lot L2-A) — tu touches au boot **uniquement** pour l'assemblage, sans déplacer les webhooks ni l'ordre des middlewares.
3. **Test de reproductibilité** : prouve qu'un clone vierge + la commande documentée démarre (idéalement en CI : job « cold start »).
4. **Doc-sync** : `CARTOGRAPHY_360.md` (surfaces + déploiement) dans la même PR.

## CRITÈRES D'ACCEPTATION

- Décision tranchée et **outillée** ; `git clone` → 1 commande → app qui démarre (vérifié en CI).
- Couture same-origin **soit préservée, soit migrée intégralement** (jamais à moitié).
- I-07 intact ; `REQUIRED_ENV` fail-fast intact ; rollback documenté.

## ANTI-OBJECTIFS

- Pas de refactor `server.js` (≠ ce lot).
- Pas de migration d'auth partielle.
- Pas d'étape de déploiement manuelle implicite « que tout le monde connaît ».
- Pas de déplacement des webhooks Stripe.

---

### Mini-prompts prêts à tirer

**B1** — « Lance B1. Cartographie toutes les dépendances de build entre backend/boutique/dashboards (scripts `package.json` lisant `public/`, bundles, sw/manifest, cache-busting) et ce que Railway exécute. Schéma build/boot/runtime. Stop avant toute proposition. »

**B2** — « Lance B2. Présente monorepo vs split avec impacts sur same-origin/cookies, Railway, `server.js` (fallback HTML), cache-busting et rollback. Recommande-en une. N'implémente rien. »
