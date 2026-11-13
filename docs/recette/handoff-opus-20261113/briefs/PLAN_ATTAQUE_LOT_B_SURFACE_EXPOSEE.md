# Plan d'attaque — Lot B « Surface exposée » (revue 2026-11-10, `main` @ d6ba5d7)

> Exécutant : Sonnet. Règles : `AGENTS.md`. Une PR par sous-lot, merge autonome CI verte.

## B1 — Sortir l'outillage de `public/`
- **Constat** : `public/boutique/k6/k6-v0.56.0-windows-amd64/k6.exe` (64 Mo, versionné) et `public/boutique/harnais/` (scripts, OTP de test `424242`, creds locales) sont servis en 200 ; `middleware/internal-static-guard.js` ne couvre pas ces segments.
- **Correctif** :
  1. `git rm` du binaire k6 ; installation via script (`scripts/`) ou action CI ; `.gitignore` pour `k6/`.
  2. Déplacer `harnais/` hors de `public/` (ex. `tools/boutique-harnais/`), corriger les chemins référencés.
  3. Défense en profondeur : ajouter `k6`, `harnais` aux `INTERNAL_STATIC_DIR_SEGMENTS`, + extensions `.exe|.sh|.py` à la liste bloquée.
- **Tests** : test du guard (`/boutique/k6/…`, `/boutique/harnais/…`, `*.exe`, `*.sh`, `*.py` → 404 ; `manifest.json` toujours servi).
- Note : le binaire reste dans l'historique git ; une purge d'historique serait un arbitrage humain, ne pas la faire.

## B2 — Échapper les données client dans les dashboards
- **Constat** : `full_name` (validé `safeStr` = trim+max, pas de filtrage HTML) rendu via `innerHTML` :
  - `public/hub/js/hub.js` l.98, 143, 157, 209 (aucun échappement dans le fichier) ;
  - `public/dashboards/admin/js/views/HubRelaisView.js` l.243, 257, 557, 671, 695 (`esc()` présent l.103, non utilisé).
  CSP actuelle bloque le script (impact = injection HTML/phishing interne), on corrige quand même.
- **Correctif** : `esc()` sur toute donnée serveur interpolée en `innerHTML` dans ces deux fichiers + `public/relais/js/relais.js:313`. Puis trier la liste complète des 160 interpolations suspectes (commande de repérage ci-dessous) et corriger les vraies ; ne pas refactorer les vues.
  ```bash
  grep -rnE '\$\{\s*[a-zA-Z_$.?]*\.(full_name|client_name|recipient_name|name|address|phone|email|note|notes|comment|text|description|message|reason)\s*(\|\|[^}]*)?\}' public --include=*.js | grep -v '/boutique/' | grep -vE 'esc[A-Za-z]*\(|sanitize|textContent|encodeURI'
  ```
- `showToast` (boutique `js/b-utils.js:36` et équivalents dashboards) : passer en `textContent`.
- **Garde anti-régression** : un test qui rend une vue avec `full_name = '<img src=x>'` et vérifie l'absence d'élément `img` injecté (hub + HubRelais).

## B3 — Couper la surface legacy morte
- **Constat** : `/hub/index.html` et `/dashboards/admin-legacy/control-tower.html` (20k lignes) ne sont plus liés depuis le canonique ni le login, mais restent servis (allowlist auth-guard `server.js` l.~131).
- **Correctif** : vérifier d'abord par `agent:context --impact` et `business-graph` qu'aucun parcours vivant (y compris E2E Playwright de certification) ne les utilise. Si un usage existe → **stop, signaler** (arbitrage). Sinon : 410 ou redirection vers l'écran canonique équivalent, retrait de l'allowlist, puis suppression du code dans une PR distincte.

## B4 — Durcir la CSP (`bootstrap/security.js`)
- Retirer `https://unpkg.com` et `https://cdn.jsdelivr.net` de `scriptSrc` après avoir recensé les scripts réellement chargés ; auto-héberger ou épingler avec SRI. Passer `imgSrc` de `http:` à rien (https uniquement) si aucun usage http.
- Vérifier boutique + dashboards en E2E avant merge.

## Définition de fini
k6/harnais hors du web, injections corrigées et testées, legacy coupé (ou arbitrage posé), CSP resserrée sans régression E2E.
